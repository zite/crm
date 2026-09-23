import { z } from 'zod';
import { createEndpoint } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { getActor } from '@project/shared/server/actor';
import { iso, num, ref, str } from '@project/shared/server/sql';
import { parseInput } from '../server/input';
import { normalizeDomain } from '../server/companyQuery';

/**
 * Two records for the same company or person: the thing every CRM accumulates
 * and nobody notices until a rep emails the wrong row. Companies match on their
 * domain first (the strongest signal) and then on a stripped name — "Acme Inc."
 * and "acme" are the same buyer. Contacts match on their email address.
 */

const inputSchema = z.object({
  type: z.enum(['company', 'contact']),
  /** Only groups that contain this record — the banner on a record page. */
  id: z.string().min(1).max(64).optional(),
  limit: z.number().int().min(1).max(100).optional(),
});

const recordSchema = z.object({
  id: z.string(),
  name: z.string(),
  subtitle: z.string().nullable(),
  ownerId: z.string().nullable(),
  createdAt: z.string().nullable(),
  lastActivityAt: z.string().nullable(),
  logoUrl: z.string().nullable(),
  dealCount: z.number(),
  contactCount: z.number(),
  activityCount: z.number(),
});

const LEGAL_SUFFIX = /(incorporated|corporation|holdings|limited|company|group|plc|inc|llc|ltd|corp|gmbh|co)$/;

/** "Acme Inc." and "ACME, LLC" collapse to the same key; "Acme Foods" does not. */
function nameKey(name: string) {
  const squashed = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '');
  const stripped = squashed.replace(LEGAL_SUFFIX, '');
  return (stripped.length >= 3 ? stripped : squashed) || '';
}

export default createEndpoint({
  description: 'Find companies that share a domain or name, or contacts that share an email address',
  authenticated: true,
  inputSchema,
  outputSchema: z.object({
    groups: z.array(z.object({ key: z.string(), reason: z.string(), records: z.array(recordSchema) })),
    scanned: z.number(),
  }),
  execute: async ({ input, context }) => {
    const { type, id, limit = 50 } = parseInput(inputSchema, input);
    await getActor(context);

    const rows = type === 'company' ? await scanCompanies() : await scanContacts();
    const buckets = new Map<string, { reason: string; ids: string[] }>();
    for (const row of rows) {
      for (const [key, reason] of row.keys) {
        if (!key) continue;
        if (!buckets.has(key)) buckets.set(key, { reason, ids: [] });
        buckets.get(key)!.ids.push(row.id);
      }
    }

    const byId = new Map(rows.map(r => [r.id, r]));
    const seen = new Set<string>();
    let groups: Array<{ key: string; reason: string; records: Array<z.infer<typeof recordSchema>> }> = [];
    for (const [key, bucket] of buckets) {
      if (bucket.ids.length < 2) continue;
      if (id && !bucket.ids.includes(id)) continue;
      // A pair that matches on both domain and name shows once, under the domain.
      const signature = [...bucket.ids].sort().join('|');
      if (seen.has(signature)) continue;
      seen.add(signature);
      groups.push({
        key,
        reason: bucket.reason,
        records: bucket.ids
          .map(rid => byId.get(rid)!)
          .sort((a, b) => Date.parse(a.record.createdAt ?? '') - Date.parse(b.record.createdAt ?? ''))
          .map(r => r.record),
      });
    }
    groups.sort((a, b) => b.records.length - a.records.length || a.records[0].name.localeCompare(b.records[0].name));
    groups = groups.slice(0, limit);
    return { groups, scanned: rows.length };
  },
});

type Scanned = { id: string; keys: Array<[string, string]>; record: z.infer<typeof recordSchema> };

async function scanCompanies(): Promise<Scanned[]> {
  const { rows } = await zite.sql({
    query: `SELECT c.id, c."name", c."domain", c."website", c."city", c."ownerId", c."logoUrl", c."lastActivityAt", c.created_at,
        (SELECT COUNT(*) FROM "Deals" d WHERE d."companyId" = c.id::text) AS "dealTotal",
        (SELECT COUNT(*) FROM "Contacts" ct WHERE ct."companyId" = c.id::text) AS "contactTotal",
        (SELECT COUNT(*) FROM "Activities" a WHERE a."companyId" = c.id::text) AS "activityTotal"
      FROM "Companies" c WHERE COALESCE(c."archived", false) = false
      ORDER BY c.created_at ASC LIMIT 2000`,
    params: [],
  });
  return rows.map(r => {
    const name = str(r.name) ?? '';
    const domain = normalizeDomain(str(r.domain) || str(r.website));
    const keys: Array<[string, string]> = [];
    if (domain) keys.push([`domain:${domain}`, 'Same domain']);
    const key = nameKey(name);
    if (key.length >= 3) keys.push([`name:${key}`, 'Same name']);
    return {
      id: String(r.id),
      keys,
      record: {
        id: String(r.id),
        name,
        subtitle: domain || str(r.city) || null,
        ownerId: ref(r.ownerId),
        createdAt: iso(r.created_at),
        lastActivityAt: iso(r.lastActivityAt),
        logoUrl: str(r.logoUrl) || null,
        dealCount: num(r.dealTotal),
        contactCount: num(r.contactTotal),
        activityCount: num(r.activityTotal),
      },
    };
  });
}

async function scanContacts(): Promise<Scanned[]> {
  const { rows } = await zite.sql({
    query: `SELECT ct.id, ct."name", ct."email", ct."title", ct."ownerId", ct."avatarUrl", ct."lastActivityAt", ct.created_at, co."name" AS "companyName",
        (SELECT COUNT(*) FROM "Deals" d WHERE d."contactId" = ct.id::text OR EXISTS (SELECT 1 FROM "DealContacts" dc WHERE dc."dealId" = d.id::text AND dc."contactId" = ct.id::text)) AS "dealTotal",
        (SELECT COUNT(*) FROM "Activities" a WHERE a."contactId" = ct.id::text) AS "activityTotal"
      FROM "Contacts" ct LEFT JOIN "Companies" co ON co.id::text = ct."companyId"
      WHERE COALESCE(ct."archived", false) = false AND COALESCE(ct."email", '') <> ''
      ORDER BY ct.created_at ASC LIMIT 2000`,
    params: [],
  });
  return rows.map(r => {
    const email = (str(r.email) ?? '').trim().toLowerCase();
    return {
      id: String(r.id),
      keys: email ? ([[`email:${email}`, 'Same email address']] as Array<[string, string]>) : [],
      record: {
        id: String(r.id),
        name: str(r.name) ?? '',
        subtitle: [str(r.title), str(r.companyName)].filter(Boolean).join(' · ') || email || null,
        ownerId: ref(r.ownerId),
        createdAt: iso(r.created_at),
        lastActivityAt: iso(r.lastActivityAt),
        logoUrl: str(r.avatarUrl) || null,
        dealCount: num(r.dealTotal),
        contactCount: 0,
        activityCount: num(r.activityTotal),
      },
    };
  });
}
