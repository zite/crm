import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { assertCanDelete, getActor } from '@project/shared/server/actor';
import { logEvent } from '@project/shared/server/events';
import { plural } from '@project/shared/format';
import { ref, str } from '@project/shared/server/sql';
import { id, parseInput } from '../server/input';
import { companyLinkCounts, detachAndDeleteCompany, detachAndDeleteDeal } from '../server/companyQuery';
import { detachAndDeleteContact } from '../server/contactQuery';

const inputSchema = z.object({
  ids: z.array(id).min(1).max(200),
  /**
   * Deleting a company that still has contacts or deals is refused unless the
   * caller says "yes, take them too". The confirm dialog names the exact counts
   * first, so nobody loses a pipeline by clicking Delete on a list row.
   */
  withRelated: z.boolean().optional(),
});

export default createEndpoint({
  description: 'Delete companies — refused while they still have contacts or deals unless withRelated is set',
  authenticated: true,
  inputSchema,
  outputSchema: z.object({ deleted: z.number(), deletedContacts: z.number(), deletedDeals: z.number(), failed: z.array(z.object({ id: z.string(), message: z.string() })) }),
  execute: async ({ input, context }) => {
    const { ids, withRelated } = parseInput(inputSchema, input);
    const actor = await getActor(context);
    const failed: Array<{ id: string; message: string }> = [];
    let deleted = 0;
    let deletedContacts = 0;
    let deletedDeals = 0;

    for (const companyId of ids) {
      try {
        const { rows } = await zite.sql({ query: `SELECT id, "name", "ownerId" FROM "Companies" WHERE id::text = $1`, params: [companyId] });
        const company = rows[0];
        if (!company) throw new ZiteError('That company doesn’t exist or was already deleted', 'NOT_FOUND');
        assertCanDelete(actor, ref(company.ownerId), 'company');
        const name = str(company.name) ?? 'this company';
        const counts = await companyLinkCounts(companyId);

        if (!withRelated && (counts.contacts > 0 || counts.deals > 0)) {
          const parts = [counts.contacts ? plural(counts.contacts, 'contact') : '', counts.deals ? plural(counts.deals, 'deal') : ''].filter(Boolean).join(' and ');
          throw new ZiteError(`${name} still has ${parts}. Delete them with it, or move them to another company first.`, 'CONFLICT');
        }

        if (withRelated) {
          const { rows: deals } = await zite.sql({ query: `SELECT id FROM "Deals" WHERE "companyId" = $1`, params: [companyId] });
          for (const deal of deals) {
            await detachAndDeleteDeal(String(deal.id));
            deletedDeals++;
          }
          const { rows: contacts } = await zite.sql({ query: `SELECT id FROM "Contacts" WHERE "companyId" = $1`, params: [companyId] });
          for (const contact of contacts) {
            await detachAndDeleteContact(String(contact.id));
            deletedContacts++;
          }
        }

        await detachAndDeleteCompany(companyId);
        // The company is gone, so this line is audit history rather than a timeline entry.
        await logEvent({
          kind: 'company.deleted',
          entity: { type: 'company', id: companyId },
          actorId: actor.id,
          summary: `deleted the company “${name}”`,
          data: { name, contacts: counts.contacts, deals: counts.deals },
        });
        deleted++;
      } catch (e) {
        if (ids.length === 1) throw e;
        failed.push({ id: companyId, message: e instanceof Error ? e.message : 'Couldn’t delete this company' });
      }
    }
    if (!deleted) throw new ZiteError(failed[0]?.message ?? 'Nothing was deleted', 'CONFLICT');
    return { deleted, deletedContacts, deletedDeals, failed };
  },
});
