import { z } from 'zod';
import { createEndpoint } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { getActor } from '@project/shared/server/actor';
import { getSettings } from '@project/shared/server/settings';
import { toActivityRow } from '@project/shared/server/activities';
import { Params, num, str } from '@project/shared/server/sql';
import { todayIn } from '@project/shared/dates';
import { ACTIVITY_KINDS, ACTIVITY_OUTCOMES, DIRECTIONS } from '@project/shared/constants';
import { day, id, parseInput } from '../server/input';
import { activityRowSchema } from '../server/schemas';

/**
 * Every activity in the organization, filtered — the Monday-morning read, and
 * the meetings agenda. `getTimeline` answers "what happened on this record";
 * this answers "what happened across the team".
 *
 * `from`/`to` are calendar days bound as parameters (never CURRENT_DATE); the
 * client sends its own local day.
 */

const filters = z.object({
  kinds: z.array(z.enum(ACTIVITY_KINDS)).optional(),
  /** Member ids; 'none' matches activities with no owner. */
  ownerIds: z.array(z.string()).optional(),
  teamId: id.optional(),
  from: day.optional(),
  to: day.optional(),
  outcomes: z.array(z.enum(ACTIVITY_OUTCOMES)).optional(),
  /** true: only activities with an outcome recorded; false: only those without. */
  hasOutcome: z.boolean().optional(),
  direction: z.enum(DIRECTIONS).optional(),
  relatedTo: z.enum(['company', 'contact', 'deal', 'lead', 'none']).optional(),
  companyId: id.optional(),
  contactId: id.optional(),
  dealId: id.optional(),
  leadId: id.optional(),
  search: z.string().max(120).optional(),
});

const inputSchema = z.object({
  filters: filters.default({}),
  sort: z.enum(['asc', 'desc']).optional(),
  limit: z.number().int().min(1).max(500).optional(),
  today: z.string().optional(),
});

export default createEndpoint({
  description: 'List activities across the organization with filters (the activity log and the meetings agenda)',
  authenticated: true,
  inputSchema,
  outputSchema: z.object({
    activities: z.array(activityRowSchema),
    /** Matching every filter EXCEPT `kinds`, so a kind tab row can show all its counts at once. */
    total: z.number(),
    byKind: z.object({ Note: z.number(), Call: z.number(), Email: z.number(), Meeting: z.number() }),
    today: z.string(),
  }),
  execute: async ({ input, context }) => {
    const { filters: f, sort = 'desc', limit = 200, today: t } = parseInput(inputSchema, input);
    await getActor(context);
    const settings = await getSettings();
    const today = t && /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : todayIn(settings.timezone);

    // Built twice: once with the kind filter for the rows, once without it so the
    // kind tabs can show how many Calls exist under the *other* filters.
    const build = (withKinds: boolean) => {
      const p = new Params();
      const where: string[] = [];
      if (withKinds && f.kinds?.length) where.push(`a."kind" IN ${p.list(f.kinds)}`);
      if (f.ownerIds?.length) {
        const real = f.ownerIds.filter(o => o !== 'none');
        const parts: string[] = [];
        if (real.length) parts.push(`a."ownerId" IN ${p.list(real)}`);
        if (f.ownerIds.includes('none')) parts.push(`COALESCE(a."ownerId", '') = ''`);
        where.push(`(${parts.join(' OR ')})`);
      }
      if (f.teamId) where.push(`a."ownerId" IN (SELECT id::text FROM "Members" WHERE "teamId" = ${p.add(f.teamId)})`);
      if (f.from) where.push(`a."occurredAt" >= ${p.add(f.from)}::date`);
      if (f.to) where.push(`a."occurredAt" < (${p.add(f.to)}::date + 1)`);
      if (f.outcomes?.length) where.push(`a."outcome" IN ${p.list(f.outcomes)}`);
      if (f.hasOutcome === true) where.push(`COALESCE(a."outcome", '') <> ''`);
      if (f.hasOutcome === false) where.push(`COALESCE(a."outcome", '') = ''`);
      if (f.direction) where.push(`a."direction" = ${p.add(f.direction)}`);
      if (f.relatedTo === 'none') {
        where.push(`COALESCE(a."companyId", '') = '' AND COALESCE(a."contactId", '') = '' AND COALESCE(a."dealId", '') = '' AND COALESCE(a."leadId", '') = ''`);
      } else if (f.relatedTo) {
        where.push(`COALESCE(a."${f.relatedTo}Id", '') <> ''`);
      }
      for (const [key, value] of [['companyId', f.companyId], ['contactId', f.contactId], ['dealId', f.dealId], ['leadId', f.leadId]] as const) {
        if (value) where.push(`a."${key}" = ${p.add(value)}`);
      }
      if (f.search?.trim()) {
        const like = p.add(`%${f.search.trim().toLowerCase()}%`);
        where.push(`(LOWER(a."subject") LIKE ${like} OR LOWER(a."body") LIKE ${like} OR LOWER(a."location") LIKE ${like})`);
      }
      return { clause: where.length ? `WHERE ${where.join(' AND ')}` : '', params: p.values };
    };

    const rowQuery = build(true);
    const countQuery = build(false);
    const direction = sort === 'asc' ? 'ASC' : 'DESC';

    const [{ rows }, totals] = await Promise.all([
      zite.sql({
        query: `SELECT a.*, co."name" AS "companyName", ct."name" AS "contactName", dl."name" AS "dealName", ld."name" AS "leadName"
          FROM "Activities" a
          LEFT JOIN "Companies" co ON co.id::text = a."companyId"
          LEFT JOIN "Contacts" ct ON ct.id::text = a."contactId"
          LEFT JOIN "Deals" dl ON dl.id::text = a."dealId"
          LEFT JOIN "Leads" ld ON ld.id::text = a."leadId"
          ${rowQuery.clause}
          ORDER BY COALESCE(a."occurredAt", a.created_at) ${direction}, a.created_at ${direction}
          LIMIT ${limit}`,
        params: rowQuery.params,
      }),
      zite.sql({
        query: `SELECT COUNT(*) AS "allTotal",
            COUNT(*) FILTER (WHERE a."kind" = 'Note') AS "noteTotal",
            COUNT(*) FILTER (WHERE a."kind" = 'Call') AS "callTotal",
            COUNT(*) FILTER (WHERE a."kind" = 'Email') AS "emailTotal",
            COUNT(*) FILTER (WHERE a."kind" = 'Meeting') AS "meetingTotal"
          FROM "Activities" a ${countQuery.clause}`,
        params: countQuery.params,
      }),
    ]);

    const counts = totals.rows[0] ?? {};
    return {
      activities: rows.map(r => ({
        ...toActivityRow(r),
        companyName: str(r.companyName) || null,
        contactName: str(r.contactName) || null,
        dealName: str(r.dealName) || null,
        leadName: str(r.leadName) || null,
      })),
      total: num(counts.allTotal),
      byKind: { Note: num(counts.noteTotal), Call: num(counts.callTotal), Email: num(counts.emailTotal), Meeting: num(counts.meetingTotal) },
      today,
    };
  },
});
