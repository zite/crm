import { z } from 'zod';
import { zite } from 'zitejs/db';
import { json, num, numOrNull, Params, ref, str, iso } from '@project/shared/server/sql';
import { jsonHasAny } from '@project/shared/server/records';
import { nextStepsFor } from '@project/shared/server/tasks';
import { LEAD_STATUSES, type LeadStatus } from '@project/shared/constants';
import { ratingForScore } from '@project/shared/leads';

/**
 * SERVER ONLY — imported by src/api/*.ts, never by a component.
 *
 * The one lead query: the ledger, the review deck, the lead page and the
 * reports drill-down all read rows through here, so a lead looks the same
 * everywhere. Rating is derived from the score in SQL exactly as
 * `ratingForScore` derives it in TypeScript.
 */

export const LEAD_SORT_KEYS = ['name', 'company', 'score', 'status', 'owner', 'source', 'receivedAt', 'firstResponseAt', 'lastActivityAt'] as const;
export type LeadSortKey = (typeof LEAD_SORT_KEYS)[number];

const id = z.string().min(1).max(64);
const dayStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const leadFilterSchema = z.object({
  ids: z.array(id).max(2000).optional(),
  status: z.array(z.enum(LEAD_STATUSES)).optional(),
  /** Member ids; 'none' matches leads nobody owns. */
  ownerIds: z.array(z.string()).optional(),
  sources: z.array(z.string()).optional(),
  ratings: z.array(z.enum(['Hot', 'Warm', 'Cold'])).optional(),
  disqualifyReasons: z.array(z.string()).optional(),
  tagIds: z.array(id).optional(),
  formId: id.optional(),
  hasPhone: z.boolean().optional(),
  converted: z.boolean().optional(),
  /** Nobody has replied and the clock has run past the org's response window. */
  noResponse: z.boolean().optional(),
  receivedFrom: dayStr.optional(),
  receivedTo: dayStr.optional(),
  search: z.string().max(120).optional(),
});
export type LeadFilters = z.infer<typeof leadFilterSchema>;

export const nextStepSchema = z
  .object({ taskId: z.string(), title: z.string(), type: z.string(), dueDate: z.string().nullable(), dueTime: z.string().nullable(), ownerId: z.string().nullable() })
  .nullable();

export const leadRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  title: z.string().nullable(),
  companyName: z.string().nullable(),
  website: z.string().nullable(),
  employees: z.number().nullable(),
  industry: z.string().nullable(),
  country: z.string().nullable(),
  source: z.string().nullable(),
  sourceDetail: z.string().nullable(),
  status: z.enum(LEAD_STATUSES),
  score: z.number(),
  rating: z.enum(['Hot', 'Warm', 'Cold']),
  ownerId: z.string().nullable(),
  message: z.string().nullable(),
  disqualifyReason: z.string().nullable(),
  convertedAt: z.string().nullable(),
  convertedContactId: z.string().nullable(),
  convertedCompanyId: z.string().nullable(),
  convertedDealId: z.string().nullable(),
  formId: z.string().nullable(),
  formName: z.string().nullable(),
  utmSource: z.string().nullable(),
  utmMedium: z.string().nullable(),
  utmCampaign: z.string().nullable(),
  tagIds: z.array(z.string()),
  customFields: z.record(z.any()),
  receivedAt: z.string().nullable(),
  firstResponseAt: z.string().nullable(),
  lastActivityAt: z.string().nullable(),
  createdAt: z.string().nullable(),
  /** Hours between arriving and the first outbound touch; null when nobody has answered. */
  responseHours: z.number().nullable(),
  nextStep: nextStepSchema,
});
export type LeadRow = z.infer<typeof leadRowSchema>;

const RATING_SQL = `CASE WHEN COALESCE(l."score", 0) >= 65 THEN 'Hot' WHEN COALESCE(l."score", 0) >= 40 THEN 'Warm' ELSE 'Cold' END`;
const RECEIVED_SQL = `COALESCE(l."receivedAt", l.created_at)`;

