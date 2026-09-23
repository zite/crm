import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { assertCan, assertMember, getActor } from '@project/shared/server/actor';
import { mergeCustomValues } from '@project/shared/server/customFields';
import { logEvent } from '@project/shared/server/events';
import { notify } from '@project/shared/server/notify';
import { idList } from '@project/shared/server/records';
import { ref, str, withRetry } from '@project/shared/server/sql';
import { COMPANY_TYPES } from '@project/shared/constants';
import { customValues, day, id, parseInput, tagIds } from '../server/input';
import { normalizeDomain } from '../server/companyQuery';

const patchSchema = z
  .object({
    name: z.string().trim().min(1, 'A company needs a name').max(240),
    domain: z.string().max(240).nullable(),
    website: z.string().max(500).nullable(),
    industry: z.string().max(120).nullable(),
    type: z.enum(COMPANY_TYPES).nullable(),
    employees: z.number().int().min(0).max(100_000_000).nullable(),
    annualRevenue: z.number().min(0).max(1_000_000_000_000).nullable(),
    ownerId: id.nullable(),
    parentCompanyId: id.nullable(),
    phone: z.string().max(60).nullable(),
    linkedinUrl: z.string().max(500).nullable(),
    address: z.string().max(240).nullable(),
    city: z.string().max(120).nullable(),
    region: z.string().max(120).nullable(),
    postalCode: z.string().max(40).nullable(),
    country: z.string().max(120).nullable(),
    description: z.string().max(20_000).nullable(),
    source: z.string().max(120).nullable(),
    customerSince: day.nullable(),
    logoUrl: z.string().max(1000).nullable(),
    tagIds: tagIds,
    /** Add/remove tags without replacing the list (bulk edits). */
    addTagIds: tagIds,
    removeTagIds: tagIds,
    customFields: customValues,
    archived: z.boolean(),
  })
  .partial();

const inputSchema = z.object({ ids: z.array(id).min(1).max(500), patch: patchSchema });

/** A human sentence for the history rail, e.g. "changed the type to Customer". */
const SUMMARIES: Record<string, (value: unknown) => string> = {
  name: v => `renamed the company to “${String(v)}”`,
  type: v => (v ? `changed the type to ${String(v)}` : 'cleared the type'),
  industry: v => (v ? `set the industry to ${String(v)}` : 'cleared the industry'),
  ownerId: () => 'changed the owner',
  parentCompanyId: v => (v ? 'set the parent company' : 'removed the parent company'),
  domain: v => (v ? `set the domain to ${String(v)}` : 'cleared the domain'),
  archived: v => (v ? 'archived the company' : 'restored the company'),
  customerSince: v => (v ? `set customer since to ${String(v)}` : 'cleared customer since'),
};

export default createEndpoint({
  description: 'Change one or more companies: owner, type, fields, tags, parent, archive',
  authenticated: true,
  inputSchema,
  outputSchema: z.object({ updated: z.number(), failed: z.array(z.object({ id: z.string(), message: z.string() })) }),
  execute: async ({ input, context }) => {
    const { ids, patch } = parseInput(inputSchema, input);
    const actor = await getActor(context);
    assertCan(actor, 'records.edit');
    if (!Object.keys(patch).length) throw new ZiteError('Nothing to change', 'BAD_REQUEST');
    if (patch.ownerId !== undefined) await assertMember(patch.ownerId);

    const failed: Array<{ id: string; message: string }> = [];
    let updated = 0;
    // Sequential: live Zite rate-limits bursts of parallel writes.
    for (const companyId of ids) {
      try {
        await applyPatch(actor, companyId, patch);
        updated++;
      } catch (e) {
        if (ids.length === 1) throw e;
        failed.push({ id: companyId, message: e instanceof Error ? e.message : 'Couldn’t update this company' });
      }
    }
    return { updated, failed };
  },
});

async function applyPatch(actor: { id: string; name: string }, companyId: string, patch: z.infer<typeof patchSchema>) {
  const { rows } = await zite.sql({ query: `SELECT * FROM "Companies" WHERE id::text = $1`, params: [companyId] });
  const current = rows[0];
  if (!current) throw new ZiteError('That company doesn’t exist or was deleted', 'NOT_FOUND');

  const { addTagIds, removeTagIds, customFields, ...rest } = patch;
  const record: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(rest)) {
    if (value === undefined) continue;
    record[key] = value === '' ? null : value;
  }
  if (patch.domain !== undefined) record.domain = normalizeDomain(patch.domain);
  if (patch.parentCompanyId) {
    if (patch.parentCompanyId === companyId) throw new ZiteError('A company can’t be its own parent', 'BAD_REQUEST');
    if (await isDescendant(patch.parentCompanyId, companyId)) throw new ZiteError('That company is already a subsidiary of this one', 'BAD_REQUEST');
    const { rows: parent } = await zite.sql({ query: `SELECT 1 FROM "Companies" WHERE id::text = $1`, params: [patch.parentCompanyId] });
    if (!parent[0]) throw new ZiteError('That parent company no longer exists', 'BAD_REQUEST');
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
    const merged = await mergeCustomValues('Company', current.customFields, customFields);
    if (merged !== undefined) record.customFields = merged;
  }
  if (!Object.keys(record).length) return;

  await withRetry(() => zite.companies.update({ id: companyId, record: record as never }));

  // One history line per meaningful change, worded to read after the actor's name.
  for (const [key, value] of Object.entries(record)) {
    const summary = SUMMARIES[key];
    if (!summary) continue;
    if (String(current[key] ?? '') === String(value ?? '')) continue;
    await logEvent({ kind: `company.${key === 'ownerId' ? 'owner_changed' : 'updated'}`, entity: { type: 'company', id: companyId }, actorId: actor.id, summary: summary(value), data: { field: key } });
  }
  if (!Object.keys(record).some(k => SUMMARIES[k])) {
    await logEvent({ kind: 'company.updated', entity: { type: 'company', id: companyId }, actorId: actor.id, summary: 'updated the company details' });
  }
  const newOwner = record.ownerId as string | null | undefined;
  if (newOwner && newOwner !== ref(current.ownerId) && newOwner !== actor.id) {
    await notify({
      recipientIds: [newOwner],
      kind: 'assigned',
      title: `${actor.name} gave you a company: ${str(current.name) ?? ''}`,
      link: `/companies/${companyId}`,
      entityType: 'company',
      entityId: companyId,
      actorId: actor.id,
    });
  }
}

/** Would setting `candidate` as a parent create a loop? Walks up at most 20 levels. */
async function isDescendant(candidate: string, ofCompanyId: string) {
  let cursor: string | null = candidate;
  for (let i = 0; i < 20 && cursor; i++) {
    const { rows } = await zite.sql({ query: `SELECT "parentCompanyId" FROM "Companies" WHERE id::text = $1`, params: [cursor] });
    cursor = ref(rows[0]?.parentCompanyId);
    if (cursor === ofCompanyId) return true;
  }
  return false;
}
