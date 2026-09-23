import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { assertCan, getActor } from '@project/shared/server/actor';
import { logEvent } from '@project/shared/server/events';
import { withRetry } from '@project/shared/server/sql';
import { DEAL_CONTACT_ROLES } from '@project/shared/constants';
import { id, parseInput } from '../server/input';

const inputSchema = z.object({
  dealId: id,
  add: z.array(z.object({ contactId: id, role: z.enum(DEAL_CONTACT_ROLES).nullable().optional() })).optional(),
  remove: z.array(id).optional(),
  roles: z.array(z.object({ contactId: id, role: z.enum(DEAL_CONTACT_ROLES).nullable() })).optional(),
  primaryContactId: id.nullable().optional(),
});

export default createEndpoint({
  description: 'Add, remove or change roles of contacts in a deal’s buying group, and set the primary contact',
  authenticated: true,
  inputSchema,
  outputSchema: z.object({ ok: z.boolean() }),
  execute: async ({ input, context }) => {
    const data = parseInput(inputSchema, input);
    const actor = await getActor(context);
    assertCan(actor, 'records.edit');
    const deal = await zite.deals.findOne({ id: data.dealId });
    if (!deal) throw new ZiteError('That deal no longer exists', 'NOT_FOUND');
    const { rows } = await zite.sql({ query: `SELECT id, "contactId" FROM "DealContacts" WHERE "dealId" = $1`, params: [data.dealId] });
    const links = new Map(rows.map(r => [String(r.contactId), String(r.id)]));

    for (const a of data.add ?? []) {
      if (links.has(a.contactId)) continue;
      const contact = await zite.contacts.findOne({ id: a.contactId });
      if (!contact) throw new ZiteError('That contact no longer exists', 'NOT_FOUND');
      const created = await withRetry(() => zite.dealContacts.create({ record: { dealId: data.dealId, contactId: a.contactId, role: a.role ?? null } }));
      links.set(a.contactId, created.id);
      await logEvent({ kind: 'deal.contact_added', entity: { type: 'deal', id: data.dealId }, actorId: actor.id, summary: `added ${contact.name ?? 'a contact'} to the buying group${a.role ? ` as ${a.role}` : ''}`, contactId: a.contactId, companyId: deal.companyId || null });
    }
    for (const r of data.roles ?? []) {
      const linkId = links.get(r.contactId);
      if (linkId) await withRetry(() => zite.dealContacts.update({ id: linkId, record: { role: r.role } }));
    }
    for (const contactId of data.remove ?? []) {
      const linkId = links.get(contactId);
      if (!linkId) continue;
      await withRetry(() => zite.dealContacts.delete({ id: linkId }));
      links.delete(contactId);
      if (deal.contactId === contactId) await withRetry(() => zite.deals.update({ id: data.dealId, record: { contactId: null } }));
      await logEvent({ kind: 'deal.contact_removed', entity: { type: 'deal', id: data.dealId }, actorId: actor.id, summary: 'removed a contact from the buying group', contactId, companyId: deal.companyId || null });
    }
    if (data.primaryContactId !== undefined) {
      if (data.primaryContactId && !links.has(data.primaryContactId)) {
        await withRetry(() => zite.dealContacts.create({ record: { dealId: data.dealId, contactId: data.primaryContactId, role: 'Decision Maker' } }));
      }
      await withRetry(() => zite.deals.update({ id: data.dealId, record: { contactId: data.primaryContactId } }));
    }
    return { ok: true };
  },
});
