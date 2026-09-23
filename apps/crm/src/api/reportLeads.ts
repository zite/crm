import { z } from 'zod';
import { createEndpoint } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { num, numOrNull, Params, str } from '@project/shared/server/sql';
import { addDays, startOfWeek } from '@project/shared/dates';
import { parseInput } from '../server/input';
import { ownerClause, reportScopeOutput, reportScopeSchema, resolveScope, scopeOutput } from '../server/reports/common';

/**
 * Where inbound comes from, what happens to it, and how long people wait for a
 * reply. A lead belongs to the period it arrived in, so a source's conversion
 * is always measured on the same cohort it was counted in.
 */

const inputSchema = reportScopeSchema;

/** Leads are dated by arrival; a lead imported without a date falls back to its row. */
const RECEIVED = `COALESCE(l."receivedAt", l.created_at)`;

export default createEndpoint({
  description: 'Inbound lead volume by source and week, conversion to deals, response time and disqualify reasons',
  authenticated: true,
  inputSchema,
  outputSchema: z.object({
    scope: reportScopeOutput,
    weeks: z.array(z.object({ week: z.string(), label: z.string() })),
    bySource: z.array(z.object({ source: z.string(), leads: z.number(), worked: z.number(), qualified: z.number(), deals: z.number(), won: z.number(), wonAmount: z.number() })),
    cells: z.array(z.object({ source: z.string(), week: z.string(), leads: z.number() })),
    funnel: z.object({ leads: z.number(), worked: z.number(), qualified: z.number(), deals: z.number(), won: z.number(), wonAmount: z.number() }),
    response: z.object({ responded: z.number(), unanswered: z.number(), avgHours: z.number().nullable(), medianHours: z.number().nullable(), withinTarget: z.number(), targetHours: z.number() }),
    disqualified: z.array(z.object({ reason: z.string(), leads: z.number() })),
  }),
  execute: async ({ input, context }) => {
    const parsed = parseInput(inputSchema, input);
    const r = await resolveScope(parsed, context);
    const targetHours = r.settings.preferences.leadResponseHours;

    const firstWeek = startOfWeek(r.from);
    const weeks: string[] = [];
    for (let day = firstWeek; day <= r.to; day = addDays(day, 7)) weeks.push(day);

    const sp = new Params();
    const sf = sp.add(r.from);
    const st = sp.add(r.to);
    const sOwner = ownerClause(sp, parsed, 'l."ownerId"');
    const inPeriod = `${RECEIVED} >= ${sf}::date AND ${RECEIVED} < (${st}::date + 1)${sOwner ? ` AND ${sOwner}` : ''}`;

    const { rows: sourceRows } = await zite.sql({
      query: `SELECT COALESCE(NULLIF(l."source", ''), 'Not recorded') AS source,
                     COUNT(*) AS leads,
                     COUNT(*) FILTER (WHERE l."status" <> 'New') AS worked,
                     COUNT(*) FILTER (WHERE l."status" = 'Qualified') AS qualified,
                     COUNT(*) FILTER (WHERE COALESCE(l."convertedDealId", '') <> '') AS deals,
                     COUNT(*) FILTER (WHERE dl."status" = 'Won') AS won,
                     COALESCE(SUM(dl."amount") FILTER (WHERE dl."status" = 'Won'), 0) AS won_amount
              FROM "Leads" l
              LEFT JOIN "Deals" dl ON dl.id::text = l."convertedDealId"
              WHERE ${inPeriod}
              GROUP BY 1
              ORDER BY 2 DESC, 1`,
      params: sp.values,
    });

    const wp = new Params();
    const wf = wp.add(firstWeek);
    const wt = wp.add(r.to);
    const wOwner = ownerClause(wp, parsed, 'l."ownerId"');
    const { rows: weekRows } = await zite.sql({
      query: `SELECT COALESCE(NULLIF(l."source", ''), 'Not recorded') AS source, to_char(date_trunc('week', ${RECEIVED}), 'YYYY-MM-DD') AS week, COUNT(*) AS leads
              FROM "Leads" l
              WHERE ${RECEIVED} >= ${wf}::date AND ${RECEIVED} < (${wt}::date + 1)${wOwner ? ` AND ${wOwner}` : ''}
              GROUP BY 1, 2`,
      params: wp.values,
    });

    const rp = new Params();
    const rf = rp.add(r.from);
    const rt = rp.add(r.to);
    const rTarget = rp.add(targetHours);
    const rOwner = ownerClause(rp, parsed, 'l."ownerId"');
    const hours = `EXTRACT(EPOCH FROM (l."firstResponseAt" - ${RECEIVED})) / 3600.0`;
    const { rows: responseRows } = await zite.sql({
      query: `SELECT COUNT(*) FILTER (WHERE l."firstResponseAt" IS NOT NULL) AS responded,
                     COUNT(*) FILTER (WHERE l."firstResponseAt" IS NULL) AS unanswered,
                     AVG(${hours}) FILTER (WHERE l."firstResponseAt" IS NOT NULL AND l."firstResponseAt" >= ${RECEIVED}) AS avg_hours,
                     PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY CASE WHEN l."firstResponseAt" IS NOT NULL AND l."firstResponseAt" >= ${RECEIVED} THEN ${hours} END) AS median_hours,
                     COUNT(*) FILTER (WHERE l."firstResponseAt" IS NOT NULL AND ${hours} <= ${rTarget}) AS within_target
              FROM "Leads" l
              WHERE ${RECEIVED} >= ${rf}::date AND ${RECEIVED} < (${rt}::date + 1)${rOwner ? ` AND ${rOwner}` : ''}`,
      params: rp.values,
    });
    const resp = responseRows[0] ?? {};

    const dp = new Params();
    const df = dp.add(r.from);
    const dt = dp.add(r.to);
    const dOwner = ownerClause(dp, parsed, 'l."ownerId"');
    const { rows: disqualifiedRows } = await zite.sql({
      query: `SELECT COALESCE(NULLIF(l."disqualifyReason", ''), 'No reason given') AS reason, COUNT(*) AS leads
              FROM "Leads" l
              WHERE l."status" = 'Disqualified' AND ${RECEIVED} >= ${df}::date AND ${RECEIVED} < (${dt}::date + 1)${dOwner ? ` AND ${dOwner}` : ''}
              GROUP BY 1
              ORDER BY 2 DESC, 1`,
      params: dp.values,
    });

    const bySource = sourceRows.map(row => ({
      source: str(row.source) ?? '',
      leads: num(row.leads),
      worked: num(row.worked),
      qualified: num(row.qualified),
      deals: num(row.deals),
      won: num(row.won),
      wonAmount: num(row.won_amount),
    }));
    const funnel = bySource.reduce(
      (total, row) => ({
        leads: total.leads + row.leads,
        worked: total.worked + row.worked,
        qualified: total.qualified + row.qualified,
        deals: total.deals + row.deals,
        won: total.won + row.won,
        wonAmount: total.wonAmount + row.wonAmount,
      }),
      { leads: 0, worked: 0, qualified: 0, deals: 0, won: 0, wonAmount: 0 },
    );

    const round = (value: number | null) => (value == null ? null : Math.round(value * 10) / 10);

    return {
      scope: scopeOutput(r),
      weeks: weeks.map(week => ({ week, label: weekLabel(week) })),
      bySource,
      cells: weekRows.map(row => ({ source: str(row.source) ?? '', week: str(row.week) ?? '', leads: num(row.leads) })),
      funnel,
      response: {
        responded: num(resp.responded),
        unanswered: num(resp.unanswered),
        avgHours: round(numOrNull(resp.avg_hours)),
        medianHours: round(numOrNull(resp.median_hours)),
        withinTarget: num(resp.within_target),
        targetHours,
      },
      disqualified: disqualifiedRows.map(row => ({ reason: str(row.reason) ?? '', leads: num(row.leads) })),
    };
  },
});

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function weekLabel(week: string) {
  return `${MONTHS[Number(week.slice(5, 7)) - 1] ?? ''} ${Number(week.slice(8, 10))}`;
}
