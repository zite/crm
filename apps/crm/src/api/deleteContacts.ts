import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { assertCanDelete, getActor } from '@project/shared/server/actor';
import { logEvent } from '@project/shared/server/events';
import { ref, str } from '@project/shared/server/sql';
import { id, parseInput } from '../server/input';
import { contactLinkCounts, detachAndDeleteContact } from '../server/contactQuery';

const inputSchema = z.object({ ids: z.array(id).min(1).max(200) });

/**
 * Deleting a contact never deletes a deal. Their buying-group links and any
 * active sequence enrollments go; deals they were primary on lose their primary
 * contact; every activity, task, note, file and quote keeps its other links, and
 * anything that only pointed at them goes with them rather than becoming
 * invisible. Reps can only delete contacts they own.
 */
export default createEndpoint({
  description: 'Delete contacts, keeping their deals and every activity that has another link',
  authenticated: true,
  inputSchema,
  outputSchema: z.object({ deleted: z.number(), failed: z.array(z.object({ id: z.string(), message: z.string() })) }),
  execute: async ({ input, context }) => {
    const { ids } = parseInput(inputSchema, input);
    const actor = await getActor(context);
    const failed: Array<{ id: string; message: string }> = [];
    let deleted = 0;

    for (const contactId of ids) {
      try {
        const { rows } = await zite.sql({ query: `SELECT id, "name", "ownerId", "companyId" FROM "Contacts" WHERE id::text = $1`, params: [contactId] });
        const contact = rows[0];
        if (!contact) throw new ZiteError('That contact doesn’t exist or was already deleted', 'NOT_FOUND');
        assertCanDelete(actor, ref(contact.ownerId), 'contact');
        const counts = await contactLinkCounts(contactId);
        const name = str(contact.name) ?? 'this contact';
        const companyId = ref(contact.companyId);

        await detachAndDeleteContact(contactId);
        await logEvent({
          kind: 'contact.deleted',
          entity: { type: 'company', id: companyId ?? contactId },
          actorId: actor.id,
          summary: `deleted the contact “${name}”`,
          companyId,
          data: { name, buyingGroups: counts.buyingGroups },
        });
        deleted++;
      } catch (e) {
        if (ids.length === 1) throw e;
        failed.push({ id: contactId, message: e instanceof Error ? e.message : 'Couldn’t delete this contact' });
      }
    }
    if (!deleted) throw new ZiteError(failed[0]?.message ?? 'Nothing was deleted', 'CONFLICT');
    return { deleted, failed };
  },
});
