import { zite } from 'zitejs/db';
import { ref, str } from './sql';

export type SearchKind = 'company' | 'contact' | 'deal' | 'lead';
export type SearchHit = { kind: SearchKind; id: string; title: string; subtitle: string | null; ownerId: string | null; companyId: string | null };

/**
 * Global search for the palette and pickers: names, emails, domains. Prefix
 * matches rank above substring matches; archived records are left out.
 */
export async function searchRecords(query: string, kinds: SearchKind[], limit = 8): Promise<SearchHit[]> {
  const q = query.trim().toLowerCase().slice(0, 80);
  if (!q) return [];
  const like = `%${q.replace(/[%_\\]/g, m => `\\${m}`)}%`;
  const prefix = `${q.replace(/[%_\\]/g, m => `\\${m}`)}%`;
  const parts: string[] = [];
  if (kinds.includes('company')) {
    parts.push(`(SELECT 'company' AS kind, c.id::text AS id, c."name" AS title, NULLIF(c."domain", '') AS subtitle, c."ownerId" AS "ownerRef", c.id::text AS "companyRef",
      CASE WHEN LOWER(c."name") LIKE $2 THEN 0 ELSE 1 END AS rank
      FROM "Companies" c WHERE COALESCE(c."archived", false) = false AND (LOWER(c."name") LIKE $1 OR LOWER(c."domain") LIKE $1) LIMIT $3)`);
  }
  if (kinds.includes('contact')) {
    parts.push(`(SELECT 'contact' AS kind, p.id::text AS id, p."name" AS title, NULLIF(CONCAT_WS(' · ', NULLIF(p."title", ''), NULLIF(co."name", ''), NULLIF(p."email", '')), '') AS subtitle, p."ownerId" AS "ownerRef", NULLIF(p."companyId", '') AS "companyRef",
      CASE WHEN LOWER(p."name") LIKE $2 OR LOWER(p."lastName") LIKE $2 THEN 0 ELSE 1 END AS rank
      FROM "Contacts" p LEFT JOIN "Companies" co ON co.id::text = p."companyId"
      WHERE COALESCE(p."archived", false) = false AND (LOWER(p."name") LIKE $1 OR LOWER(p."email") LIKE $1) LIMIT $3)`);
  }
  if (kinds.includes('deal')) {
    parts.push(`(SELECT 'deal' AS kind, d.id::text AS id, d."name" AS title, NULLIF(CONCAT_WS(' · ', NULLIF(co."name", ''), d."status"), '') AS subtitle, d."ownerId" AS "ownerRef", NULLIF(d."companyId", '') AS "companyRef",
      CASE WHEN LOWER(d."name") LIKE $2 THEN 0 ELSE 1 END AS rank
      FROM "Deals" d LEFT JOIN "Companies" co ON co.id::text = d."companyId"
      WHERE COALESCE(d."archived", false) = false AND (LOWER(d."name") LIKE $1 OR LOWER(co."name") LIKE $1) LIMIT $3)`);
  }
  if (kinds.includes('lead')) {
    parts.push(`(SELECT 'lead' AS kind, l.id::text AS id, l."name" AS title, NULLIF(CONCAT_WS(' · ', NULLIF(l."companyName", ''), NULLIF(l."email", ''), l."status"), '') AS subtitle, l."ownerId" AS "ownerRef", NULL AS "companyRef",
      CASE WHEN LOWER(l."name") LIKE $2 THEN 0 ELSE 1 END AS rank
      FROM "Leads" l WHERE LOWER(l."name") LIKE $1 OR LOWER(l."email") LIKE $1 OR LOWER(l."companyName") LIKE $1 LIMIT $3)`);
  }
  if (!parts.length) return [];
  const { rows } = await zite.sql({ query: `SELECT * FROM (${parts.join(' UNION ALL ')}) hits ORDER BY rank, title LIMIT $4`, params: [like, prefix, limit, limit * kinds.length] });
  return rows.map(r => ({ kind: String(r.kind) as SearchKind, id: String(r.id), title: str(r.title) ?? '', subtitle: str(r.subtitle) || null, ownerId: ref(r.ownerRef), companyId: ref(r.companyRef) }));
}
