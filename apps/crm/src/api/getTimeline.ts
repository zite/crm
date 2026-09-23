import { z } from 'zod';
import { createEndpoint } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { getActor } from '@project/shared/server/actor';
import { toActivityRow } from '@project/shared/server/activities';
import { ENTITY_COLUMN } from '@project/shared/constants';
import { iso, json, num, ref, str } from '@project/shared/server/sql';
import { parseInput } from '../server/input';
import { activityRowSchema, entityRef, eventRowSchema } from '../server/schemas';

const inputSchema = entityRef.extend({
  /** Only these activity kinds (plus history unless `history` is false). */
  kinds: z.array(z.enum(['Note', 'Call', 'Email', 'Meeting'])).optional(),
  history: z.boolean().optional(),
  limit: z.number().int().min(1).max(300).optional(),
  /** Load older items than this ISO timestamp. */
  before: z.string().optional(),
});

/**
 * A record's story: activities (notes, calls, emails, meetings) and history
 * events on one rail, newest first, with anything scheduled ahead returned
 * separately so the page can pin it above.
 */
export default createEndpoint({
  description: 'Load the timeline for a company, contact, deal or lead',
  authenticated: true,
  inputSchema,
  outputSchema: z.object({
    activities: z.array(activityRowSchema),
    events: z.array(eventRowSchema),
    upcoming: z.array(activityRowSchema),
    hasMore: z.boolean(),
  }),
  execute: async ({ input, context }) => {
    const { type, id, kinds, history = true, limit = 50, before } = parseInput(inputSchema, input);
    await getActor(context);
    const column = ENTITY_COLUMN[type];
    const params: unknown[] = [id];
    let kindClause = '';
    if (kinds?.length) {
      kindClause = `AND a."kind" IN (${kinds.map((_, i) => `$${params.length + i + 1}`).join(', ')})`;
      params.push(...kinds);
    }
    const beforeClause = before ? `AND COALESCE(a."occurredAt", a.created_at) < $${params.push(before)}` : '';
    const names = `
      LEFT JOIN "Companies" co ON co.id::text = a."companyId"
      LEFT JOIN "Contacts" ct ON ct.id::text = a."contactId"
      LEFT JOIN "Deals" dl ON dl.id::text = a."dealId"
      LEFT JOIN "Leads" ld ON ld.id::text = a."leadId"`;

    const [past, future, events] = await Promise.all([
      zite.sql({
        query: `SELECT a.*, co."name" AS "companyName", ct."name" AS "contactName", dl."name" AS "dealName", ld."name" AS "leadName"
          FROM "Activities" a ${names}
          WHERE a."${column}" = $1 ${kindClause} ${beforeClause}
            AND (a."kind" <> 'Meeting' OR COALESCE(a."occurredAt", a.created_at) <= NOW())
          ORDER BY COALESCE(a."occurredAt", a.created_at) DESC
          LIMIT ${limit + 1}`,
        params,
      }),
      before
        ? Promise.resolve({ rows: [] as Record<string, unknown>[] })
        : zite.sql({
            query: `SELECT a.*, co."name" AS "companyName", ct."name" AS "contactName", dl."name" AS "dealName", ld."name" AS "leadName"
              FROM "Activities" a ${names}
              WHERE a."${column}" = $1 AND a."kind" = 'Meeting' AND COALESCE(a."occurredAt", a.created_at) > NOW()
              ORDER BY a."occurredAt" ASC LIMIT 20`,
            params: [id],
          }),
      history
        ? zite.sql({
            query: `SELECT id, "kind", "summary", "actorId", "occurredAt", "entityType", "entityId", "data"
              FROM "Events" WHERE "${column}" = $1 ${before ? `AND "occurredAt" < $2` : ''}
              ORDER BY "occurredAt" DESC LIMIT ${limit}`,
            params: before ? [id, before] : [id],
          })
        : Promise.resolve({ rows: [] as Record<string, unknown>[] }),
    ]);

    const map = (r: Record<string, unknown>) => ({
      ...toActivityRow(r),
      companyName: str(r.companyName) || null,
      contactName: str(r.contactName) || null,
      dealName: str(r.dealName) || null,
      leadName: str(r.leadName) || null,
    });
    return {
      activities: past.rows.slice(0, limit).map(map),
      upcoming: future.rows.map(map),
      events: events.rows.map(r => ({
        id: String(r.id),
        kind: str(r.kind) ?? '',
        summary: str(r.summary) ?? '',
        actorId: ref(r.actorId),
        occurredAt: iso(r.occurredAt) ?? '',
        entityType: str(r.entityType) ?? '',
        entityId: str(r.entityId) ?? '',
        data: r.data ? json<Record<string, unknown>>(r.data, {}) : null,
      })),
      hasMore: past.rows.length > limit,
    };
  },
});
