import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { assertCanDelete, getActor } from '@project/shared/server/actor';
import { logEvent } from '@project/shared/server/events';
import { ref, str, withRetry } from '@project/shared/server/sql';
import { id, parseInput } from '../server/input';

const inputSchema = z.object({ ids: z.array(id).min(1).max(500) });

/**
 * Deleting a deal removes it with its buying-group links, line items and stage
 * history. Activities, tasks and quotes keep their other links (company,
 * contact) and simply lose the deal, so no conversation is lost.
 */
export default createEndpoint({
  description: 'Delete deals (and their line items, buying group and stage history)',
  authenticated: true,
  inputSchema,
  outputSchema: z.object({ deleted: z.number() }),
  execute: async ({ input, context }) => {
    const { ids } = parseInput(inputSchema, input);
    const actor = await getActor(context);
    let deleted = 0;
    for (const dealId of ids) {
      const { rows } = await zite.sql({ query: `SELECT id, "name", "ownerId", "companyId" FROM "Deals" WHERE id::text = $1`, params: [dealId] });
      const deal = rows[0];
      if (!deal) continue;
      if (ids.length === 1) assertCanDelete(actor, ref(deal.ownerId), 'deal');
      else
        try {
          assertCanDelete(actor, ref(deal.ownerId), 'deal');
        } catch {
          continue;
        }
      const children = await zite.sql({
        query: `SELECT 'dealContacts' AS t, id FROM "DealContacts" WHERE "dealId" = $1
          UNION ALL SELECT 'lineItems', id FROM "LineItems" WHERE "dealId" = $1
          UNION ALL SELECT 'stageChanges', id FROM "StageChanges" WHERE "dealId" = $1
          UNION ALL SELECT 'activities', id FROM "Activities" WHERE "dealId" = $1
          UNION ALL SELECT 'tasks', id FROM "Tasks" WHERE "dealId" = $1
          UNION ALL SELECT 'quotes', id FROM "Quotes" WHERE "dealId" = $1`,
        params: [dealId],
      });
      for (const c of children.rows) {
        const table = String(c.t) as 'dealContacts' | 'lineItems' | 'stageChanges' | 'activities' | 'tasks' | 'quotes';
        const childId = String(c.id);
        if (table === 'activities' || table === 'tasks' || table === 'quotes') {
          await withRetry(() => (zite[table] as { update: (a: { id: string; record: never }) => Promise<unknown> }).update({ id: childId, record: { dealId: null } as never }));
        } else {
          await withRetry(() => (zite[table] as { delete: (a: { id: string }) => Promise<unknown> }).delete({ id: childId }));
        }
      }
      await withRetry(() => zite.deals.delete({ id: dealId }));
      await logEvent({ kind: 'deal.deleted', entity: { type: 'company', id: ref(deal.companyId) ?? dealId }, actorId: actor.id, summary: `deleted the deal “${str(deal.name) ?? ''}”`, companyId: ref(deal.companyId) });
      deleted++;
    }
    if (!deleted) throw new ZiteError('Nothing was deleted — you can only delete deals you own', 'FORBIDDEN');
    return { deleted };
  },
});
