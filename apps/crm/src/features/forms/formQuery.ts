import { z } from 'zod';
import { zite } from 'zitejs/db';
import { bool, iso, json, num, ref, str } from '@project/shared/server/sql';
import { FORM_FIELD_TYPES, parseFormFields } from '@project/shared/server/leads';
import { FORM_ASSIGNMENTS, FORM_STATUSES, SUBMISSION_OUTCOMES } from '@project/shared/constants';

/**
 * SERVER ONLY — imported by src/api/*.ts, never by a component.
 *
 * Forms and their submissions, read once and shaped the same for the list, the
 * editor and the submissions tab. Counts come from the Submissions table rather
 * than the cached `submissionCount`, so a number on screen is always true.
 */

export const formFieldSchema = z.object({
  id: z.string(),
  key: z.string(),
  type: z.enum(FORM_FIELD_TYPES),
  label: z.string(),
  required: z.boolean(),
  placeholder: z.string().nullable(),
  help: z.string().nullable(),
  options: z.array(z.string()),
});

export const formRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  intro: z.string().nullable(),
  fields: z.array(formFieldSchema),
  status: z.enum(FORM_STATUSES),
  submitLabel: z.string(),
  successMessage: z.string(),
  redirectUrl: z.string().nullable(),
  assignment: z.enum(FORM_ASSIGNMENTS),
  assigneeId: z.string().nullable(),
  source: z.string(),
  notifyIds: z.array(z.string()),
  sequenceId: z.string().nullable(),
  tagIds: z.array(z.string()),
  ownerId: z.string().nullable(),
  lastSubmissionAt: z.string().nullable(),
  createdAt: z.string().nullable(),
  archived: z.boolean(),
  /** Real counts, from the submissions themselves. */
  submissions: z.number(),
  newLeads: z.number(),
  existing: z.number(),
  spam: z.number(),
  /** Submissions that became a new lead, 0–1. */
  conversion: z.number(),
});
export type FormRow = z.infer<typeof formRowSchema>;

export const submissionRowSchema = z.object({
  id: z.string(),
  formId: z.string(),
  formName: z.string().nullable(),
  email: z.string().nullable(),
  name: z.string().nullable(),
  answers: z.record(z.any()),
  leadId: z.string().nullable(),
  leadName: z.string().nullable(),
  leadStatus: z.string().nullable(),
  contactId: z.string().nullable(),
  contactName: z.string().nullable(),
  outcome: z.enum(SUBMISSION_OUTCOMES),
  submittedAt: z.string().nullable(),
  pageUrl: z.string().nullable(),
  referrer: z.string().nullable(),
  utm: z.record(z.any()).nullable(),
});

export const DEFAULT_SUCCESS = 'Thanks — we’ve got it. Someone from the team will be in touch shortly.';
export const DEFAULT_SUBMIT_LABEL = 'Send';

export function toFormRow(r: Record<string, unknown>): FormRow {
  const submissions = num(r.submissionTotal);
  const newLeads = num(r.newLeadTotal);
  return {
    id: String(r.id),
    name: str(r.name) ?? '',
    slug: str(r.slug) ?? '',
    intro: str(r.intro) || null,
    fields: parseFormFields(r.fields),
    status: (str(r.status) === 'Paused' ? 'Paused' : 'Live') as FormRow['status'],
    submitLabel: str(r.submitLabel) || DEFAULT_SUBMIT_LABEL,
    successMessage: str(r.successMessage) || DEFAULT_SUCCESS,
    redirectUrl: str(r.redirectUrl) || null,
    assignment: ((FORM_ASSIGNMENTS as readonly string[]).includes(str(r.assignment) ?? '') ? str(r.assignment) : 'Round Robin') as FormRow['assignment'],
    assigneeId: ref(r.assigneeId),
    source: str(r.source) || 'Website form',
    notifyIds: json<string[]>(r.notifyIds, []),
    sequenceId: ref(r.sequenceId),
    tagIds: json<string[]>(r.tagIds, []),
    ownerId: ref(r.ownerId),
    lastSubmissionAt: iso(r.lastSubmissionAt),
    createdAt: iso(r.created_at),
    archived: bool(r.archived),
    submissions,
    newLeads,
    existing: num(r.existingTotal),
    spam: num(r.spamTotal),
    conversion: submissions ? Math.round((newLeads / submissions) * 1000) / 1000 : 0,
  };
}

const COUNTS = `
  (SELECT COUNT(*) FROM "Submissions" s WHERE s."formId" = f.id::text) AS "submissionTotal",
  (SELECT COUNT(*) FROM "Submissions" s WHERE s."formId" = f.id::text AND s."outcome" = 'New Lead') AS "newLeadTotal",
  (SELECT COUNT(*) FROM "Submissions" s WHERE s."formId" = f.id::text AND s."outcome" IN ('Existing Lead', 'Existing Contact')) AS "existingTotal",
  (SELECT COUNT(*) FROM "Submissions" s WHERE s."formId" = f.id::text AND s."outcome" = 'Spam') AS "spamTotal"`;

export async function queryForms(opts: { id?: string; includeArchived?: boolean } = {}) {
  const params: unknown[] = [];
  const where: string[] = [];
  if (opts.id) where.push(`f.id::text = $${params.push(opts.id)}`);
  if (!opts.includeArchived) where.push(`COALESCE(f."archived", false) = false`);
  const { rows } = await zite.sql({
    query: `SELECT f.*, ${COUNTS} FROM "Forms" f ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY LOWER(f."name") ASC LIMIT 500`,
    params,
  });
  return rows.map(toFormRow);
}
