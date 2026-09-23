import { ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import type { EntityType } from '../constants';
import { ref, str, withRetry } from './sql';

/**
 * Cross-record plumbing: resolving what an activity or task belongs to, keeping
 * "last activity" fresh, and naming/linking any record.
 */

export type Links = { companyId?: string | null; contactId?: string | null; dealId?: string | null; leadId?: string | null };

export const TABLE: Record<EntityType, 'Companies' | 'Contacts' | 'Deals' | 'Leads'> = {
  company: 'Companies',
  contact: 'Contacts',
  deal: 'Deals',
  lead: 'Leads',
};

export const entityPath = (type: string, id: string) =>
  ({ company: `/companies/${id}`, contact: `/contacts/${id}`, deal: `/deals/${id}`, lead: `/leads/${id}`, quote: `/quotes/${id}`, sequence: `/outreach/sequences/${id}`, form: `/outreach/forms/${id}` })[type] ?? '/home';

/** Fill in the company from a deal or contact, and verify every id exists. Throws NOT_FOUND for a bad id. */
export async function resolveLinks(links: Links): Promise<Required<Links>> {
  const out: Required<Links> = { companyId: links.companyId || null, contactId: links.contactId || null, dealId: links.dealId || null, leadId: links.leadId || null };
  if (out.dealId) {
    const { rows } = await zite.sql({ query: `SELECT "companyId" FROM "Deals" WHERE id::text = $1`, params: [out.dealId] });
    if (!rows[0]) throw new ZiteError('That deal no longer exists', 'NOT_FOUND');
    out.companyId = out.companyId ?? ref(rows[0].companyId);
  }
  if (out.contactId) {
    const { rows } = await zite.sql({ query: `SELECT "companyId" FROM "Contacts" WHERE id::text = $1`, params: [out.contactId] });
    if (!rows[0]) throw new ZiteError('That contact no longer exists', 'NOT_FOUND');
    out.companyId = out.companyId ?? ref(rows[0].companyId);
  }
  if (out.companyId) {
    const { rows } = await zite.sql({ query: `SELECT 1 FROM "Companies" WHERE id::text = $1`, params: [out.companyId] });
    if (!rows[0]) throw new ZiteError('That company no longer exists', 'NOT_FOUND');
  }
  if (out.leadId) {
    const { rows } = await zite.sql({ query: `SELECT 1 FROM "Leads" WHERE id::text = $1`, params: [out.leadId] });
    if (!rows[0]) throw new ZiteError('That lead no longer exists', 'NOT_FOUND');
  }
  return out;
}

/**
 * Bump `lastActivityAt` on every linked record (only forwards in time). For
 * outbound touches also set a contact's `lastContactedAt` and a lead's
 * `firstResponseAt` (speed-to-lead).
 */
export async function touchRecords(links: Links, at: string, opts: { outbound?: boolean } = {}) {
  const jobs: Array<Promise<unknown>> = [];
  const bump = async (table: 'companies' | 'contacts' | 'deals' | 'leads', sqlTable: string, id: string | null | undefined, extra: (row: Record<string, unknown>) => Record<string, unknown>) => {
    if (!id) return;
    const { rows } = await zite.sql({ query: `SELECT "lastActivityAt" ${sqlTable === 'Contacts' ? ', "lastContactedAt"' : ''} ${sqlTable === 'Leads' ? ', "firstResponseAt", "status"' : ''} FROM "${sqlTable}" WHERE id::text = $1`, params: [id] });
    const row = rows[0];
    if (!row) return;
    const patch: Record<string, unknown> = {};
    if (!row.lastActivityAt || Date.parse(String(row.lastActivityAt)) < Date.parse(at)) patch.lastActivityAt = at;
    Object.assign(patch, extra(row));
    if (Object.keys(patch).length) await withRetry(() => (zite[table] as { update: (a: { id: string; record: never }) => Promise<unknown> }).update({ id, record: patch as never }));
  };
  // Sequential on purpose: live Zite rate-limits bursts of parallel writes.
  await bump('deals', 'Deals', links.dealId, () => ({}));
  await bump('companies', 'Companies', links.companyId, () => ({}));
  await bump('contacts', 'Contacts', links.contactId, row =>
    opts.outbound && (!row.lastContactedAt || Date.parse(String(row.lastContactedAt)) < Date.parse(at)) ? { lastContactedAt: at } : {},
  );
  await bump('leads', 'Leads', links.leadId, row => ({
    ...(opts.outbound && !row.firstResponseAt ? { firstResponseAt: at } : {}),
    // Reaching out to a new lead starts working it.
    ...(opts.outbound && row.status === 'New' ? { status: 'Working' } : {}),
  }));
  await Promise.all(jobs);
}

export async function recordName(type: EntityType, id: string): Promise<string> {
  const { rows } = await zite.sql({ query: `SELECT "name" FROM "${TABLE[type]}" WHERE id::text = $1`, params: [id] });
  return str(rows[0]?.name) ?? '';
}

export async function recordOwner(type: EntityType, id: string): Promise<string | null> {
  const { rows } = await zite.sql({ query: `SELECT "ownerId" FROM "${TABLE[type]}" WHERE id::text = $1`, params: [id] });
  return ref(rows[0]?.ownerId);
}

/** Parse a JSON id array column ('["a","b"]'), tolerating '' and junk. */
export function idList(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String);
  if (raw == null || raw === '') return [];
  try {
    const v = JSON.parse(String(raw));
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

/** SQL predicate: a JSON id-array text column contains $n. */
export const jsonHas = (col: string, param: string) => `COALESCE(NULLIF(${col}, ''), '[]')::jsonb @> jsonb_build_array(${param}::text)`;
/** SQL predicate: a JSON id-array text column contains any of a bound list, e.g. jsonHasAny('"tagIds"', p.list(ids)). */
export const jsonHasAny = (col: string, placeholderList: string) =>
  `EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(NULLIF(${col}, ''), '[]')::jsonb) AS tag_el(v) WHERE tag_el.v IN ${placeholderList})`;
