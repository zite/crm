import { z } from 'zod';
import { createEndpoint } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { num, Params } from '@project/shared/server/sql';
import { parseInput } from '../server/input';
import { dealClauses, FORECAST_CATEGORY, membersInScope, quotasFor, reportMemberSchema, reportScopeOutput, reportScopeSchema, resolveScope, scopeOutput, type ReportMember } from '../server/reports/common';

type Cell = { amount: number; deals: number };
type ForecastRow = { member: ReportMember | null; memberId: string; name: string; quota: number; won: Cell; commit: Cell; bestCase: Cell; pipeline: Cell; omitted: Cell; lost: Cell };

/**
 * The quarter's commit, one row per owner: what is already won, what they are
 * calling, and how far it is from their number.
 *
 * "Closing in the period" means an open deal whose close date falls inside it;
 * won and lost are counted by the day they actually closed. Forecast categories
 * come from the deal, falling back to the stage probability exactly the way the
 * deal list does, so a row here and a filtered list there agree.
 */

const inputSchema = reportScopeSchema;

const bucket = z.object({ amount: z.number(), deals: z.number() });

export default createEndpoint({
  description: 'Forecast by owner for a period: quota, closed won, commit, best case, pipeline and the gap',
  authenticated: true,
  inputSchema,
  outputSchema: z.object({
    scope: reportScopeOutput,
    rows: z.array(
      z.object({
        member: reportMemberSchema.nullable(),
        memberId: z.string(),
        name: z.string(),
        quota: z.number(),
        won: bucket,
        commit: bucket,
        bestCase: bucket,
        pipeline: bucket,
        omitted: bucket,
        lost: bucket,
      }),
    ),
    me: z.string(),
  }),
  execute: async ({ input, context }) => {
    const parsed = parseInput(inputSchema, input);
    const r = await resolveScope(parsed, context);

    const p = new Params();
    const scope = dealClauses(p, parsed).join(' AND ');
    const f = p.add(r.from);
    const t = p.add(r.to);
    const closedIn = `d."closedAt" >= ${f}::date AND d."closedAt" < (${t}::date + 1)`;
    const closingIn = `d."closeDate" >= ${f}::date AND d."closeDate" <= ${t}::date`;
    const open = (category: string) => `d."status" = 'Open' AND ${closingIn} AND ${FORECAST_CATEGORY} = '${category}'`;

    const { rows } = await zite.sql({
      query: `
        SELECT COALESCE(NULLIF(d."ownerId", ''), 'none') AS owner_id,
          COALESCE(SUM(d."amount") FILTER (WHERE d."status" = 'Won' AND ${closedIn}), 0) AS won_amount,
          COUNT(*) FILTER (WHERE d."status" = 'Won' AND ${closedIn}) AS won_deals,
          COALESCE(SUM(d."amount") FILTER (WHERE d."status" = 'Lost' AND ${closedIn}), 0) AS lost_amount,
          COUNT(*) FILTER (WHERE d."status" = 'Lost' AND ${closedIn}) AS lost_deals,
          COALESCE(SUM(d."amount") FILTER (WHERE ${open('Commit')}), 0) AS commit_amount,
          COUNT(*) FILTER (WHERE ${open('Commit')}) AS commit_deals,
          COALESCE(SUM(d."amount") FILTER (WHERE ${open('Best Case')}), 0) AS best_amount,
          COUNT(*) FILTER (WHERE ${open('Best Case')}) AS best_deals,
          COALESCE(SUM(d."amount") FILTER (WHERE ${open('Pipeline')}), 0) AS pipe_amount,
          COUNT(*) FILTER (WHERE ${open('Pipeline')}) AS pipe_deals,
          COALESCE(SUM(d."amount") FILTER (WHERE ${open('Omitted')}), 0) AS omit_amount,
          COUNT(*) FILTER (WHERE ${open('Omitted')}) AS omit_deals
        FROM "Deals" d
        LEFT JOIN "Stages" s ON s.id::text = d."stageId"
        WHERE ${scope} AND ((d."status" <> 'Open' AND ${closedIn}) OR (d."status" = 'Open' AND ${closingIn}))
        GROUP BY 1`,
      params: p.values,
    });

    const [members, quotas] = await Promise.all([membersInScope(parsed), quotasFor(r, 'Revenue')]);
    const byOwner = new Map(rows.map(row => [String(row.owner_id), row]));
    const cell = (row: Record<string, unknown> | undefined, amount: string, deals: string) => ({ amount: num(row?.[amount]), deals: num(row?.[deals]) });

    const out: ForecastRow[] = members
      .map((member): ForecastRow => {
        const row = byOwner.get(member.id);
        return {
          member,
          memberId: member.id,
          name: member.name,
          quota: Math.round(quotas.get(member.id) ?? 0),
          won: cell(row, 'won_amount', 'won_deals'),
          commit: cell(row, 'commit_amount', 'commit_deals'),
          bestCase: cell(row, 'best_amount', 'best_deals'),
          pipeline: cell(row, 'pipe_amount', 'pipe_deals'),
          omitted: cell(row, 'omit_amount', 'omit_deals'),
          lost: cell(row, 'lost_amount', 'lost_deals'),
        };
      })
      // A teammate with no number and nothing in play is noise on a forecast.
      .filter(row => row.quota > 0 || row.won.deals || row.commit.deals || row.bestCase.deals || row.pipeline.deals || row.omitted.deals || row.lost.deals || row.memberId === r.actor.id);

    const unowned = byOwner.get('none');
    if (unowned && (num(unowned.won_deals) || num(unowned.commit_deals) || num(unowned.best_deals) || num(unowned.pipe_deals) || num(unowned.omit_deals) || num(unowned.lost_deals))) {
      out.push({
        member: null,
        memberId: 'none',
        name: 'Unassigned',
        quota: 0,
        won: cell(unowned, 'won_amount', 'won_deals'),
        commit: cell(unowned, 'commit_amount', 'commit_deals'),
        bestCase: cell(unowned, 'best_amount', 'best_deals'),
        pipeline: cell(unowned, 'pipe_amount', 'pipe_deals'),
        omitted: cell(unowned, 'omit_amount', 'omit_deals'),
        lost: cell(unowned, 'lost_amount', 'lost_deals'),
      });
    }

    return { scope: scopeOutput(r), rows: out, me: r.actor.id };
  },
});
