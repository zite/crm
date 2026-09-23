import { z } from 'zod';
import { zite } from 'zitejs/db';
import { bool, iso, json, num, Params, ref, str, withRetry } from '@project/shared/server/sql';
import { nextStepsFor } from '@project/shared/server/tasks';
import { jsonHasAny } from '@project/shared/server/records';

/**
 * The one contact query: the ledger, a company's Contacts tab, the peek sheet
 * and the merge picker all read rows through here. Counts are computed in SQL
 * and passed through `num()`, because zite.sql returns COUNT/SUM as strings.
 */

const id = z.string().min(1).max(64);

export const contactFilterSchema = z.object({
  ids: z.array(id).max(2000).optional(),
  companyId: id.optional(),
  companyIds: z.array(id).max(200).optional(),
  /** Member ids; 'none' matches contacts with no owner. */
  ownerIds: z.array(z.string()).optional(),
  tagIds: z.array(id).optional(),
  sources: z.array(z.string()).optional(),
  /** Contacts not attached to any company. */
  noCompany: z.boolean().optional(),
  doNotContact: z.boolean().optional(),
  unsubscribed: z.boolean().optional(),
  hasEmail: z.boolean().optional(),
  hasOpenDeals: z.boolean().optional(),
  /** Nothing logged in this many days (or ever). */
  staleDays: z.number().int().min(1).max(3650).optional(),
  /** In this deal's buying group (or its primary contact). */
  dealId: id.optional(),
  search: z.string().max(120).optional(),
  archived: z.boolean().optional(),
  custom: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
});
export type ContactFilters = z.infer<typeof contactFilterSchema>;

const nextStepSchema = z
  .object({ taskId: z.string(), title: z.string(), type: z.string(), dueDate: z.string().nullable(), dueTime: z.string().nullable(), ownerId: z.string().nullable() })
  .nullable();

export const contactRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  mobile: z.string().nullable(),
  title: z.string().nullable(),
  companyId: z.string().nullable(),
  companyName: z.string().nullable(),
  companyDomain: z.string().nullable(),
  ownerId: z.string().nullable(),
  source: z.string().nullable(),
  linkedinUrl: z.string().nullable(),
  city: z.string().nullable(),
  country: z.string().nullable(),
  timezone: z.string().nullable(),
  background: z.string().nullable(),
  doNotContact: z.boolean(),
  unsubscribedAt: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  lastActivityAt: z.string().nullable(),
  lastContactedAt: z.string().nullable(),
  createdAt: z.string().nullable(),
  archived: z.boolean(),
  tagIds: z.array(z.string()),
  customFields: z.record(z.any()),
  openDealCount: z.number(),
  openDealValue: z.number(),
  dealCount: z.number(),
  openTaskCount: z.number(),
  nextStep: nextStepSchema,
});
export type ContactRow = z.infer<typeof contactRowSchema>;

export const CONTACT_SORT_KEYS = ['name', 'title', 'company', 'email', 'owner', 'lastContactedAt', 'lastActivityAt', 'createdAt', 'openDeals', 'openValue'] as const;
export type ContactSortKey = (typeof CONTACT_SORT_KEYS)[number];

/** Every open deal a contact touches: the primary contact link or a buying-group row. */
const OPEN_DEAL_JOIN = `FROM "Deals" d WHERE d."status" = 'Open' AND COALESCE(d."archived", false) = false
  AND (d."contactId" = ct.id::text OR EXISTS (SELECT 1 FROM "DealContacts" dc WHERE dc."dealId" = d.id::text AND dc."contactId" = ct.id::text))`;

