import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { assertCanManageAsset, assertMember, getActor } from '@project/shared/server/actor';
import { can } from '@project/shared/roles';
import { logEvent } from '@project/shared/server/events';
import { DEFAULT_FORM_FIELDS, FORM_FIELD_TYPES, fieldKeyFromLabel, parseFormFields } from '@project/shared/server/leads';
import { ref, str, withRetry } from '@project/shared/server/sql';
import { slugify } from '@project/shared/tokens';
import { FORM_ASSIGNMENTS, FORM_STATUSES } from '@project/shared/constants';
import { id, parseInput, tagIds } from '../server/input';
import { formRowSchema, queryForms, DEFAULT_SUBMIT_LABEL, DEFAULT_SUCCESS } from '../features/forms/formQuery';

const fieldSchema = z.object({
  id: z.string().max(40).optional(),
  key: z.string().max(40).optional(),
  type: z.enum(FORM_FIELD_TYPES),
  label: z.string().trim().min(1, 'Every field needs a label').max(120),
  required: z.boolean().optional(),
  placeholder: z.string().max(120).nullable().optional(),
  help: z.string().max(200).nullable().optional(),
  options: z.array(z.string().max(80)).max(40).optional(),
});

const inputSchema = z.object({
  id: id.optional(),
  name: z.string().trim().min(1, 'Name the form').max(120),
  slug: z.string().trim().max(60).optional(),
  intro: z.string().max(2000).nullable().optional(),
  fields: z.array(fieldSchema).max(30).optional(),
  status: z.enum(FORM_STATUSES).optional(),
  submitLabel: z.string().trim().max(40).optional(),
  successMessage: z.string().max(1000).optional(),
  redirectUrl: z.string().trim().max(300).nullable().optional(),
  assignment: z.enum(FORM_ASSIGNMENTS).optional(),
  assigneeId: id.nullable().optional(),
  source: z.string().trim().max(120).optional(),
  notifyIds: z.array(id).max(20).optional(),
  sequenceId: id.nullable().optional(),
  tagIds: tagIds.optional(),
  archived: z.boolean().optional(),
});

/**
 * Create or update a web form. The slug is what a buyer sees in the URL, so it
 * is slugified and kept unique; the email field is always present and always
 * required, because every submission has to be recognisable as a person.
 */
export default createEndpoint({
  description: 'Create or update a web form: its fields, routing, notifications and public settings',
  authenticated: true,
  inputSchema,
  outputSchema: z.object({ form: formRowSchema }),
  execute: async ({ input, context }) => {
    const data = parseInput(inputSchema, input);
    const actor = await getActor(context);
    if (!can(actor.role, 'outreach.send')) throw new ZiteError('Your role can’t create or change forms', 'FORBIDDEN');

    const existing = data.id ? await zite.forms.findOne({ id: data.id }) : null;
    if (data.id && !existing) throw new ZiteError('That form no longer exists', 'NOT_FOUND');
    if (existing) assertCanManageAsset(actor, ref(existing.ownerId), 'form');
    if (data.assigneeId) await assertMember(data.assigneeId, 'assignee');
    for (const memberId of data.notifyIds ?? []) await assertMember(memberId, 'teammate');
    if (data.assignment === 'Member' && !data.assigneeId) throw new ZiteError('Choose the teammate new leads should go to', 'BAD_REQUEST');
    if (data.redirectUrl && !/^https?:\/\/[^\s]+$/i.test(data.redirectUrl)) throw new ZiteError('The redirect has to be a full https:// address', 'BAD_REQUEST');

    const slug = await uniqueSlug(data.slug?.trim() || data.name, data.id ?? null);
    const fields = normalizeFields(data.fields);

    const record = {
      name: data.name,
      slug,
      intro: data.intro ?? null,
      fields: JSON.stringify(fields).slice(0, 20_000),
      status: data.status ?? (existing ? str(existing.status) || 'Live' : 'Live'),
      submitLabel: data.submitLabel?.trim() || DEFAULT_SUBMIT_LABEL,
      successMessage: data.successMessage?.trim() || DEFAULT_SUCCESS,
      redirectUrl: data.redirectUrl ?? null,
      assignment: data.assignment ?? 'Round Robin',
      assigneeId: data.assignment === 'Member' ? data.assigneeId ?? null : null,
      source: data.source?.trim() || 'Website form',
      notifyIds: data.notifyIds?.length ? JSON.stringify([...new Set(data.notifyIds)]) : null,
      sequenceId: data.sequenceId ?? null,
      tagIds: data.tagIds?.length ? JSON.stringify([...new Set(data.tagIds)]) : null,
      archived: data.archived ?? false,
    };

    let formId = data.id ?? '';
    if (existing) {
      await withRetry(() => zite.forms.update({ id: existing.id, record }));
      formId = existing.id;
      const statusChanged = str(existing.status) !== record.status;
      await logEvent({
        kind: statusChanged ? 'form.status_changed' : 'form.updated',
        entity: { type: 'form', id: formId },
        actorId: actor.id,
        summary: statusChanged ? `${record.status === 'Live' ? 'made the form live' : 'paused the form'}` : `updated the form “${record.name}”`,
      });
    } else {
      const created = await withRetry(() => zite.forms.create({ record: { ...record, ownerId: actor.id, submissionCount: 0 } }));
      formId = created.id;
      await logEvent({ kind: 'form.created', entity: { type: 'form', id: formId }, actorId: actor.id, summary: `created the form “${record.name}”` });
    }

    const [form] = await queryForms({ id: formId, includeArchived: true });
    if (!form) throw new ZiteError('The form was saved but couldn’t be read back', 'CONFLICT');
    return { form };
  },
});

function normalizeFields(fields: z.infer<typeof fieldSchema>[] | undefined) {
  if (!fields?.length) return DEFAULT_FORM_FIELDS;
  const seen = new Set<string>();
  const out = fields.map((f, index) => {
    let key = (f.key ?? '').trim();
    if (!/^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(key)) key = fieldKeyFromLabel(f.label);
    while (seen.has(key)) key = `${key}_${index + 1}`;
    seen.add(key);
    return {
      id: f.id?.trim() || `fld_${index}_${key}`,
      key,
      type: key === 'email' ? ('email' as const) : f.type,
      label: f.label.trim(),
      required: key === 'email' ? true : f.required === true,
      placeholder: f.placeholder?.trim() || null,
      help: f.help?.trim() || null,
      options: f.type === 'select' ? (f.options ?? []).map(o => o.trim()).filter(Boolean) : [],
    };
  });
  for (const field of out) {
    if (field.type === 'select' && !field.options.length) throw new ZiteError(`Give “${field.label}” at least one option`, 'BAD_REQUEST');
  }
  // parseFormFields guarantees an email field and caps the list.
  return parseFormFields(JSON.stringify(out));
}

async function uniqueSlug(raw: string, excludeId: string | null) {
  const base = slugify(raw) || 'form';
  for (let i = 0; i < 40; i++) {
    const candidate = i === 0 ? base : `${base}-${i + 1}`;
    const { rows } = await zite.sql({ query: `SELECT id FROM "Forms" WHERE LOWER("slug") = $1 LIMIT 2`, params: [candidate] });
    if (!rows.length || (rows.length === 1 && excludeId && String(rows[0].id) === excludeId)) return candidate;
  }
  throw new ZiteError('Pick a different web address for this form', 'CONFLICT');
}