export async function queryLeads(
  f: LeadFilters,
  sort: { key: LeadSortKey; dir: 'asc' | 'desc' } | undefined,
  limit: number,
  opts: { responseHours: number; withNextStep?: boolean } = { responseHours: 24 },
) {
  const p = new Params();
  const where: string[] = ['1 = 1'];
  if (f.ids?.length) where.push(`l.id::text IN ${p.list(f.ids)}`);
  if (f.status?.length) where.push(`l."status" IN ${p.list(f.status)}`);
  if (f.ownerIds?.length) {
    const real = f.ownerIds.filter(o => o !== 'none');
    const parts: string[] = [];
    if (real.length) parts.push(`l."ownerId" IN ${p.list(real)}`);
    if (f.ownerIds.includes('none')) parts.push(`COALESCE(l."ownerId", '') = ''`);
    where.push(`(${parts.join(' OR ')})`);
  }
  if (f.sources?.length) where.push(`l."source" IN ${p.list(f.sources)}`);
  if (f.ratings?.length) where.push(`${RATING_SQL} IN ${p.list(f.ratings)}`);
  if (f.disqualifyReasons?.length) where.push(`l."disqualifyReason" IN ${p.list(f.disqualifyReasons)}`);
  if (f.tagIds?.length) where.push(jsonHasAny('l."tagIds"', p.list(f.tagIds)));
  if (f.formId) where.push(`l."formId" = ${p.add(f.formId)}`);
  if (f.hasPhone) where.push(`COALESCE(l."phone", '') <> ''`);
  if (f.converted != null) where.push(f.converted ? `l."convertedAt" IS NOT NULL` : `l."convertedAt" IS NULL`);
  if (f.noResponse) where.push(`l."firstResponseAt" IS NULL AND l."status" IN ('New', 'Working') AND ${RECEIVED_SQL} < ${p.add(new Date(Date.now() - opts.responseHours * 3_600_000).toISOString())}`);
  if (f.receivedFrom) where.push(`${RECEIVED_SQL} >= ${p.add(f.receivedFrom)}::date`);
  if (f.receivedTo) where.push(`${RECEIVED_SQL} < (${p.add(f.receivedTo)}::date + 1)`);
  if (f.search?.trim()) {
    const like = p.add(`%${f.search.trim().toLowerCase()}%`);
    where.push(`(LOWER(l."name") LIKE ${like} OR LOWER(COALESCE(l."email", '')) LIKE ${like} OR LOWER(COALESCE(l."companyName", '')) LIKE ${like} OR LOWER(COALESCE(l."title", '')) LIKE ${like})`);
  }

  const dir = sort?.dir === 'desc' ? 'DESC' : 'ASC';
  const order =
    {
      name: `LOWER(l."name") ${dir}`,
      company: `LOWER(COALESCE(l."companyName", '')) ${dir}`,
      score: `COALESCE(l."score", 0) ${dir}`,
      status: `l."status" ${dir}`,
      owner: `LOWER(COALESCE(m."name", '')) ${dir}`,
      source: `LOWER(COALESCE(l."source", '')) ${dir}`,
      receivedAt: `${RECEIVED_SQL} ${dir}`,
      firstResponseAt: `l."firstResponseAt" ${dir} NULLS LAST`,
      lastActivityAt: `l."lastActivityAt" ${dir} NULLS LAST`,
    }[sort?.key ?? 'receivedAt'] ?? `${RECEIVED_SQL} DESC`;

  const { rows, truncated } = await zite.sql({
    query: `
      SELECT l.*, ${RATING_SQL} AS "ratingLabel", ${RECEIVED_SQL} AS "receivedResolved", fm."name" AS "formName"
      FROM "Leads" l
      LEFT JOIN "Members" m ON m.id::text = l."ownerId"
      LEFT JOIN "Forms" fm ON fm.id::text = l."formId"
      WHERE ${where.join(' AND ')}
      ORDER BY ${order}, l.created_at DESC
      LIMIT ${Math.min(limit, 2000)}`,
    params: p.values,
  });

  const next = opts.withNextStep === false ? new Map() : await nextStepsFor('leadId', rows.map(r => String(r.id)));
  return { leads: rows.map(r => toLeadRow(r, next.get(String(r.id)) ?? null)), truncated: Boolean(truncated) };
}

export function toLeadRow(r: Record<string, unknown>, nextStep: LeadRow['nextStep'] = null): LeadRow {
  const score = num(r.score);
  const received = iso(r.receivedResolved) ?? iso(r.receivedAt) ?? iso(r.created_at);
  const responded = iso(r.firstResponseAt);
  return {
    id: String(r.id),
    name: str(r.name) ?? '',
    firstName: str(r.firstName) || null,
    lastName: str(r.lastName) || null,
    email: str(r.email) || null,
    phone: str(r.phone) || null,
    title: str(r.title) || null,
    companyName: str(r.companyName) || null,
    website: str(r.website) || null,
    employees: numOrNull(r.employees),
    industry: str(r.industry) || null,
    country: str(r.country) || null,
    source: str(r.source) || null,
    sourceDetail: str(r.sourceDetail) || null,
    status: ((str(r.status) || 'New') as LeadStatus),
    score,
    rating: (str(r.ratingLabel) as 'Hot' | 'Warm' | 'Cold') || ratingForScore(score),
    ownerId: ref(r.ownerId),
    message: str(r.message) || null,
    disqualifyReason: str(r.disqualifyReason) || null,
    convertedAt: iso(r.convertedAt),
    convertedContactId: ref(r.convertedContactId),
    convertedCompanyId: ref(r.convertedCompanyId),
    convertedDealId: ref(r.convertedDealId),
    formId: ref(r.formId),
    formName: str(r.formName) || null,
    utmSource: str(r.utmSource) || null,
    utmMedium: str(r.utmMedium) || null,
    utmCampaign: str(r.utmCampaign) || null,
    tagIds: json<string[]>(r.tagIds, []),
    customFields: json<Record<string, unknown>>(r.customFields, {}),
    receivedAt: received,
    firstResponseAt: responded,
    lastActivityAt: iso(r.lastActivityAt),
    createdAt: iso(r.created_at),
    responseHours: received && responded ? Math.max(0, Math.round(((Date.parse(responded) - Date.parse(received)) / 3_600_000) * 10) / 10) : null,
    nextStep,
  };
}
