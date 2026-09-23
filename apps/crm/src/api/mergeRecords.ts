import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { assertCan, assertCanDelete, getActor } from '@project/shared/server/actor';
import { logEvent } from '@project/shared/server/events';
import { idList } from '@project/shared/server/records';
import { iso, num, ref, str, withRetry } from '@project/shared/server/sql';
import { parseCustomValues } from '@project/shared/customFields';
import { plural } from '@project/shared/format';
import { id, parseInput } from '../server/input';

/**
 * Merge duplicates into one record.
 *
 * The survivor must be the OLDER record, because `created_at` is a system
 * column Zite won't let an app write — keeping the older id is the only way to
 * keep the older creation date, and it also keeps every link people already
 * have. Where the newer record knows more, `prefer: 'newest'` copies its
 * non-empty values across; either way blanks on the survivor are filled in from
 * the duplicates, tags are unioned and custom values are merged.
 *
 * Everything that pointed at a duplicate — deals, contacts, activities and
 * notes, tasks, files, quotes, sequence enrollments, form submissions,
 * converted leads and subsidiaries — is moved onto the survivor before the
 * duplicate is deleted, so nothing is lost and nothing is left dangling.
 */

const inputSchema = z.object({
  type: z.enum(['company', 'contact']),
  survivorId: id,
  duplicateIds: z.array(id).min(1).max(20),
  /** Whose field values win where both records have one. */
  prefer: z.enum(['survivor', 'newest']).optional(),
});

/** Columns copied from a duplicate into a blank on the survivor. */
const COMPANY_FIELDS = ['domain', 'website', 'industry', 'type', 'employees', 'annualRevenue', 'ownerId', 'parentCompanyId', 'phone', 'linkedinUrl', 'address', 'city', 'region', 'postalCode', 'country', 'description', 'source', 'logoUrl', 'customerSince'] as const;
const CONTACT_FIELDS = ['firstName', 'lastName', 'email', 'phone', 'mobile', 'title', 'companyId', 'ownerId', 'source', 'linkedinUrl', 'city', 'country', 'timezone', 'background', 'avatarUrl'] as const;

type TableLike = { delete: (a: { id: string }) => Promise<unknown>; update: (a: { id: string; record: never }) => Promise<unknown> };

