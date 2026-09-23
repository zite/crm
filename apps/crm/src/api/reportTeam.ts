import { z } from 'zod';
import { createEndpoint } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { num, Params } from '@project/shared/server/sql';
import { parseInput } from '../server/input';
import { dealClauses, membersInScope, ownerClause, QUOTA_METRIC, quotasFor, reportMemberSchema, reportScopeOutput, reportScopeSchema, resolveScope, scopeOutput, WEIGHTED } from '../server/reports/common';

/**
 * Attainment for the period: each teammate's quota against what they actually
 * did, in whichever unit the quota is set in. Revenue and deals come from
 * closed deals; meetings and calls from logged activity.
 */

const inputSchema = reportScopeSchema.extend({ metric: QUOTA_METRIC.default('Revenue') });

export default createEndpoint({
  description: 'Quota attainment per teammate for a period, with the pipeline behind it',
  authenticated: true,
  inputSchema,
  outputSchema: z.object({
    scope: reportScopeOutput,
    metric: z.string(),
    rows: z.array(
      z.object({
        member: reportMemberSchema,
        memberId: z.string(),
        name: z.string(),
        quota: z.number(),
        actual: z.number(),
        wonDeals: z.number(),
        wonAmount: z.number(),
        openAmount: z.number(),
        openWeighted: z.number(),
      }),
    ),
    me: z.string(),
  }),
  execute: async ({ input, context }) => {
    const parsed = parseInput(inputSchema, input);
    const r = await resolveScope(parsed, context);
    const metric = parsed.metric;

    const p = new Params();
    const scope = dealClauses(p, parsed).join(' AND ');
    const f = p.add(r.from);
    const t = p.add(r.to);
    const closedIn = `d."closedAt" >= ${f}::date AND d."closedAt" < (${t}::date + 1)`;
    const { rows: dealRows } = await zite.sql({
      query: `SELECT COALESCE(NULLIF(d."ownerId", ''), 'none') AS owner_id,
                     COUNT(*) FILTER (WHERE d."status" = 'Won' AND ${closedIn}) AS won_deals,
                     COALESCE(SUM(d."amount") FILTER (WHERE d."status" = 'Won' AND ${closedIn}), 0) AS won_amount,
                     COALESCE(SUM(d."amount") FILTER (WHERE d."status" = 'Open'), 0) AS open_amount,
                     COALESCE(SUM(${WEIGHTED}) FILTER (WHERE d."status" = 'Open'), 0) AS open_weighted
              FROM "Deals" d
              LEFT JOIN "Stages" s ON s.id::text = d."stageId"
              WHERE ${scope}
              GROUP BY 1`,
      params: p.values,
    });

    let activity = new Map<string, number>();
    if (metric === 'Meetings' || metric === 'Calls') {
      const ap = new Params();
      const kind = ap.add(metric === 'Meetings' ? 'Meeting' : 'Call');
      const af = ap.add(r.from);
      const at = ap.add(r.to);
      const aOwner = ownerClause(ap, parsed, 'a."ownerId"');
      const { rows } = await zite.sql({
        query: `SELECT a."ownerId" AS owner_id, COUNT(*) AS logged
                FROM "Activities" a
                WHERE a."kind" = ${kind} AND a."occurredAt" >= ${af}::date AND a."occurredAt" < (${at}::date + 1) AND COALESCE(a."ownerId", '') <> ''${aOwner ? ` AND ${aOwner}` : ''}
                GROUP BY 1`,
        params: ap.values,
      });
      activity = new Map(rows.map(row => [String(row.owner_id), num(row.logged)]));
    }

    const [members, quotas] = await Promise.all([membersInScope(parsed), quotasFor(r, metric)]);
    const byOwner = new Map(dealRows.map(row => [String(row.owner_id), row]));

    const rows = members
      .map(member => {
        const deals = byOwner.get(member.id);
        const wonDeals = num(deals?.won_deals);
        const wonAmount = num(deals?.won_amount);
        const actual = metric === 'Revenue' ? wonAmount : metric === 'Deals Won' ? wonDeals : activity.get(member.id) ?? 0;
        return {
          member,
          memberId: member.id,
          name: member.name,
          quota: Math.round(quotas.get(member.id) ?? 0),
          actual,
          wonDeals,
          wonAmount,
          openAmount: num(deals?.open_amount),
          openWeighted: Math.round(num(deals?.open_weighted)),
        };
      })
      .filter(row => row.quota > 0 || row.actual > 0 || row.openAmount > 0 || row.memberId === r.actor.id)
      .sort((a, b) => b.actual - a.actual || a.name.localeCompare(b.name));

    return { scope: scopeOutput(r), metric, rows, me: r.actor.id };
  },
});
