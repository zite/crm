import { z } from 'zod';
import { zite } from 'zitejs/db';
import { bool, day, iso, json, num, numOrNull, Params, ref, str, withRetry } from '@project/shared/server/sql';
import { nextStepsFor } from '@project/shared/server/tasks';
import { jsonHasAny } from '@project/shared/server/records';

/**
 * The one company query: the ledger, a saved view, the peek sheet, the merge
 * picker and a contact's company card all read rows through here, so a company
 * looks the same everywhere and carries the counts its row shows.
 *
 * Every aggregate is computed in SQL and passed through `num()` — zite.sql
 * returns COUNT/SUM as strings.
 */

const id = z.string().min(1).max(64);

/**
 * One spelling of a domain, so duplicate detection and "same company" checks
 * agree: lower case, no scheme, no `www.`, no path, no trailing dot.
 */
export function normalizeDomain(value: string | null | undefined): string | null {
  const raw = (value ?? '').trim().toLowerCase();
  if (!raw) return null;
  const host = raw
    .replace(/^[a-z]+:\/\//, '')
    .replace(/^www\./, '')
    .split(/[/?#]/)[0]
    .replace(/\.+$/, '')
    .replace(/^@/, '');
  return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(host) ? host.slice(0, 240) : null;
}

export const companyFilterSchema = z.object({
  ids: z.array(id).max(2000).optional(),
  /** Company types: Prospect, Customer, Partner, Former Customer, Other. */
  types: z.array(z.string()).optional(),
  industries: z.array(z.string()).optional(),
  /** Member ids; 'none' matches companies with no owner. */
  ownerIds: z.array(z.string()).optional(),
  tagIds: z.array(id).optional(),
  sources: z.array(z.string()).optional(),
  parentCompanyId: id.optional(),
  /** Only companies with at least one open deal (true) or none (false). */
  hasOpenDeals: z.boolean().optional(),
  /** Nothing logged in this many days (or ever). */
  staleDays: z.number().int().min(1).max(3650).optional(),
  search: z.string().max(120).optional(),
  archived: z.boolean().optional(),
  /** Custom field key → exact value. */
  custom: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
});
export type CompanyFilters = z.infer<typeof companyFilterSchema>;

export const nextStepSchema = z
  .object({ taskId: z.string(), title: z.string(), type: z.string(), dueDate: z.string().nullable(), dueTime: z.string().nullable(), ownerId: z.string().nullable() })
  .nullable();

export const companyRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  domain: z.string().nullable(),
  website: z.string().nullable(),
  industry: z.string().nullable(),
  type: z.string().nullable(),
  employees: z.number().nullable(),
  annualRevenue: z.number().nullable(),
  ownerId: z.string().nullable(),
  parentCompanyId: z.string().nullable(),
  parentName: z.string().nullable(),
  phone: z.string().nullable(),
  linkedinUrl: z.string().nullable(),
  address: z.string().nullable(),
  city: z.string().nullable(),
  region: z.string().nullable(),
  postalCode: z.string().nullable(),
  country: z.string().nullable(),
  description: z.string().nullable(),
  source: z.string().nullable(),
  logoUrl: z.string().nullable(),
  customerSince: z.string().nullable(),
  lastActivityAt: z.string().nullable(),
  createdAt: z.string().nullable(),
  archived: z.boolean(),
  tagIds: z.array(z.string()),
  customFields: z.record(z.any()),
  /** Counts the ledger shows, all computed in SQL. */
  contactCount: z.number(),
  openDealCount: z.number(),
  openDealValue: z.number(),
  wonDealCount: z.number(),
  wonValue: z.number(),
  openTaskCount: z.number(),
  childCount: z.number(),
  nextStep: nextStepSchema,
});
export type CompanyRow = z.infer<typeof companyRowSchema>;

export const COMPANY_SORT_KEYS = ['name', 'type', 'industry', 'owner', 'employees', 'revenue', 'contacts', 'openDeals', 'openValue', 'wonValue', 'lastActivityAt', 'createdAt', 'customerSince'] as const;
export type CompanySortKey = (typeof COMPANY_SORT_KEYS)[number];

/** Open, un-archived deals — the set every "open pipeline" figure on a company counts. */
const OPEN_DEALS = `SELECT 1 FROM "Deals" od WHERE od."companyId" = c.id::text AND od."status" = 'Open' AND COALESCE(od."archived", false) = false`;

export async function queryCompanies(f: CompanyFilters, sort: { key: CompanySortKey; dir: 'asc' | 'desc' } | undefined, limit: number, today: string) {
  const p = new Params();
  const where: string[] = [];
  where.push(f.archived ? 'COALESCE(c."archived", false) = true' : 'COALESCE(c."archived", false) = false');
  if (f.ids?.length) where.push(`c.id::text IN ${p.list(f.ids)}`);
  if (f.types?.length) where.push(`c."type" IN ${p.list(f.types)}`);
  if (f.industries?.length) where.push(`c."industry" IN ${p.list(f.industries)}`);
  if (f.ownerIds?.length) {
    const real = f.ownerIds.filter(o => o !== 'none');
    const parts: string[] = [];
    if (real.length) parts.push(`c."ownerId" IN ${p.list(real)}`);
    if (f.ownerIds.includes('none')) parts.push(`COALESCE(c."ownerId", '') = ''`);
    where.push(`(${parts.join(' OR ')})`);
  }
  if (f.tagIds?.length) where.push(jsonHasAny('c."tagIds"', p.list(f.tagIds)));
  if (f.sources?.length) where.push(`c."source" IN ${p.list(f.sources)}`);
  if (f.parentCompanyId) where.push(`c."parentCompanyId" = ${p.add(f.parentCompanyId)}`);
  if (f.hasOpenDeals === true) where.push(`EXISTS (${OPEN_DEALS})`);
  if (f.hasOpenDeals === false) where.push(`NOT EXISTS (${OPEN_DEALS})`);
  if (f.staleDays) where.push(`(c."lastActivityAt" IS NULL OR c."lastActivityAt" < (${p.add(today)}::date - ${p.add(f.staleDays)}::int))`);
  if (f.search?.trim()) {
    const like = p.add(`%${f.search.trim().toLowerCase()}%`);
    where.push(`(LOWER(c."name") LIKE ${like} OR LOWER(c."domain") LIKE ${like} OR LOWER(c."city") LIKE ${like} OR LOWER(c."industry") LIKE ${like})`);
  }
  if (f.custom && Object.keys(f.custom).length) {
    for (const [key, value] of Object.entries(f.custom)) {
      if (!/^[a-z0-9_]{1,40}$/.test(key) || value == null || value === '') continue;
      where.push(`COALESCE(NULLIF(c."customFields", ''), '{}')::jsonb ->> ${p.add(key)} = ${p.add(String(value))}`);
    }
  }

  const dir = sort?.dir === 'desc' ? 'DESC' : 'ASC';
  // ORDER BY may name an output column, which keeps each aggregate written once.
  const order =
    {
      name: `LOWER(c."name") ${dir}`,
      type: `c."type" ${dir} NULLS LAST, LOWER(c."name") ASC`,
      industry: `c."industry" ${dir} NULLS LAST, LOWER(c."name") ASC`,
      owner: `LOWER(m."name") ${dir} NULLS LAST, LOWER(c."name") ASC`,
      employees: `c."employees" ${dir} NULLS LAST`,
      revenue: `c."annualRevenue" ${dir} NULLS LAST`,
      contacts: `"contactTotal" ${dir}`,
      openDeals: `"openDealTotal" ${dir}`,
      openValue: `"openDealSum" ${dir}`,
      wonValue: `"wonSum" ${dir}`,
      lastActivityAt: `c."lastActivityAt" ${dir} NULLS LAST`,
      createdAt: `c.created_at ${dir}`,
      customerSince: `c."customerSince" ${dir} NULLS LAST`,
    }[sort?.key ?? 'name'] ?? `LOWER(c."name") ASC`;

  const { rows, truncated } = await zite.sql({
    query: `
      SELECT c.*, m."name" AS "ownerName", pc."name" AS "parentName",
        (SELECT COUNT(*) FROM "Contacts" ct WHERE ct."companyId" = c.id::text AND COALESCE(ct."archived", false) = false) AS "contactTotal",
        (SELECT COUNT(*) FROM "Deals" d WHERE d."companyId" = c.id::text AND d."status" = 'Open' AND COALESCE(d."archived", false) = false) AS "openDealTotal",
        (SELECT COALESCE(SUM(d."amount"), 0) FROM "Deals" d WHERE d."companyId" = c.id::text AND d."status" = 'Open' AND COALESCE(d."archived", false) = false) AS "openDealSum",
        (SELECT COUNT(*) FROM "Deals" d WHERE d."companyId" = c.id::text AND d."status" = 'Won') AS "wonTotal",
        (SELECT COALESCE(SUM(d."amount"), 0) FROM "Deals" d WHERE d."companyId" = c.id::text AND d."status" = 'Won') AS "wonSum",
        (SELECT COUNT(*) FROM "Tasks" tk WHERE tk."companyId" = c.id::text AND tk."status" = 'Open') AS "taskTotal",
        (SELECT COUNT(*) FROM "Companies" ch WHERE ch."parentCompanyId" = c.id::text) AS "childTotal"
      FROM "Companies" c
      LEFT JOIN "Members" m ON m.id::text = c."ownerId"
      LEFT JOIN "Companies" pc ON pc.id::text = c."parentCompanyId"
      WHERE ${where.join(' AND ')}
      ORDER BY ${order}, c.created_at DESC
      LIMIT ${Math.min(limit, 2000)}`,
    params: p.values,
  });

  const next = await nextStepsFor('companyId', rows.map(r => String(r.id)));
  return {
    companies: rows.map(r => toCompanyRow(r, next.get(String(r.id)) ?? null)),
    truncated: Boolean(truncated),
  };
}

export function toCompanyRow(r: Record<string, unknown>, nextStep: CompanyRow['nextStep'] = null): CompanyRow {
  return {
    id: String(r.id),
    name: str(r.name) ?? '',
    domain: str(r.domain) || null,
    website: str(r.website) || null,
    industry: str(r.industry) || null,
    type: str(r.type) || null,
    employees: numOrNull(r.employees),
    annualRevenue: numOrNull(r.annualRevenue),
    ownerId: ref(r.ownerId),
    parentCompanyId: ref(r.parentCompanyId),
    parentName: str(r.parentName) || null,
    phone: str(r.phone) || null,
    linkedinUrl: str(r.linkedinUrl) || null,
    address: str(r.address) || null,
    city: str(r.city) || null,
    region: str(r.region) || null,
    postalCode: str(r.postalCode) || null,
    country: str(r.country) || null,
    description: str(r.description) || null,
    source: str(r.source) || null,
    logoUrl: str(r.logoUrl) || null,
    customerSince: day(r.customerSince),
    lastActivityAt: iso(r.lastActivityAt),
    createdAt: iso(r.created_at),
    archived: bool(r.archived),
    tagIds: json<string[]>(r.tagIds, []),
    customFields: json<Record<string, unknown>>(r.customFields, {}),
    contactCount: num(r.contactTotal),
    openDealCount: num(r.openDealTotal),
    openDealValue: num(r.openDealSum),
    wonDealCount: num(r.wonTotal),
    wonValue: num(r.wonSum),
    openTaskCount: num(r.taskTotal),
    childCount: num(r.childTotal),
    nextStep,
  };
}

type TableLike = { delete: (a: { id: string }) => Promise<unknown>; update: (a: { id: string; record: never }) => Promise<unknown> };

/**
 * Delete one deal the same way `deleteDeals` does: its line items, buying group
 * and stage history go; activities, tasks and quotes keep their other links.
 */
export async function detachAndDeleteDeal(dealId: string) {
  const children = await zite.sql({
    query: `SELECT 'dealContacts' AS t, id FROM "DealContacts" WHERE "dealId" = $1
      UNION ALL SELECT 'lineItems', id FROM "LineItems" WHERE "dealId" = $1
      UNION ALL SELECT 'stageChanges', id FROM "StageChanges" WHERE "dealId" = $1
      UNION ALL SELECT 'activities', id FROM "Activities" WHERE "dealId" = $1
      UNION ALL SELECT 'tasks', id FROM "Tasks" WHERE "dealId" = $1
      UNION ALL SELECT 'documents', id FROM "Documents" WHERE "dealId" = $1
      UNION ALL SELECT 'events', id FROM "Events" WHERE "dealId" = $1
      UNION ALL SELECT 'enrollments', id FROM "Enrollments" WHERE "dealId" = $1
      UNION ALL SELECT 'quotes', id FROM "Quotes" WHERE "dealId" = $1
      UNION ALL SELECT 'leads', id FROM "Leads" WHERE "convertedDealId" = $1`,
    params: [dealId],
  });
  for (const c of children.rows) {
    const table = String(c.t);
    const childId = String(c.id);
    if (table === 'dealContacts' || table === 'lineItems' || table === 'stageChanges') {
      await withRetry(() => (zite[table as 'lineItems'] as TableLike).delete({ id: childId }));
    } else if (table === 'leads') {
      await withRetry(() => zite.leads.update({ id: childId, record: { convertedDealId: null } as never }));
    } else {
      await withRetry(() => (zite[table as 'activities'] as TableLike).update({ id: childId, record: { dealId: null } as never }));
    }
  }
  await withRetry(() => zite.deals.delete({ id: dealId }));
}

/**
 * The one way a company is removed. Subsidiaries are never deleted — they are
 * separate companies and simply stop having a parent. Anything still pointing at
 * the company keeps another link or goes with it, so nothing is orphaned.
 */
export async function detachAndDeleteCompany(companyId: string) {
  const { rows: children } = await zite.sql({ query: `SELECT id FROM "Companies" WHERE "parentCompanyId" = $1`, params: [companyId] });
  for (const child of children) {
    await withRetry(() => zite.companies.update({ id: String(child.id), record: { parentCompanyId: null } as never }));
  }
  const links = await zite.sql({
    query: `SELECT 'activities' AS t, id, CONCAT(COALESCE("contactId", ''), COALESCE("dealId", ''), COALESCE("leadId", '')) AS "otherLinks" FROM "Activities" WHERE "companyId" = $1
      UNION ALL SELECT 'tasks', id, CONCAT(COALESCE("contactId", ''), COALESCE("dealId", ''), COALESCE("leadId", '')) FROM "Tasks" WHERE "companyId" = $1
      UNION ALL SELECT 'documents', id, CONCAT(COALESCE("contactId", ''), COALESCE("dealId", ''), COALESCE("leadId", '')) FROM "Documents" WHERE "companyId" = $1
      UNION ALL SELECT 'events', id, CONCAT(COALESCE("contactId", ''), COALESCE("dealId", ''), COALESCE("leadId", '')) FROM "Events" WHERE "companyId" = $1
      UNION ALL SELECT 'quotes', id, 'keep' FROM "Quotes" WHERE "companyId" = $1
      UNION ALL SELECT 'leads', id, 'keep' FROM "Leads" WHERE "convertedCompanyId" = $1`,
    params: [companyId],
  });
  for (const row of links.rows) {
    const table = String(row.t);
    const rowId = String(row.id);
    if (table === 'leads') {
      await withRetry(() => zite.leads.update({ id: rowId, record: { convertedCompanyId: null } as never }));
    } else if (row.otherLinks === '') {
      await withRetry(() => (zite[table as 'activities'] as TableLike).delete({ id: rowId }));
    } else {
      await withRetry(() => (zite[table as 'activities'] as TableLike).update({ id: rowId, record: { companyId: null } as never }));
    }
  }
  await withRetry(() => zite.companies.delete({ id: companyId }));
}

/** Everything a company delete would take with it, so the confirm can spell it out. */
export async function companyLinkCounts(companyId: string) {
  const { rows } = await zite.sql({
    query: `SELECT
      (SELECT COUNT(*) FROM "Contacts" WHERE "companyId" = $1) AS "contactTotal",
      (SELECT COUNT(*) FROM "Deals" WHERE "companyId" = $1) AS "dealTotal",
      (SELECT COUNT(*) FROM "Deals" WHERE "companyId" = $1 AND "status" = 'Open') AS "openDealTotal",
      (SELECT COUNT(*) FROM "Quotes" WHERE "companyId" = $1) AS "quoteTotal",
      (SELECT COUNT(*) FROM "Activities" WHERE "companyId" = $1) AS "activityTotal",
      (SELECT COUNT(*) FROM "Tasks" WHERE "companyId" = $1) AS "taskTotal",
      (SELECT COUNT(*) FROM "Documents" WHERE "companyId" = $1) AS "documentTotal",
      (SELECT COUNT(*) FROM "Companies" WHERE "parentCompanyId" = $1) AS "childTotal"`,
    params: [companyId],
  });
  const r = rows[0] ?? {};
  return {
    contacts: num(r.contactTotal),
    deals: num(r.dealTotal),
    openDeals: num(r.openDealTotal),
    quotes: num(r.quoteTotal),
    activities: num(r.activityTotal),
    tasks: num(r.taskTotal),
    documents: num(r.documentTotal),
    children: num(r.childTotal),
  };
}
