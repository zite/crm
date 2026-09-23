import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { assertCan, assertMember, getActor } from '@project/shared/server/actor';
import { mergeCustomValues } from '@project/shared/server/customFields';
import { logEvent } from '@project/shared/server/events';
import { setLeadStatus } from '@project/shared/server/leads';
import { notify } from '@project/shared/server/notify';
import { json, numOrNull, ref, str, withRetry } from '@project/shared/server/sql';
import { scoreLead } from '@project/shared/leads';
import { LEAD_STATUSES } from '@project/shared/constants';
import { customValues, id, parseInput, tagIds } from '../server/input';

/** The fields that change a lead's fit score, so a rescore is only ever needed when one of them moves. */
const SCORED = ['employees', 'title', 'email', 'phone', 'companyName', 'source', 'message'] as const;

const patchSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    firstName: z.string().trim().max(80).nullable(),
    lastName: z.string().trim().max(80).nullable(),
    email: z.string().trim().max(200).nullable(),
    phone: z.string().trim().max(60).nullable(),
    title: z.string().trim().max(120).nullable(),
    companyName: z.string().trim().max(200).nullable(),
    website: z.string().trim().max(300).nullable(),
    employees: z.number().int().min(0).max(10_000_000).nullable(),
    industry: z.string().max(120).nullable(),
    country: z.string().max(120).nullable(),
    source: z.string().max(120).nullable(),
    sourceDetail: z.string().max(200).nullable(),
    message: z.string().max(8000).nullable(),
    status: z.enum(LEAD_STATUSES),
    disqualifyReason: z.string().max(120).nullable(),
    ownerId: id.nullable(),
    /** Take the lead only if nobody owns it yet — what "Start working" does in the review deck. */
    claimIfUnowned: z.boolean(),
    tagIds,
    addTagIds: tagIds,
    removeTagIds: tagIds,
    customFields: customValues,
  })
  .partial();

const inputSchema = z.object({ ids: z.array(id).min(1).max(500), patch: patchSchema });

export default createEndpoint({
  description: 'Change one or more leads: status, owner, fields, disqualify reason, tags',
  authenticated: true,
  inputSchema,
  outputSchema: z.object({ updated: z.number(), failed: z.array(z.object({ id: z.string(), message: z.string() })) }),
  execute: async ({ input, context }) => {
    const { ids, patch } = parseInput(inputSchema, input);
    const actor = await getActor(context);
    assertCan(actor, 'records.edit');
    if (!Object.keys(patch).length) throw new ZiteError('Nothing to change', 'BAD_REQUEST');
    if (patch.status === 'Disqualified' && !patch.disqualifyReason?.trim()) throw new ZiteError('Choose a reason before disqualifying a lead', 'BAD_REQUEST');
    if (patch.ownerId !== undefined && patch.ownerId) await assertMember(patch.ownerId);

    const failed: Array<{ id: string; message: string }> = [];
    let updated = 0;
    // Sequential: live Zite rate-limits bursts of parallel writes.
    for (const leadId of ids) {
      try {
        await applyToLead(actor, leadId, patch);
        updated++;
      } catch (e) {
        if (ids.length === 1) throw e;
        failed.push({ id: leadId, message: e instanceof Error ? e.message : 'Couldn’t update this lead' });
      }
    }
    return { updated, failed };
  },
});

type Patch = z.infer<typeof patchSchema>;

async function applyToLead(actor: { id: string; name: string }, leadId: string, patch: Patch) {
  const { rows } = await zite.sql({ query: `SELECT * FROM "Leads" WHERE id::text = $1`, params: [leadId] });
  const lead = rows[0];
  if (!lead) throw new ZiteError('That lead no longer exists', 'NOT_FOUND');
  const name = str(lead.name) ?? 'the lead';
  const record: Record<string, unknown> = {};
  const summaries: string[] = [];

  const simple = ['name', 'firstName', 'lastName', 'email', 'phone', 'title', 'companyName', 'website', 'employees', 'industry', 'country', 'source', 'sourceDetail', 'message'] as const;
  for (const key of simple) {
    if (patch[key] === undefined) continue;
    const current = key === 'employees' ? numOrNull(lead[key]) : str(lead[key]) || null;
    const next = patch[key] === '' ? null : patch[key];
    if (current === next) continue;
    record[key] = next;
    summaries.push(key.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase());
  }
  if (record.name !== undefined && !String(record.name).trim()) throw new ZiteError('A lead needs a name', 'BAD_REQUEST');

  if (patch.ownerId !== undefined || patch.claimIfUnowned) {
    const current = ref(lead.ownerId);
    const wanted = patch.claimIfUnowned && !current ? actor.id : patch.ownerId;
    if (wanted !== undefined && wanted !== current) {
      record.ownerId = wanted;
      const { rows: m } = wanted ? await zite.sql({ query: `SELECT "name" FROM "Members" WHERE id::text = $1`, params: [wanted] }) : { rows: [] as Record<string, unknown>[] };
      await logEvent({ kind: 'lead.owner_changed', entity: { type: 'lead', id: leadId }, actorId: actor.id, summary: wanted ? `made ${str(m[0]?.name) ?? 'someone'} the owner` : 'removed the owner', leadId });
      if (wanted && wanted !== actor.id) {
        await notify({ recipientIds: [wanted], kind: 'assigned', title: `${actor.name} gave you a lead: ${name}`, body: str(lead.companyName) ? `From ${str(lead.companyName)}.` : null, link: `/leads/${leadId}`, entityType: 'lead', entityId: leadId, actorId: actor.id });
      }
    }
  }

  if (patch.tagIds !== undefined || patch.addTagIds || patch.removeTagIds) {
    const set = new Set<string>(patch.tagIds ?? json<string[]>(lead.tagIds, []));
    patch.addTagIds?.forEach(t => set.add(t));
    patch.removeTagIds?.forEach(t => set.delete(t));
    record.tagIds = set.size ? JSON.stringify([...set]) : null;
  }

  if (patch.customFields !== undefined) {
    const merged = await mergeCustomValues('Lead', lead.customFields, patch.customFields);
    if (merged !== undefined) {
      record.customFields = merged;
      summaries.push(Object.keys(patch.customFields).length === 1 ? 'a field' : 'fields');
    }
  }

  // Rescore whenever anything the score reads has moved.
  if (SCORED.some(key => record[key] !== undefined)) {
    const merged = { ...lead, ...record } as Record<string, unknown>;
    record.score = scoreLead({
      employees: numOrNull(merged.employees),
      title: str(merged.title),
      email: str(merged.email),
      phone: str(merged.phone),
      companyName: str(merged.companyName),
      source: str(merged.source),
      message: str(merged.message),
    }).score;
  }

  // Disqualify reason without a status change (fixing a reason after the fact).
  if (patch.disqualifyReason !== undefined && patch.status === undefined && str(lead.status) === 'Disqualified') {
    record.disqualifyReason = patch.disqualifyReason;
  }

  if (Object.keys(record).length) await withRetry(() => zite.leads.update({ id: leadId, record: record as never }));
  if (summaries.length) {
    await logEvent({ kind: 'lead.fields_changed', entity: { type: 'lead', id: leadId }, actorId: actor.id, summary: `updated the ${summaries.slice(0, 3).join(', ')}${summaries.length > 3 ? ` and ${summaries.length - 3} more` : ''}`, leadId });
  }

  const previous = str(lead.status) || 'New';
  if (patch.status !== undefined && patch.status !== previous) {
    await setLeadStatus(actor, leadId, patch.status, { disqualifyReason: patch.disqualifyReason ?? null, previous });
  }
}
