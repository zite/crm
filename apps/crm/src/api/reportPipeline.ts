import { z } from 'zod';
import { createEndpoint } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { num, numOrNull, Params, str } from '@project/shared/server/sql';
import { parseInput } from '../server/input';
import { dealClauses, monthLabel, OPENED, quotasFor, reportScopeOutput, reportScopeSchema, resolveScope, scopeOutput, twelveMonthsTo, WEIGHTED } from '../server/reports/common';

/**
 * The two pipeline-shaped reports: the Overview a sales lead opens first, and
 * the Pipeline report underneath it. They share a scope and most of their SQL,
 * so one endpoint serves both and `view` decides how much work to do.
 *
 * Everything here is aggregated by Postgres. Nothing counts rows in the browser.
 */

const inputSchema = reportScopeSchema.extend({ view: z.enum(['overview', 'pipeline']).default('overview') });

const stageRow = z.object({
  stageId: z.string(),
  stageName: z.string(),
  pipelineId: z.string(),
  pipelineName: z.string(),
  position: z.number(),
  deals: z.number(),
  amount: z.number(),
  weighted: z.number(),
});

export default createEndpoint({
  description: 'Headline pipeline figures, stage breakdown, win/loss reasons and the pipeline funnel',
  authenticated: true,
  inputSchema,
  outputSchema: z.object({
    scope: reportScopeOutput,
    summary: z.object({
      openCount: z.number(),
      openAmount: z.number(),
      openWeighted: z.number(),
      closingCount: z.number(),
      closingAmount: z.number(),
      closingWeighted: z.number(),
      wonCount: z.number(),
      wonAmount: z.number(),
      lostCount: z.number(),
      lostAmount: z.number(),
      quota: z.number(),
      cycleDays: z.number().nullable(),
      cycleSample: z.number(),
    }),
    months: z.array(z.object({ month: z.string(), label: z.string(), createdCount: z.number(), createdAmount: z.number(), wonCount: z.number(), wonAmount: z.number(), lostCount: z.number(), lostAmount: z.number() })),
    currentMonth: z.string(),
    byStage: z.array(stageRow),
    lostByReason: z.array(z.object({ reason: z.string(), deals: z.number(), amount: z.number() })),
    funnel: z.array(z.object({ stageId: z.string(), stageName: z.string(), position: z.number(), reached: z.number(), amount: z.number() })),
    cohort: z.object({ total: z.number(), won: z.number(), wonAmount: z.number(), lost: z.number(), open: z.number() }),
    stageTiming: z.array(z.object({ stageId: z.string(), stageName: z.string(), position: z.number(), avgDays: z.number().nullable(), moves: z.number() })),
    stalledByStage: z.array(z.object({ stageId: z.string(), stageName: z.string(), position: z.number(), deals: z.number(), amount: z.number() })),
  }),
  execute: async ({ input, context }) => {
    const parsed = parseInput(inputSchema, input);
    const r = await resolveScope(parsed, context);

    /* ---- Headline figures: one round trip, every figure its own subquery. ---- */
    const p = new Params();
    const scope = dealClauses(p, parsed).join(' AND ');
    const f = p.add(r.from);
    const t = p.add(r.to);
    const closedIn = `d."closedAt" >= ${f}::date AND d."closedAt" < (${t}::date + 1)`;
    const closingIn = `d."closeDate" >= ${f}::date AND d."closeDate" <= ${t}::date`;
    const { rows: summaryRows } = await zite.sql({
      query: `
        SELECT
          (SELECT COUNT(*) FROM "Deals" d WHERE ${scope} AND d."status" = 'Open') AS open_count,
          (SELECT COALESCE(SUM(d."amount"), 0) FROM "Deals" d WHERE ${scope} AND d."status" = 'Open') AS open_amount,
          (SELECT COALESCE(SUM(${WEIGHTED}), 0) FROM "Deals" d LEFT JOIN "Stages" s ON s.id::text = d."stageId" WHERE ${scope} AND d."status" = 'Open') AS open_weighted,
          (SELECT COUNT(*) FROM "Deals" d WHERE ${scope} AND d."status" = 'Open' AND ${closingIn}) AS closing_count,
          (SELECT COALESCE(SUM(d."amount"), 0) FROM "Deals" d WHERE ${scope} AND d."status" = 'Open' AND ${closingIn}) AS closing_amount,
          (SELECT COALESCE(SUM(${WEIGHTED}), 0) FROM "Deals" d LEFT JOIN "Stages" s ON s.id::text = d."stageId" WHERE ${scope} AND d."status" = 'Open' AND ${closingIn}) AS closing_weighted,
          (SELECT COUNT(*) FROM "Deals" d WHERE ${scope} AND d."status" = 'Won' AND ${closedIn}) AS won_count,
          (SELECT COALESCE(SUM(d."amount"), 0) FROM "Deals" d WHERE ${scope} AND d."status" = 'Won' AND ${closedIn}) AS won_amount,
          (SELECT COUNT(*) FROM "Deals" d WHERE ${scope} AND d."status" = 'Lost' AND ${closedIn}) AS lost_count,
          (SELECT COALESCE(SUM(d."amount"), 0) FROM "Deals" d WHERE ${scope} AND d."status" = 'Lost' AND ${closedIn}) AS lost_amount,
          (SELECT AVG(EXTRACT(EPOCH FROM (d."closedAt" - ${OPENED})) / 86400.0) FROM "Deals" d WHERE ${scope} AND d."status" = 'Won' AND ${closedIn} AND ${OPENED} IS NOT NULL AND d."closedAt" >= ${OPENED}) AS cycle_days,
          (SELECT COUNT(*) FROM "Deals" d WHERE ${scope} AND d."status" = 'Won' AND ${closedIn} AND ${OPENED} IS NOT NULL AND d."closedAt" >= ${OPENED}) AS cycle_sample`,
      params: p.values,
    });
    const s0 = summaryRows[0] ?? {};

    /* ---- Quota for the window, so "won vs quota" and coverage can be read together. ---- */
    const quotas = await quotasFor(r, 'Revenue');
    let quota = 0;
    for (const value of quotas.values()) quota += value;

    /* ---- Twelve months of created and closed, for the trend and the created-vs-closed bars. ---- */
    // The window ends with the period, unless the period runs past today.
    const anchor = r.to.slice(0, 7) > r.today.slice(0, 7) ? r.today.slice(0, 7) : r.to.slice(0, 7);
    const months = twelveMonthsTo(`${anchor}-01`);
    const windowFrom = `${months[0]}-01`;
    const windowTo = `${anchor}-01`;

    const mp = new Params();
    const mScope = dealClauses(mp, parsed).join(' AND ');
    const mf = mp.add(windowFrom);
    const mt = mp.add(windowTo);
    const [{ rows: createdRows }, { rows: closedRows }] = await Promise.all([
      zite.sql({
        query: `SELECT to_char(date_trunc('month', ${OPENED}), 'YYYY-MM') AS month, COUNT(*) AS deals, COALESCE(SUM(d."amount"), 0) AS amount
                FROM "Deals" d
                WHERE ${mScope} AND ${OPENED} >= ${mf}::date AND ${OPENED} < ((${mt}::date + INTERVAL '1 month')::date)
                GROUP BY 1`,
        params: mp.values,
      }),
      zite.sql({
        query: `SELECT to_char(date_trunc('month', d."closedAt"), 'YYYY-MM') AS month, d."status" AS status, COUNT(*) AS deals, COALESCE(SUM(d."amount"), 0) AS amount
                FROM "Deals" d
                WHERE ${mScope} AND d."status" IN ('Won', 'Lost') AND d."closedAt" >= ${mf}::date AND d."closedAt" < ((${mt}::date + INTERVAL '1 month')::date)
                GROUP BY 1, 2`,
        params: mp.values,
      }),
    ]);
    const created = new Map(createdRows.map(row => [String(row.month), row]));
    const won = new Map(closedRows.filter(row => row.status === 'Won').map(row => [String(row.month), row]));
    const lost = new Map(closedRows.filter(row => row.status === 'Lost').map(row => [String(row.month), row]));
    const monthSeries = months.map(month => ({
      month,
      label: monthLabel(month),
      createdCount: num(created.get(month)?.deals),
      createdAmount: num(created.get(month)?.amount),
      wonCount: num(won.get(month)?.deals),
      wonAmount: num(won.get(month)?.amount),
      lostCount: num(lost.get(month)?.deals),
      lostAmount: num(lost.get(month)?.amount),
    }));

    /* ---- Open deals by stage. Stages come first so an empty lane still has a row. ---- */
    const sp = new Params();
    const sScope = dealClauses(sp, parsed).join(' AND ');
    const stagePipeline = parsed.pipelineId ? ` AND s."pipelineId" = ${sp.add(parsed.pipelineId)}` : '';
    const { rows: stageRows } = await zite.sql({
      query: `SELECT s.id AS stage_id, s."name" AS stage_name, s."pipelineId" AS pipeline_id, pl."name" AS pipeline_name, s."position" AS position,
                     COUNT(d.id) AS deals, COALESCE(SUM(d."amount"), 0) AS amount, COALESCE(SUM(${WEIGHTED}), 0) AS weighted
              FROM "Stages" s
              JOIN "Pipelines" pl ON pl.id::text = s."pipelineId"
              LEFT JOIN "Deals" d ON d."stageId" = s.id::text AND d."status" = 'Open' AND ${sScope}
              WHERE s."kind" = 'Open' AND COALESCE(s."archived", false) = false AND COALESCE(pl."archived", false) = false${stagePipeline}
              GROUP BY s.id, s."name", s."pipelineId", pl."name", s."position", pl."position"
              ORDER BY pl."position", s."position"`,
      params: sp.values,
    });

    /* ---- Why deals were lost in the window. ---- */
    const lp = new Params();
    const lScope = dealClauses(lp, parsed).join(' AND ');
    const lf = lp.add(r.from);
    const lt = lp.add(r.to);
    const { rows: reasonRows } = await zite.sql({
      query: `SELECT COALESCE(NULLIF(d."lostReason", ''), 'No reason given') AS reason, COUNT(*) AS deals, COALESCE(SUM(d."amount"), 0) AS amount
              FROM "Deals" d
              WHERE ${lScope} AND d."status" = 'Lost' AND d."closedAt" >= ${lf}::date AND d."closedAt" < (${lt}::date + 1)
              GROUP BY 1
              ORDER BY 3 DESC, 1`,
      params: lp.values,
    });

    const base = {
      scope: scopeOutput(r),
      summary: {
        openCount: num(s0.open_count),
        openAmount: num(s0.open_amount),
        openWeighted: Math.round(num(s0.open_weighted)),
        closingCount: num(s0.closing_count),
        closingAmount: num(s0.closing_amount),
        closingWeighted: Math.round(num(s0.closing_weighted)),
        wonCount: num(s0.won_count),
        wonAmount: num(s0.won_amount),
        lostCount: num(s0.lost_count),
        lostAmount: num(s0.lost_amount),
        quota: Math.round(quota),
        cycleDays: s0.cycle_days == null ? null : Math.round(num(s0.cycle_days) * 10) / 10,
        cycleSample: num(s0.cycle_sample),
      },
      months: monthSeries,
      currentMonth: r.today.slice(0, 7),
      byStage: stageRows.map(row => ({
        stageId: String(row.stage_id),
        stageName: str(row.stage_name) ?? '',
        pipelineId: String(row.pipeline_id),
        pipelineName: str(row.pipeline_name) ?? '',
        position: num(row.position),
        deals: num(row.deals),
        amount: num(row.amount),
        weighted: Math.round(num(row.weighted)),
      })),
      lostByReason: reasonRows.map(row => ({ reason: str(row.reason) ?? '', deals: num(row.deals), amount: num(row.amount) })),
    };

    if (parsed.view !== 'pipeline' || !parsed.pipelineId) {
      return { ...base, funnel: [], cohort: { total: 0, won: 0, wonAmount: 0, lost: 0, open: 0 }, stageTiming: [], stalledByStage: [] };
    }

    /* ---- The funnel: deals that opened in the window, and how far each one got. ---- */
    const fp = new Params();
    const fScope = dealClauses(fp, parsed).join(' AND ');
    const pipe = fp.add(parsed.pipelineId);
    const ff = fp.add(r.from);
    const ft = fp.add(r.to);
    const cohortSql = `SELECT d.id::text AS deal_id, COALESCE(d."amount", 0) AS amount, d."status" AS status, d."stageId" AS stage_id
                       FROM "Deals" d
                       WHERE ${fScope} AND d."pipelineId" = ${pipe} AND ${OPENED} >= ${ff}::date AND ${OPENED} < (${ft}::date + 1)`;
    // How far a deal got is the furthest OPEN stage it ever entered — the won and
    // lost stages sit after them by position, so counting those would say a lost
    // deal had reached "won".
    const { rows: funnelRows } = await zite.sql({
      query: `
        WITH deal_pool AS (${cohortSql}),
        furthest AS (
          SELECT dp.deal_id, dp.amount,
            GREATEST(
              COALESCE((SELECT MAX(sh."position") FROM "StageChanges" sc JOIN "Stages" sh ON sh.id::text = sc."toStageId" WHERE sc."dealId" = dp.deal_id AND sh."pipelineId" = ${pipe} AND sh."kind" = 'Open'), -1),
              COALESCE((SELECT sn."position" FROM "Stages" sn WHERE sn.id::text = dp.stage_id AND sn."kind" = 'Open'), -1)
            ) AS open_position
          FROM deal_pool dp
        )
        SELECT st.id AS stage_id, st."name" AS stage_name, st."position" AS position,
               COUNT(fu.deal_id) FILTER (WHERE fu.open_position >= st."position") AS reached,
               COALESCE(SUM(fu.amount) FILTER (WHERE fu.open_position >= st."position"), 0) AS amount
        FROM "Stages" st
        LEFT JOIN furthest fu ON true
        WHERE st."pipelineId" = ${pipe} AND st."kind" = 'Open' AND COALESCE(st."archived", false) = false
        GROUP BY st.id, st."name", st."position"
        ORDER BY st."position"`,
      params: fp.values,
    });

    const cp = new Params();
    const cScope = dealClauses(cp, parsed).join(' AND ');
    const cPipe = cp.add(parsed.pipelineId);
    const cf = cp.add(r.from);
    const ct = cp.add(r.to);
    const { rows: cohortRows } = await zite.sql({
      query: `SELECT COUNT(*) AS total,
                     COUNT(*) FILTER (WHERE d."status" = 'Won') AS won,
                     COALESCE(SUM(d."amount") FILTER (WHERE d."status" = 'Won'), 0) AS won_amount,
                     COUNT(*) FILTER (WHERE d."status" = 'Lost') AS lost,
                     COUNT(*) FILTER (WHERE d."status" = 'Open') AS still_open
              FROM "Deals" d
              WHERE ${cScope} AND d."pipelineId" = ${cPipe} AND ${OPENED} >= ${cf}::date AND ${OPENED} < (${ct}::date + 1)`,
      params: cp.values,
    });
    const c0 = cohortRows[0] ?? {};

    /* ---- How long a deal sits in each stage, from the stage history. ---- */
    const tp = new Params();
    const tScope = dealClauses(tp, parsed).join(' AND ');
    const tPipe = tp.add(parsed.pipelineId);
    const tf = tp.add(r.from);
    const tt = tp.add(r.to);
    const { rows: timingRows } = await zite.sql({
      query: `
        WITH moves AS (
          SELECT sc."toStageId" AS stage_id, sc."changedAt" AS entered_at,
                 LEAD(sc."changedAt") OVER (PARTITION BY sc."dealId" ORDER BY sc."changedAt") AS left_at
          FROM "StageChanges" sc
          JOIN "Deals" d ON d.id::text = sc."dealId"
          WHERE ${tScope} AND sc."pipelineId" = ${tPipe}
        )
        SELECT st.id AS stage_id, st."name" AS stage_name, st."position" AS position,
               AVG(EXTRACT(EPOCH FROM (mv.left_at - mv.entered_at)) / 86400.0) AS avg_days,
               COUNT(mv.stage_id) AS moves
        FROM "Stages" st
        LEFT JOIN moves mv ON mv.stage_id = st.id::text AND mv.left_at IS NOT NULL AND mv.left_at >= ${tf}::date AND mv.left_at < (${tt}::date + 1)
        WHERE st."pipelineId" = ${tPipe} AND st."kind" = 'Open' AND COALESCE(st."archived", false) = false
        GROUP BY st.id, st."name", st."position"
        ORDER BY st."position"`,
      params: tp.values,
    });

    /* ---- Stalled: open deals past their stage's day limit, right now. ---- */
    const xp = new Params();
    const xScope = dealClauses(xp, parsed).join(' AND ');
    const xPipe = xp.add(parsed.pipelineId);
    const xToday = xp.add(r.today);
    const { rows: stalledRows } = await zite.sql({
      query: `SELECT st.id AS stage_id, st."name" AS stage_name, st."position" AS position,
                     COUNT(d.id) AS deals, COALESCE(SUM(d."amount"), 0) AS amount
              FROM "Stages" st
              LEFT JOIN "Deals" d ON d."stageId" = st.id::text AND d."status" = 'Open' AND ${xScope}
                   AND COALESCE(st."rottingDays", 0) > 0 AND d."stageEnteredAt" < (${xToday}::date - st."rottingDays"::int)
              WHERE st."pipelineId" = ${xPipe} AND st."kind" = 'Open' AND COALESCE(st."archived", false) = false
              GROUP BY st.id, st."name", st."position"
              ORDER BY st."position"`,
      params: xp.values,
    });

    return {
      ...base,
      funnel: funnelRows.map(row => ({ stageId: String(row.stage_id), stageName: str(row.stage_name) ?? '', position: num(row.position), reached: num(row.reached), amount: num(row.amount) })),
      cohort: { total: num(c0.total), won: num(c0.won), wonAmount: num(c0.won_amount), lost: num(c0.lost), open: num(c0.still_open) },
      stageTiming: timingRows.map(row => {
        const avg = numOrNull(row.avg_days);
        return { stageId: String(row.stage_id), stageName: str(row.stage_name) ?? '', position: num(row.position), avgDays: avg == null ? null : Math.round(avg * 10) / 10, moves: num(row.moves) };
      }),
      stalledByStage: stalledRows.map(row => ({ stageId: String(row.stage_id), stageName: str(row.stage_name) ?? '', position: num(row.position), deals: num(row.deals), amount: num(row.amount) })),
    };
  },
});
