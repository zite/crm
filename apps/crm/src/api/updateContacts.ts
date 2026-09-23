import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { assertCan, assertMember, getActor } from '@project/shared/server/actor';
import { mergeCustomValues } from '@project/shared/server/customFields';
import { logEvent } from '@project/shared/server/events';
import { notify } from '@project/shared/server/notify';
import { idList } from '@project/shared/server/records';
import { ref, str, withRetry } from '@project/shared/server/sql';
import { EMAIL_RE } from '@project/shared/format';
import { customValues, id, parseInput, tagIds } from '../server/input';

const patchSchema = z
  .object({
    name: z.string().trim().min(1, 'A contact needs a name').max(240),
    firstName: z.string().trim().max(120).nullable(),
    lastName: z.string().trim().max(120).nullable(),
    email: z.string().trim().max(240).nullable(),
    phone: z.string().max(60).nullable(),
    mobile: z.string().max(60).nullable(),
    title: z.string().max(160).nullable(),
    companyId: id.nullable(),
    ownerId: id.nullable(),
    source: z.string().max(120).nullable(),
    linkedinUrl: z.string().max(500).nullable(),
    city: z.string().max(120).nullable(),
    country: z.string().max(120).nullable(),
    timezone: z.string().max(80).nullable(),
    background: z.string().max(20_000).nullable(),
    doNotContact: z.boolean(),
    avatarUrl: z.string().max(1000).nullable(),
    tagIds: tagIds,
    addTagIds: tagIds,
    removeTagIds: tagIds,
    customFields: customValues,
    archived: z.boolean(),
  })
  .partial();

const inputSchema = z.object({ ids: z.array(id).min(1).max(500), patch: patchSchema });

const SUMMARIES: Record<string, (value: unknown) => string> = {
  name: v => `renamed the contact to “${String(v)}”`,
  title: v => (v ? `set the title to ${String(v)}` : 'cleared the title'),
  companyId: v => (v ? 'moved the contact to another company' : 'removed the contact from their company'),
  ownerId: () => 'changed the owner',
  email: v => (v ? `set the email to ${String(v)}` : 'cleared the email'),
  doNotContact: v => (v ? 'marked the contact do not contact' : 'cleared do not contact'),
  archived: v => (v ? 'archived the contact' : 'restored the contact'),
};

/**
 * Note on unsubscribes: `unsubscribedAt` is set by the buyer through the public
 * unsubscribe page and is deliberately not writable here — a rep can't opt
 * someone back in on their behalf. "Do not contact" is the internal flag.
 */
export default createEndpoint({
  description: 'Change one or more contacts: owner, company, fields, tags, do-not-contact, archive',
  authenticated: true,
  inputSchema,
  outputSchema: z.object({ updated: z.number(), failed: z.array(z.object({ id: z.string(), message: z.string() })) }),
  execute: async ({ input, context }) => {
    const { ids, patch } = parseInput(inputSchema, input);
    const actor = await getActor(context);
    assertCan(actor, 'records.edit');
    if (!Object.keys(patch).length) throw new ZiteError('Nothing to change', 'BAD_REQUEST');
    if (patch.ownerId !== undefined) await assertMember(patch.ownerId);
    if (patch.email) {
      const email = patch.email.trim().toLowerCase();
      if (!EMAIL_RE.test(email)) throw new ZiteError('That email address doesn’t look right', 'BAD_REQUEST');
    }
    if (patch.companyId) {
      const { rows } = await zite.sql({ query: `SELECT 1 FROM "Companies" WHERE id::text = $1`, params: [patch.companyId] });
      if (!rows[0]) throw new ZiteError('That company no longer exists', 'BAD_REQUEST');
    }

    const failed: Array<{ id: string; message: string }> = [];
    let updated = 0;
    // Sequential: live Zite rate-limits bursts of parallel writes.
    for (const contactId of ids) {
      try {
        await applyPatch(actor, contactId, patch);
        updated++;
      } catch (e) {
        if (ids.length === 1) throw e;
        failed.push({ id: contactId, message: e instanceof Error ? e.message : 'Couldn’t update this contact' });
      }
    }
    return { updated, failed };
  },
});

async function applyPatch(actor: { id: string; name: string }, contactId: string, patch: z.infer<typeof patchSchema>) {
  const { rows } = await zite.sql({ query: `SELECT * FROM "Contacts" WHERE id::text = $1`, params: [contactId] });
  const current = rows[0];
  if (!current) throw new ZiteError('That contact doesn’t exist or was deleted', 'NOT_FOUND');

  const { addTagIds, removeTagIds, customFields, ...rest } = patch;
  const record: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rest)) {
    if (value === undefined) continue;
    record[key] = value === '' ? null : value;
  }
  if (patch.email !== undefined) record.email = patch.email ? patch.email.trim().toLowerCase() : null;
  // Keep name and its parts in step, whichever side was edited.
  if (patch.name !== undefined && patch.firstName === undefined && patch.lastName === undefined) {
    const parts = String(patch.name).trim().split(/\s+/);
    record.firstName = parts[0] ?? null;
    record.lastName = parts.length > 1 ? parts.slice(1).join(' ') : null;
  } else if (patch.name === undefined && (patch.firstName !== undefined || patch.lastName !== undefined)) {
    const first = (patch.firstName ?? str(current.firstName) ?? '').trim();
    const last = (patch.lastName ?? str(current.lastName) ?? '').trim();
    const joined = [first, last].filter(Boolean).join(' ');
    if (joined) record.name = joined;
  }
  if (addTagIds || removeTagIds) {
    const set = new Set<string>(idList(current.tagIds));
    addTagIds?.forEach(t => set.add(t));
    removeTagIds?.forEach(t => set.delete(t));
    record.tagIds = JSON.stringify([...set]);
  } else if (patch.tagIds) {
    record.tagIds = JSON.stringify(patch.tagIds);
  }
  if (customFields) {
    const merged = await mergeCustomValues('Contact', current.customFields, customFields);
    if (merged !== undefined) record.customFields = merged;
  }
  if (!Object.keys(record).length) return;

  await withRetry(() => zite.contacts.update({ id: contactId, record: record as never }));

  const companyId = (record.companyId as string | null | undefined) ?? ref(current.companyId);
  let logged = false;
  for (const [key, value] of Object.entries(record)) {
    const summary = SUMMARIES[key];
    if (!summary) continue;
    if (String(current[key] ?? '') === String(value ?? '')) continue;
    await logEvent({
      kind: `contact.${key === 'ownerId' ? 'owner_changed' : 'updated'}`,
      entity: { type: 'contact', id: contactId },
      actorId: actor.id,
      summary: summary(value),
      companyId,
      data: { field: key },
    });
    logged = true;
  }
  if (!logged) {
    await logEvent({ kind: 'contact.updated', entity: { type: 'contact', id: contactId }, actorId: actor.id, summary: 'updated the contact details', companyId });
  }
  const newOwner = record.ownerId as string | null | undefined;
  if (newOwner && newOwner !== ref(current.ownerId) && newOwner !== actor.id) {
    await notify({
      recipientIds: [newOwner],
      kind: 'assigned',
      title: `${actor.name} gave you a contact: ${str(current.name) ?? ''}`,
      link: `/contacts/${contactId}`,
      entityType: 'contact',
      entityId: contactId,
      actorId: actor.id,
    });
  }
}
