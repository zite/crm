import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { assertCan, assertMember, getActor } from '@project/shared/server/actor';
import { runTrigger } from '@project/shared/server/automations';
import { mergeCustomValues } from '@project/shared/server/customFields';
import { logEvent } from '@project/shared/server/events';
import { notify } from '@project/shared/server/notify';
import { withRetry } from '@project/shared/server/sql';
import { EMAIL_RE } from '@project/shared/format';
import { customValues, id, parseInput, tagIds } from '../server/input';

const inputSchema = z.object({
  firstName: z.string().trim().max(120).nullable().optional(),
  lastName: z.string().trim().max(120).nullable().optional(),
  /** Optional: built from first and last name when left out. */
  name: z.string().trim().max(240).nullable().optional(),
  email: z.string().trim().max(240).nullable().optional(),
  phone: z.string().max(60).nullable().optional(),
  mobile: z.string().max(60).nullable().optional(),
  title: z.string().max(160).nullable().optional(),
  companyId: id.nullable().optional(),
  ownerId: id.nullable().optional(),
  source: z.string().max(120).nullable().optional(),
  linkedinUrl: z.string().max(500).nullable().optional(),
  city: z.string().max(120).nullable().optional(),
  country: z.string().max(120).nullable().optional(),
  timezone: z.string().max(80).nullable().optional(),
  background: z.string().max(20_000).nullable().optional(),
  doNotContact: z.boolean().optional(),
  tagIds: tagIds.optional(),
  customFields: customValues.optional(),
  /** Also add them to this deal's buying group. */
  dealId: id.nullable().optional(),
  /** Refuse when someone already has this email address. */
  failOnDuplicate: z.boolean().optional(),
});

export default createEndpoint({
  description: 'Create a contact, optionally adding them to a deal’s buying group',
  authenticated: true,
  inputSchema,
  outputSchema: z.object({ id: z.string(), duplicateId: z.string().nullable() }),
  execute: async ({ input, context }) => {
    const data = parseInput(inputSchema, input);
    const actor = await getActor(context);
    assertCan(actor, 'records.edit');

    const first = data.firstName?.trim() || '';
    const last = data.lastName?.trim() || '';
    const name = (data.name?.trim() || [first, last].filter(Boolean).join(' ')).trim();
    if (!name) throw new ZiteError('Give the contact a name', 'BAD_REQUEST');
    const email = data.email?.trim().toLowerCase() || null;
    if (email && !EMAIL_RE.test(email)) throw new ZiteError('That email address doesn’t look right', 'BAD_REQUEST');

    let duplicateId: string | null = null;
    if (email) {
      const { rows } = await zite.sql({ query: `SELECT id, "name" FROM "Contacts" WHERE LOWER("email") = $1 LIMIT 1`, params: [email] });
      if (rows[0]) {
        if (data.failOnDuplicate) throw new ZiteError(`${String(rows[0].name)} already uses ${email}`, 'CONFLICT');
        duplicateId = String(rows[0].id);
      }
    }
    if (data.companyId) {
      const { rows } = await zite.sql({ query: `SELECT 1 FROM "Companies" WHERE id::text = $1`, params: [data.companyId] });
      if (!rows[0]) throw new ZiteError('That company no longer exists', 'BAD_REQUEST');
    }
    if (data.dealId) {
      const { rows } = await zite.sql({ query: `SELECT 1 FROM "Deals" WHERE id::text = $1`, params: [data.dealId] });
      if (!rows[0]) throw new ZiteError('That deal no longer exists', 'BAD_REQUEST');
    }
    await assertMember(data.ownerId ?? null);
    const custom = await mergeCustomValues('Contact', null, data.customFields ?? null, { enforceRequired: true });

    const created = await withRetry(() =>
      zite.contacts.create({
        record: {
          name: name.slice(0, 240),
          firstName: first || name.split(/\s+/)[0] || null,
          lastName: last || (name.split(/\s+/).length > 1 ? name.split(/\s+/).slice(1).join(' ') : null),
          email,
          phone: data.phone || null,
          mobile: data.mobile || null,
          title: data.title || null,
          companyId: data.companyId || null,
          ownerId: data.ownerId === undefined ? actor.id : data.ownerId,
          source: data.source || null,
          linkedinUrl: data.linkedinUrl || null,
          city: data.city || null,
          country: data.country || null,
          timezone: data.timezone || null,
          background: data.background || null,
          doNotContact: data.doNotContact ?? false,
          tagIds: data.tagIds?.length ? JSON.stringify(data.tagIds) : null,
          customFields: custom ?? null,
        },
      }),
    );

    if (data.dealId) {
      await withRetry(() => zite.dealContacts.create({ record: { dealId: data.dealId, contactId: created.id, role: 'Influencer' } }));
    }
    await logEvent({
      kind: 'contact.created',
      entity: { type: 'contact', id: created.id },
      actorId: actor.id,
      summary: data.companyId ? 'added the contact' : 'added the contact with no company',
      companyId: data.companyId || null,
      dealId: data.dealId || null,
    });
    const ownerId = data.ownerId === undefined ? actor.id : data.ownerId;
    if (ownerId && ownerId !== actor.id) {
      await notify({ recipientIds: [ownerId], kind: 'assigned', title: `${actor.name} gave you a contact: ${name}`, link: `/contacts/${created.id}`, entityType: 'contact', entityId: created.id, actorId: actor.id });
    }
    await runTrigger('contact.created', { entityType: 'contact', entityId: created.id, actorId: actor.id });
    return { id: created.id, duplicateId };
  },
});