export default createEndpoint({
  description: 'Merge duplicate companies or contacts into one, moving every linked record onto the survivor',
  authenticated: true,
  inputSchema,
  outputSchema: z.object({
    survivorId: z.string(),
    merged: z.number(),
    moved: z.object({ deals: z.number(), contacts: z.number(), activities: z.number(), tasks: z.number(), documents: z.number(), quotes: z.number(), other: z.number() }),
  }),
  execute: async ({ input, context }) => {
    const { type, survivorId, duplicateIds, prefer = 'survivor' } = parseInput(inputSchema, input);
    const actor = await getActor(context);
    assertCan(actor, 'records.edit');

    const table = type === 'company' ? 'Companies' : 'Contacts';
    const noun = type === 'company' ? 'company' : 'contact';
    const ids = [...new Set(duplicateIds)].filter(d => d !== survivorId);
    if (!ids.length) throw new ZiteError(`Choose at least one other ${noun} to merge in`, 'BAD_REQUEST');

    const { rows } = await zite.sql({ query: `SELECT * FROM "${table}" WHERE id::text = $1`, params: [survivorId] });
    const survivor = rows[0];
    if (!survivor) throw new ZiteError(`That ${noun} doesn’t exist or was deleted`, 'NOT_FOUND');

    const dupes: Array<Record<string, unknown>> = [];
    for (const dupId of ids) {
      const { rows: dupRows } = await zite.sql({ query: `SELECT * FROM "${table}" WHERE id::text = $1`, params: [dupId] });
      const dupe = dupRows[0];
      if (!dupe) throw new ZiteError(`One of those ${noun}s no longer exists`, 'NOT_FOUND');
      assertCanDelete(actor, ref(dupe.ownerId), noun);
      if (Date.parse(String(dupe.created_at)) < Date.parse(String(survivor.created_at))) {
        throw new ZiteError(`Keep the older record — “${str(dupe.name) ?? ''}” was added first, so merge the newer ones into it.`, 'BAD_REQUEST');
      }
      dupes.push(dupe);
    }

    const moved = { deals: 0, contacts: 0, activities: 0, tasks: 0, documents: 0, quotes: 0, other: 0 };
    for (const dupe of dupes) {
      const dupId = String(dupe.id);
      if (type === 'company') await moveCompanyLinks(dupId, survivorId, moved);
      else await moveContactLinks(dupId, survivorId, moved);
    }

    // Field values: survivor first (or newest first when asked), then fill blanks.
    const ordered = prefer === 'newest' ? [...dupes].sort((a, b) => Date.parse(String(b.created_at)) - Date.parse(String(a.created_at))) : [];
    const sources = [...ordered, ...dupes];
    const fields = type === 'company' ? COMPANY_FIELDS : CONTACT_FIELDS;
    const record: Record<string, unknown> = {};
    for (const field of fields) {
      const own = survivor[field];
      const has = own != null && own !== '';
      if (has && prefer !== 'newest') continue;
      for (const source of sources) {
        const v = source[field];
        if (v == null || v === '') continue;
        if (field === 'parentCompanyId' && String(v) === survivorId) continue;
        if (field === 'companyId' && type === 'contact' && has && prefer !== 'newest') continue;
        record[field] = v;
        break;
      }
    }
    // Never let a merge point a company at itself.
    if (record.parentCompanyId === survivorId) delete record.parentCompanyId;

    const tags = new Set<string>(idList(survivor.tagIds));
    for (const dupe of dupes) idList(dupe.tagIds).forEach(t => tags.add(t));
    if (tags.size !== idList(survivor.tagIds).length) record.tagIds = JSON.stringify([...tags]);

    const custom = { ...parseCustomValues(survivor.customFields) };
    for (const dupe of dupes) {
      for (const [k, v] of Object.entries(parseCustomValues(dupe.customFields))) {
        if (custom[k] == null || custom[k] === '') custom[k] = v;
      }
    }
    if (Object.keys(custom).length) record.customFields = JSON.stringify(custom);

    // Dates and flags take the most protective value, not the survivor's.
    const latest = (field: string) => {
      const values = [survivor[field], ...dupes.map(d => d[field])].map(v => iso(v)).filter(Boolean) as string[];
      return values.sort().pop() ?? null;
    };
    const lastActivityAt = latest('lastActivityAt');
    if (lastActivityAt && lastActivityAt !== iso(survivor.lastActivityAt)) record.lastActivityAt = lastActivityAt;
    if (type === 'contact') {
      const lastContactedAt = latest('lastContactedAt');
      if (lastContactedAt && lastContactedAt !== iso(survivor.lastContactedAt)) record.lastContactedAt = lastContactedAt;
      if (dupes.some(d => d.doNotContact === true) && survivor.doNotContact !== true) record.doNotContact = true;
      const unsubscribed = [survivor.unsubscribedAt, ...dupes.map(d => d.unsubscribedAt)].map(v => iso(v)).filter(Boolean) as string[];
      if (unsubscribed.length && !iso(survivor.unsubscribedAt)) record.unsubscribedAt = unsubscribed.sort()[0];
    }

    if (Object.keys(record).length) await withRetry(() => (zite[type === 'company' ? 'companies' : 'contacts'] as TableLike).update({ id: survivorId, record: record as never }));

    for (const dupe of dupes) {
      await withRetry(() => (zite[type === 'company' ? 'companies' : 'contacts'] as TableLike).delete({ id: String(dupe.id) }));
    }

    const names = dupes.map(d => `“${str(d.name) ?? ''}”`).join(', ');
    const parts = [
      moved.deals ? plural(moved.deals, 'deal') : '',
      moved.contacts ? plural(moved.contacts, 'contact') : '',
      moved.activities ? plural(moved.activities, 'activity', 'activities') : '',
      moved.tasks ? plural(moved.tasks, 'task') : '',
      moved.documents ? plural(moved.documents, 'file') : '',
    ].filter(Boolean);
    await logEvent({
      kind: `${type}.merged`,
      entity: { type, id: survivorId },
      actorId: actor.id,
      summary: `merged ${names} into this ${noun}${parts.length ? ` — ${parts.join(', ')} moved across` : ''}`,
      data: { mergedNames: dupes.map(d => str(d.name) ?? ''), moved },
      ...(type === 'contact' ? { companyId: (record.companyId as string) ?? ref(survivor.companyId) } : {}),
    });

    return { survivorId, merged: dupes.length, moved };
  },
});

type Moved = { deals: number; contacts: number; activities: number; tasks: number; documents: number; quotes: number; other: number };

