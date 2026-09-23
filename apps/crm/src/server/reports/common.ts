import { z } from 'zod';
import { zite } from 'zitejs/db';
import { assertCan, getActor, type Actor } from '@project/shared/server/actor';
import { getSettings, type OrgSettings } from '@project/shared/server/settings';
import { Params, num, str } from '@project/shared/server/sql';
import { addMonths, periodEnd, periodLabel, periodStart, todayIn, type PeriodKind } from '@project/shared/dates';

/**
 * The shared plumbing behind every report: one control bar (period, pipeline,
 * team/owner) resolved once, and the SQL fragments that apply it.
 *
 * Every figure in this folder is aggregated by Postgres — no report ever pulls
 * rows into JavaScript to add them up. Period boundaries are always bound as
 * parameters (`$1::date`), never CURRENT_DATE, so the numbers agree with the
 * labels the browser drew them under.
 */

const dayStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a YYYY-MM-DD date');
const idStr = z.string().min(1).max(64);

export const reportScopeSchema = z.object({
  /** Month, Quarter or Year — quarters and years follow the fiscal year. */
  period: z.enum(['Month', 'Quarter', 'Year']).default('Quarter'),
  /** The first day of the period being looked at; defaults to the one containing today. */
  periodStart: dayStr.optional(),
  /** One pipeline, or every pipeline when absent. */
  pipelineId: idStr.optional(),
  teamId: idStr.optional(),
  /** Member ids; 'none' matches records nobody owns. */
  ownerIds: z.array(z.string().min(1).max(64)).max(60).optional(),
  today: dayStr.optional(),
});

export type ReportScope = z.infer<typeof reportScopeSchema>;

export const reportScopeOutput = z.object({
  period: z.string(),
  periodStart: z.string(),
  periodEnd: z.string(),
  periodLabel: z.string(),
  today: z.string(),
  currency: z.string(),
});

export type Resolved = {
  actor: Actor;
  settings: OrgSettings;
  today: string;
  kind: PeriodKind;
  from: string;
  to: string;
  label: string;
  scope: ReportScope;
};

/** Who is asking, what they may see, and which window the numbers cover. */
export async function resolveScope(scope: ReportScope, context: { user?: { email?: string | null } | null }): Promise<Resolved> {
  const actor = await getActor(context);
  assertCan(actor, 'reports.view');
  const settings = await getSettings();
  const today = scope.today ?? todayIn(settings.timezone);
  const kind = scope.period as PeriodKind;
  // Snap whatever the client sent to a real period boundary, so a hand-typed
  // date can never produce a window that disagrees with its own label.
  const from = periodStart(scope.periodStart ?? today, kind, settings.fiscalYearStartMonth);
  const to = periodEnd(from, kind);
  return { actor, settings, today, kind, from, to, label: periodLabel(from, kind, settings.fiscalYearStartMonth), scope };
}

export function scopeOutput(r: Resolved) {
  return { period: r.kind, periodStart: r.from, periodEnd: r.to, periodLabel: r.label, today: r.today, currency: r.settings.currency };
}

/* ---------- SQL fragments ---------- */

/** Restrict a member-id column to the chosen owners or team. Null means "everyone". */
export function ownerClause(p: Params, scope: ReportScope, column: string): string | null {
  if (scope.ownerIds?.length) {
    const real = scope.ownerIds.filter(o => o !== 'none');
    const parts: string[] = [];
    if (real.length) parts.push(`${column} IN ${p.list(real)}`);
    if (scope.ownerIds.includes('none')) parts.push(`COALESCE(${column}, '') = ''`);
    return parts.length ? `(${parts.join(' OR ')})` : null;
  }
  if (scope.teamId) return `${column} IN (SELECT id::text FROM "Members" WHERE "teamId" = ${p.add(scope.teamId)})`;
  return null;
}

/** The WHERE clauses every deal figure shares: live deals, in this pipeline, owned by these people. */
export function dealClauses(p: Params, scope: ReportScope, alias = 'd'): string[] {
  const where = [`COALESCE(${alias}."archived", false) = false`];
  if (scope.pipelineId) where.push(`${alias}."pipelineId" = ${p.add(scope.pipelineId)}`);
  const owner = ownerClause(p, scope, `${alias}."ownerId"`);
  if (owner) where.push(owner);
  return where;
}

/** A deal's weighted value: its own probability override, else its stage's. */
export const WEIGHTED = `(COALESCE(d."amount", 0) * COALESCE(d."probability", s."probability", 0) / 100.0)`;