export async function queryContacts(f: ContactFilters, sort: { key: ContactSortKey; dir: 'asc' | 'desc' } | undefined, limit: number, today: string) {
  const p = new Params();
  const where: string[] = [];
  where.push(f.archived ? 'COALESCE(ct."archived", false) = true' : 'COALESCE(ct."archived", false) = false');
  if (f.ids?.length) where.push(`ct.id::text IN ${p.list(f.ids)}`);
  if (f.companyId) where.push(`ct."companyId" = ${p.add(f.companyId)}`);
  if (f.companyIds?.length) where.push(`ct."companyId" IN ${p.list(f.companyIds)}`);
  if (f.noCompany) where.push(`COALESCE(ct."companyId", '') = ''`);
  if (f.ownerIds?.length) {
    const real = f.ownerIds.filter(o => o !== 'none');
    const parts: string[] = [];
    if (real.length) parts.push(`ct."ownerId" IN ${p.list(real)}`);
    if (f.ownerIds.includes('none')) parts.push(`COALESCE(ct."ownerId", '') = ''`);
    where.push(`(${parts.join(' OR ')})`);
  }
  if (f.tagIds?.length) where.push(jsonHasAny('ct."tagIds"', p.list(f.tagIds)));
  if (f.sources?.length) where.push(`ct."source" IN ${p.list(f.sources)}`);
  if (f.doNotContact != null) where.push(`COALESCE(ct."doNotContact", false) = ${f.doNotContact ? 'true' : 'false'}`);
  if (f.unsubscribed === true) where.push(`ct."unsubscribedAt" IS NOT NULL`);
  if (f.unsubscribed === false) where.push(`ct."unsubscribedAt" IS NULL`);
  if (f.hasEmail === true) where.push(`COALESCE(ct."email", '') <> ''`);
  if (f.hasEmail === false) where.push(`COALESCE(ct."email", '') = ''`);
  if (f.hasOpenDeals === true) where.push(`EXISTS (SELECT 1 ${OPEN_DEAL_JOIN})`);
  if (f.hasOpenDeals === false) where.push(`NOT EXISTS (SELECT 1 ${OPEN_DEAL_JOIN})`);
  if (f.staleDays) where.push(`(ct."lastActivityAt" IS NULL OR ct."lastActivityAt" < (${p.add(today)}::date - ${p.add(f.staleDays)}::int))`);
  if (f.dealId) {
    const dealRef = p.add(f.dealId);
    where.push(`(EXISTS (SELECT 1 FROM "DealContacts" dc WHERE dc."dealId" = ${dealRef} AND dc."contactId" = ct.id::text)
      OR EXISTS (SELECT 1 FROM "Deals" d2 WHERE d2.id::text = ${dealRef} AND d2."contactId" = ct.id::text))`);
  }
  if (f.search?.trim()) {
    const like = p.add(`%${f.search.trim().toLowerCase()}%`);
    where.push(`(LOWER(ct."name") LIKE ${like} OR LOWER(ct."email") LIKE ${like} OR LOWER(ct."title") LIKE ${like} OR LOWER(co."name") LIKE ${like} OR LOWER(ct."phone") LIKE ${like})`);
  }
  if (f.custom && Object.keys(f.custom).length) {
    for (const [key, value] of Object.entries(f.custom)) {
      if (!/^[a-z0-9_]{1,40}$/.test(key) || value == null || value === '') continue;
      where.push(`COALESCE(NULLIF(ct."customFields", ''), '{}')::jsonb ->> ${p.add(key)} = ${p.add(String(value))}`);
    }
  }

  const dir = sort?.dir === 'desc' ? 'DESC' : 'ASC';
  const order =
    {
      name: `LOWER(ct."name") ${dir}`,
      title: `LOWER(ct."title") ${dir} NULLS LAST, LOWER(ct."name") ASC`,
      company: `LOWER(co."name") ${dir} NULLS LAST, LOWER(ct."name") ASC`,
      email: `LOWER(ct."email") ${dir} NULLS LAST`,
      owner: `LOWER(m."name") ${dir} NULLS LAST, LOWER(ct."name") ASC`,
      lastContactedAt: `ct."lastContactedAt" ${dir} NULLS LAST`,
      lastActivityAt: `ct."lastActivityAt" ${dir} NULLS LAST`,
      createdAt: `ct.created_at ${dir}`,
      openDeals: `"openDealTotal" ${dir}`,
      openValue: `"openDealSum" ${dir}`,
    }[sort?.key ?? 'name'] ?? `LOWER(ct."name") ASC`;

  const { rows, truncated } = await zite.sql({
    query: `
      SELECT ct.*, co."name" AS "companyName", co."domain" AS "companyDomain", m."name" AS "ownerName",
        (SELECT COUNT(*) ${OPEN_DEAL_JOIN}) AS "openDealTotal",
        (SELECT COALESCE(SUM(d."amount"), 0) ${OPEN_DEAL_JOIN}) AS "openDealSum",
        (SELECT COUNT(*) FROM "Deals" d WHERE d."contactId" = ct.id::text OR EXISTS (SELECT 1 FROM "DealContacts" dc WHERE dc."dealId" = d.id::text AND dc."contactId" = ct.id::text)) AS "dealTotal",
        (SELECT COUNT(*) FROM "Tasks" tk WHERE tk."contactId" = ct.id::text AND tk."status" = 'Open') AS "taskTotal"
      FROM "Contacts" ct
      LEFT JOIN "Companies" co ON co.id::text = ct."companyId"
      LEFT JOIN "Members" m ON m.id::text = ct."ownerId"
      WHERE ${where.join(' AND ')}
      ORDER BY ${order}, ct.created_at DESC
      LIMIT ${Math.min(limit, 2000)}`,
    params: p.values,
  });

  const next = await nextStepsFor('contactId', rows.map(r => String(r.id)));
  return {
    contacts: rows.map(r => toContactRow(r, next.get(String(r.id)) ?? null)),
    truncated: Boolean(truncated),
  };
}