async function moveCompanyLinks(dupId: string, survivorId: string, moved: Moved) {
  const { rows } = await zite.sql({
    query: `SELECT 'contacts' AS t, id FROM "Contacts" WHERE "companyId" = $1
      UNION ALL SELECT 'deals', id FROM "Deals" WHERE "companyId" = $1
      UNION ALL SELECT 'activities', id FROM "Activities" WHERE "companyId" = $1
      UNION ALL SELECT 'tasks', id FROM "Tasks" WHERE "companyId" = $1
      UNION ALL SELECT 'documents', id FROM "Documents" WHERE "companyId" = $1
      UNION ALL SELECT 'events', id FROM "Events" WHERE "companyId" = $1
      UNION ALL SELECT 'quotes', id FROM "Quotes" WHERE "companyId" = $1`,
    params: [dupId],
  });
  for (const row of rows) {
    const table = String(row.t) as 'contacts';
    await withRetry(() => (zite[table] as TableLike).update({ id: String(row.id), record: { companyId: survivorId } as never }));
    countMove(moved, String(row.t));
  }
  const { rows: children } = await zite.sql({ query: `SELECT id FROM "Companies" WHERE "parentCompanyId" = $1`, params: [dupId] });
  for (const child of children) {
    const parentId = String(child.id) === survivorId ? null : survivorId;
    await withRetry(() => zite.companies.update({ id: String(child.id), record: { parentCompanyId: parentId } as never }));
    moved.other++;
  }
  const { rows: leads } = await zite.sql({ query: `SELECT id FROM "Leads" WHERE "convertedCompanyId" = $1`, params: [dupId] });
  for (const lead of leads) {
    await withRetry(() => zite.leads.update({ id: String(lead.id), record: { convertedCompanyId: survivorId } as never }));
    moved.other++;
  }
}

async function moveContactLinks(dupId: string, survivorId: string, moved: Moved) {
  // A buying group can't hold the same person twice: drop the duplicate link.
  const { rows: groupLinks } = await zite.sql({
    query: `SELECT dc.id, dc."dealId",
        (SELECT COUNT(*) FROM "DealContacts" x WHERE x."dealId" = dc."dealId" AND x."contactId" = $2) AS "alreadyTotal"
      FROM "DealContacts" dc WHERE dc."contactId" = $1`,
    params: [dupId, survivorId],
  });
  for (const link of groupLinks) {
    if (num(link.alreadyTotal) > 0) await withRetry(() => zite.dealContacts.delete({ id: String(link.id) }));
    else await withRetry(() => zite.dealContacts.update({ id: String(link.id), record: { contactId: survivorId } as never }));
    moved.other++;
  }
  const { rows } = await zite.sql({
    query: `SELECT 'deals' AS t, id FROM "Deals" WHERE "contactId" = $1
      UNION ALL SELECT 'activities', id FROM "Activities" WHERE "contactId" = $1
      UNION ALL SELECT 'tasks', id FROM "Tasks" WHERE "contactId" = $1
      UNION ALL SELECT 'documents', id FROM "Documents" WHERE "contactId" = $1
      UNION ALL SELECT 'events', id FROM "Events" WHERE "contactId" = $1
      UNION ALL SELECT 'quotes', id FROM "Quotes" WHERE "contactId" = $1
      UNION ALL SELECT 'enrollments', id FROM "Enrollments" WHERE "contactId" = $1
      UNION ALL SELECT 'submissions', id FROM "Submissions" WHERE "contactId" = $1`,
    params: [dupId],
  });
  for (const row of rows) {
    const table = String(row.t) as 'deals';
    await withRetry(() => (zite[table] as TableLike).update({ id: String(row.id), record: { contactId: survivorId } as never }));
    countMove(moved, String(row.t));
  }
  const { rows: leads } = await zite.sql({ query: `SELECT id FROM "Leads" WHERE "convertedContactId" = $1`, params: [dupId] });
  for (const lead of leads) {
    await withRetry(() => zite.leads.update({ id: String(lead.id), record: { convertedContactId: survivorId } as never }));
    moved.other++;
  }
}

function countMove(moved: Moved, table: string) {
  if (table === 'deals') moved.deals++;
  else if (table === 'contacts') moved.contacts++;
  else if (table === 'activities') moved.activities++;
  else if (table === 'tasks') moved.tasks++;
  else if (table === 'documents') moved.documents++;
  else if (table === 'quotes') moved.quotes++;
  else moved.other++;
}