/** The forecast bucket a deal falls in — mirrors defaultForecastCategory in @project/shared/deals. */
export const FORECAST_CATEGORY = `COALESCE(NULLIF(d."forecastCategory", ''), CASE WHEN d."status" <> 'Open' THEN 'Closed' WHEN COALESCE(d."probability", s."probability", 0) >= 80 THEN 'Commit' WHEN COALESCE(d."probability", s."probability", 0) >= 50 THEN 'Best Case' ELSE 'Pipeline' END)`;

/** When a deal opened: the explicit date, else the row's creation. */
export const OPENED = `COALESCE(d."openedAt", d.created_at)`;

/* ---------- Quotas ---------- */

export const QUOTA_METRIC = z.enum(['Revenue', 'Deals Won', 'Meetings', 'Calls']);
export type QuotaMetricValue = z.infer<typeof QUOTA_METRIC>;

/**
 * Each member's quota for a window, in the window's own units.
 *
 * A quota is set for its own month, quarter or year. When the window doesn't
 * line up (a monthly view against a quarterly quota) the overlapping quotas are
 * counted pro rata by days, so the target always covers exactly the days on
 * screen. A quota set for the same kind of period as the window wins outright,
 * so an exact match is never diluted by a broader one.
 */
export async function quotasFor(r: Resolved, metric: QuotaMetricValue, from = r.from, to = r.to): Promise<Map<string, number>> {
  const p = new Params();
  const m = p.add(metric);
  const f = p.add(from);
  const t = p.add(to);
  const kind = p.add(r.kind);
  const owner = ownerClause(p, r.scope, 'q."memberId"');
  const { rows } = await zite.sql({
    query: `
      WITH quota_spans AS (
        SELECT q."memberId" AS member_id, q."period" AS kind, COALESCE(q."target", 0)::numeric AS target,
               q."periodStart"::date AS span_from,
               ((q."periodStart"::date + (CASE q."period" WHEN 'Month' THEN INTERVAL '1 month' WHEN 'Year' THEN INTERVAL '1 year' ELSE INTERVAL '3 months' END))::date - 1) AS span_to
        FROM "Quotas" q
        WHERE q."metric" = ${m} AND COALESCE(q."memberId", '') <> '' AND q."periodStart" IS NOT NULL${owner ? ` AND ${owner}` : ''}
      ),
      quota_share AS (
        SELECT member_id, kind,
               target * (GREATEST(0, LEAST(span_to, ${t}::date) - GREATEST(span_from, ${f}::date) + 1)::numeric / NULLIF(span_to - span_from + 1, 0)::numeric) AS share
        FROM quota_spans
        WHERE span_to >= ${f}::date AND span_from <= ${t}::date
      )
      SELECT member_id, COALESCE(SUM(share) FILTER (WHERE kind = ${kind}), SUM(share)) AS quota
      FROM quota_share
      GROUP BY member_id`,
    params: p.values,
  });
  const out = new Map<string, number>();
  for (const row of rows) out.set(String(row.member_id), num(row.quota));
  return out;
}

/* ---------- Members ---------- */

export type ReportMember = { id: string; name: string; email: string; role: string; teamId: string | null; color: string | null; avatarUrl: string | null };

export const reportMemberSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  role: z.string(),
  teamId: z.string().nullable(),
  color: z.string().nullable(),
  avatarUrl: z.string().nullable(),
});

/** The people a report has rows for: active teammates, narrowed by the control bar. */
export async function membersInScope(scope: ReportScope): Promise<ReportMember[]> {
  const p = new Params();
  const owner = ownerClause(p, scope, 'm.id::text');
  const { rows } = await zite.sql({
    query: `SELECT m.id, m."name", m."email", m."role", m."teamId", m."color", m."avatarUrl"
            FROM "Members" m
            WHERE m."status" <> 'Deactivated'${owner ? ` AND ${owner}` : ''}
            ORDER BY LOWER(m."name")`,
    params: p.values,
  });
  return rows.map(row => ({
    id: String(row.id),
    name: str(row.name) ?? '',
    email: str(row.email) ?? '',
    role: str(row.role) || 'Rep',
    teamId: str(row.teamId) || null,
    color: str(row.color) || null,
    avatarUrl: str(row.avatarUrl) || null,
  }));
}

/* ---------- Calendar helpers ---------- */

/** The 12 months ending with `endMonth` (a 'YYYY-MM-01' day), oldest first. */
export function twelveMonthsTo(endMonth: string): string[] {
  const months: string[] = [];
  for (let i = 11; i >= 0; i--) months.push(addMonths(endMonth, -i).slice(0, 7));
  return months;
}

export const monthLabel = (month: string) => {
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const [y, m] = month.split('-');
  return `${names[Number(m) - 1] ?? ''} ${y.slice(2)}`;
};