export function toContactRow(r: Record<string, unknown>, nextStep: ContactRow['nextStep'] = null): ContactRow {
  return {
    id: String(r.id),
    name: str(r.name) ?? '',
    firstName: str(r.firstName) || null,
    lastName: str(r.lastName) || null,
    email: str(r.email) || null,
    phone: str(r.phone) || null,
    mobile: str(r.mobile) || null,
    title: str(r.title) || null,
    companyId: ref(r.companyId),
    companyName: str(r.companyName) || null,
    companyDomain: str(r.companyDomain) || null,
    ownerId: ref(r.ownerId),
    source: str(r.source) || null,
    linkedinUrl: str(r.linkedinUrl) || null,
    city: str(r.city) || null,
    country: str(r.country) || null,
    timezone: str(r.timezone) || null,
    background: str(r.background) || null,
    doNotContact: bool(r.doNotContact),
    unsubscribedAt: iso(r.unsubscribedAt),
    avatarUrl: str(r.avatarUrl) || null,
    lastActivityAt: iso(r.lastActivityAt),
    lastContactedAt: iso(r.lastContactedAt),
    createdAt: iso(r.created_at),
    archived: bool(r.archived),
    tagIds: json<string[]>(r.tagIds, []),
    customFields: json<Record<string, unknown>>(r.customFields, {}),
    openDealCount: num(r.openDealTotal),
    openDealValue: num(r.openDealSum),
    dealCount: num(r.dealTotal),
    openTaskCount: num(r.taskTotal),
    nextStep,
  };
}

/**
 * The one way a contact is removed. Nothing is orphaned: buying-group links and
 * sequence enrollments go (they only mean anything with a person on them), the
 * deals they were primary on lose their primary contact, and every activity,
 * task, note, file, quote and history event either keeps another link or is
 * deleted with them — nothing is left pointing at a person who isn't there.
 */
