import { z } from 'zod';
import { createEndpoint } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { assertCan, getActor } from '@project/shared/server/actor';
import { iso, ref, str } from '@project/shared/server/sql';
import { id, parseInput } from '../server/input';

/**
 * The run log: what each automation did, and to what. Every row names the
 * record it touched so the log links straight back to it.
 */

const inputSchema = z.object({ automationId: id.optional(), limit: z.number().int().min(1).max(100).optional() });

export default createEndpoint({
  description: 'The last runs of one automation, or of all of them',
  authenticated: true,
  inputSchema,
  outputSchema: z.object({
    runs: z.array(
      z.object({
        id: z.string(),
        automationId: z.string().nullable(),
        automationName: z.string().nullable(),
        entityType: z.string().nullable(),
        entityId: z.string().nullable(),
        recordName: z.string().nullable(),
        status: z.string(),
        detail: z.string().nullable(),
        ranAt: z.string().nullable(),
      }),
    ),
  }),
  execute: async ({ input, context }) => {
    const parsed = parseInput(inputSchema, input);
    const actor = await getActor(context);
    assertCan(actor, 'settings.manage');

    const params: unknown[] = [];
    let where = '';
    if (parsed.automationId) {
      params.push(parsed.automationId);
      where = `WHERE r."automationId" = $1`;
    }
    params.push(parsed.limit ?? 20);

    const { rows } = await zite.sql({
      query: `
        SELECT r.id, r."automationId", r."entityType", r."entityId", r."status", r."detail", r."ranAt",
               a."name" AS "automationName",
               COALESCE(d."name", l."name", ct."name", co."name") AS "recordName"
        FROM "AutomationRuns" r
        LEFT JOIN "Automations" a ON a.id::text = r."automationId"
        LEFT JOIN "Deals" d ON d.id::text = r."entityId"
        LEFT JOIN "Leads" l ON l.id::text = r."entityId"
        LEFT JOIN "Contacts" ct ON ct.id::text = r."entityId"
        LEFT JOIN "Companies" co ON co.id::text = r."entityId"
        ${where}
        ORDER BY r."ranAt" DESC NULLS LAST, r.created_at DESC
        LIMIT $${params.length}`,
      params,
    });

    return {
      runs: rows.map(r => ({
        id: String(r.id),
        automationId: ref(r.automationId),
        automationName: str(r.automationName) || null,
        entityType: str(r.entityType) || null,
        entityId: ref(r.entityId),
        recordName: str(r.recordName) || null,
        status: str(r.status) || 'Succeeded',
        detail: str(r.detail) || null,
        ranAt: iso(r.ranAt),
      })),
    };
  },
});
