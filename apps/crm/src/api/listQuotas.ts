import { z } from 'zod';
import { createEndpoint } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { can } from '@project/shared/server/actor';
import { num, Params, str } from '@project/shared/server/sql';
import { periodEnd, periodLabel, periodStart, shiftPeriod } from '@project/shared/dates';
import { parseInput } from '../server/input';
import { QUOTA_METRIC, reportMemberSchema, reportScopeSchema, resolveScope } from '../server/reports/common';

/**
 * Quotas for one period and metric, one row per active teammate, with the
 * previous period alongside so "copy last period" has something to copy.
 */

const inputSchema = reportScopeSchema.extend({ metric: QUOTA_METRIC.default('Revenue') });

export default createEndpoint({
  description: 'Quota targets per teammate for a period and metric, with the previous period for comparison',
  authenticated: true,
  inputSchema,
  outputSchema: z.object({
    period: z.string(),
    periodStart: z.string(),
    periodEnd: z.string(),
    periodLabel: z.string(),
    previousStart: z.string(),
    previousLabel: z.string(),
    metric: z.string(),
    canManage: z.boolean(),
    rows: z.array(
      z.object({
        member: reportMemberSchema,
        memberId: z.string(),
        name: z.string(),
        role: z.string(),
        target: z.number().nullable(),
        previousTarget: z.number().nullable(),
        quotaId: z.string().nullable(),
      }),
    ),
  }),
  execute: async ({ input, context }) => {
    const parsed = parseInput(inputSchema, input);
    const r = await resolveScope(parsed, context);
    const previous = shiftPeriod(r.from, r.kind, -1);

    const p = new Params();
    const metric = p.add(parsed.metric);
    const kind = p.add(r.kind);
    const current = p.add(r.from);
    const prior = p.add(previous);
    const { rows } = await zite.sql({
      query: `SELECT m.id AS member_id, m."name" AS name, m."email" AS email, m."role" AS role, m."teamId" AS team_id, m."color" AS color, m."avatarUrl" AS avatar_url,
                     qc.id AS quota_id, qc."target" AS target, qp."target" AS previous_target
              FROM "Members" m
              LEFT JOIN "Quotas" qc ON qc."memberId" = m.id::text AND qc."metric" = ${metric} AND qc."period" = ${kind} AND qc."periodStart" = ${current}::date
              LEFT JOIN "Quotas" qp ON qp."memberId" = m.id::text AND qp."metric" = ${metric} AND qp."period" = ${kind} AND qp."periodStart" = ${prior}::date
              WHERE m."status" <> 'Deactivated'
              ORDER BY LOWER(m."name")`,
      params: p.values,
    });

    return {
      period: r.kind,
      periodStart: r.from,
      periodEnd: periodEnd(r.from, r.kind),
      periodLabel: r.label,
      previousStart: previous,
      previousLabel: periodLabel(periodStart(previous, r.kind, r.settings.fiscalYearStartMonth), r.kind, r.settings.fiscalYearStartMonth),
      metric: parsed.metric,
      canManage: can(r.actor.role, 'quotas.manage'),
      rows: rows.map(row => ({
        member: {
          id: String(row.member_id),
          name: str(row.name) ?? '',
          email: str(row.email) ?? '',
          role: str(row.role) || 'Rep',
          teamId: str(row.team_id) || null,
          color: str(row.color) || null,
          avatarUrl: str(row.avatar_url) || null,
        },
        memberId: String(row.member_id),
        name: str(row.name) ?? '',
        role: str(row.role) || 'Rep',
        target: row.target == null ? null : num(row.target),
        previousTarget: row.previous_target == null ? null : num(row.previous_target),
        quotaId: row.quota_id == null ? null : String(row.quota_id),
      })),
    };
  },
});