export async function detachAndDeleteContact(contactId: string) {
  const links = await zite.sql({
    query: `SELECT 'dealContacts' AS t, id, '' AS "otherLinks" FROM "DealContacts" WHERE "contactId" = $1
      UNION ALL SELECT 'enrollments', id, '' FROM "Enrollments" WHERE "contactId" = $1
      UNION ALL SELECT 'activities', id, CONCAT(COALESCE("companyId", ''), COALESCE("dealId", ''), COALESCE("leadId", '')) FROM "Activities" WHERE "contactId" = $1
      UNION ALL SELECT 'tasks', id, CONCAT(COALESCE("companyId", ''), COALESCE("dealId", ''), COALESCE("leadId", '')) FROM "Tasks" WHERE "contactId" = $1
      UNION ALL SELECT 'documents', id, CONCAT(COALESCE("companyId", ''), COALESCE("dealId", ''), COALESCE("leadId", '')) FROM "Documents" WHERE "contactId" = $1
      UNION ALL SELECT 'events', id, CONCAT(COALESCE("companyId", ''), COALESCE("dealId", ''), COALESCE("leadId", '')) FROM "Events" WHERE "contactId" = $1
      UNION ALL SELECT 'quotes', id, 'keep' FROM "Quotes" WHERE "contactId" = $1
      UNION ALL SELECT 'submissions', id, 'keep' FROM "Submissions" WHERE "contactId" = $1
      UNION ALL SELECT 'deals', id, 'keep' FROM "Deals" WHERE "contactId" = $1
      UNION ALL SELECT 'leads', id, 'keep' FROM "Leads" WHERE "convertedContactId" = $1`,
    params: [contactId],
  });
  for (const row of links.rows) {
    const table = String(row.t);
    const rowId = String(row.id);
    if (table === 'dealContacts' || table === 'enrollments') {
      await withRetry(() => (zite[table] as TableLike).delete({ id: rowId }));
    } else if (table === 'leads') {
      await withRetry(() => zite.leads.update({ id: rowId, record: { convertedContactId: null } as never }));
    } else if (row.otherLinks === '') {
      // Nothing else to hang it on — it would never be seen again.
      await withRetry(() => (zite[table as 'activities'] as TableLike).delete({ id: rowId }));
    } else {
      await withRetry(() => (zite[table as 'activities'] as TableLike).update({ id: rowId, record: { contactId: null } as never }));
    }
  }
  await withRetry(() => zite.contacts.delete({ id: contactId }));
}

type TableLike = { delete: (a: { id: string }) => Promise<unknown>; update: (a: { id: string; record: never }) => Promise<unknown> };

/** Everything a contact delete would touch, so the confirm can spell it out. */
export async function contactLinkCounts(contactId: string) {
  const { rows } = await zite.sql({
    query: `SELECT
      (SELECT COUNT(*) FROM "DealContacts" WHERE "contactId" = $1) AS "groupTotal",
      (SELECT COUNT(*) FROM "Deals" WHERE "contactId" = $1) AS "primaryTotal",
      (SELECT COUNT(*) FROM "Activities" WHERE "contactId" = $1) AS "activityTotal",
      (SELECT COUNT(*) FROM "Tasks" WHERE "contactId" = $1) AS "taskTotal",
      (SELECT COUNT(*) FROM "Documents" WHERE "contactId" = $1) AS "documentTotal",
      (SELECT COUNT(*) FROM "Quotes" WHERE "contactId" = $1) AS "quoteTotal",
      (SELECT COUNT(*) FROM "Enrollments" WHERE "contactId" = $1 AND "status" = 'Active') AS "enrollmentTotal"`,
    params: [contactId],
  });
  const r = rows[0] ?? {};
  return {
    buyingGroups: num(r.groupTotal),
    primaryOn: num(r.primaryTotal),
    activities: num(r.activityTotal),
    tasks: num(r.taskTotal),
    documents: num(r.documentTotal),
    quotes: num(r.quoteTotal),
    enrollments: num(r.enrollmentTotal),
  };
}
