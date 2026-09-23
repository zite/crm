import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { assertCanDelete, getActor } from '@project/shared/server/actor';
import { logEvent } from '@project/shared/server/events';
import { ref, str, withRetry } from '@project/shared/server/sql';
import { id, parseInput } from '../server/input';

/**
 * Deleting a lead takes its activities, tasks and history with it — a lead has
 * no other home for them. A converted lead's records are left alone: the
 * contact, company and deal are real now and simply lose the lead they came
 * from, so the submissions that made it keep pointing at the contact.
 */
export default createEndpoint({
  description: 'Delete leads and the activities, tasks and history that belong only to them',
  authenticated: true,
  inputSchema: z.object({ ids: z.array(id).min(1).max(500) }),
  outputSchema: z.object({ deleted: z.number() }),
  execute: async ({ input, context }) => {
    const { ids } = parseInput(z.object({ ids: z.array(id).min(1).max(500) }), input);
    const actor = await getActor(context);
    let deleted = 0;
    for (const leadId of ids) {
      const { rows } = await zite.sql({ query: `SELECT id, "name", "ownerId", "convertedContactId" FROM "Leads" WHERE id::text = $1`, params: [leadId] });
      const lead = rows[0];
      if (!lead) continue;
      if (ids.length === 1) assertCanDelete(actor, ref(lead.ownerId), 'lead');
      else
        try {
          assertCanDelete(actor, ref(lead.ownerId), 'lead');
        } catch {
          continue;
        }

      const children = await zite.sql({
        query: `SELECT 'activities' AS t, id, "contactId", "companyId", "dealId" FROM "Activities" WHERE "leadId" = $1
          UNION ALL SELECT 'tasks', id, "contactId", "companyId", "dealId" FROM "Tasks" WHERE "leadId" = $1
          UNION ALL SELECT 'documents', id, "contactId", "companyId", "dealId" FROM "Documents" WHERE "leadId" = $1
          UNION ALL SELECT 'events', id, NULL, NULL, NULL FROM "Events" WHERE "leadId" = $1`,
        params: [leadId],
      });
      for (const child of children.rows) {
        const table = String(child.t) as 'activities' | 'tasks' | 'documents' | 'events';
        const childId = String(child.id);
        const stillLinked = table !== 'events' && Boolean(ref(child.contactId) || ref(child.companyId) || ref(child.dealId));
        if (stillLinked) {
          await withRetry(() => (zite[table] as { update: (a: { id: string; record: never }) => Promise<unknown> }).update({ id: childId, record: { leadId: null } as never }));
        } else {
          await withRetry(() => (zite[table] as { delete: (a: { id: string }) => Promise<unknown> }).delete({ id: childId }));
        }
      }
      const { rows: submissions } = await zite.sql({ query: `SELECT id FROM "Submissions" WHERE "leadId" = $1`, params: [leadId] });
      for (const s of submissions) await withRetry(() => zite.submissions.update({ id: String(s.id), record: { leadId: null } }));

      await withRetry(() => zite.leads.delete({ id: leadId }));
      await logEvent({ kind: 'lead.deleted', entity: { type: 'lead', id: leadId }, actorId: actor.id, summary: `deleted the lead “${str(lead.name) ?? ''}”`, leadId: null });
      deleted++;
    }
    if (!deleted) throw new ZiteError('Nothing was deleted — you can only delete leads you own', 'FORBIDDEN');
    return { deleted };
  },
});
