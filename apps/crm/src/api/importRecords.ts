import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { assertCan, getActor } from '@project/shared/server/actor';
import { createDeal, defaultPipeline, firstOpenStage, loadPipelines } from '@project/shared/server/deals';
import { createLead } from '@project/shared/server/leads';
import { loadFieldDefs } from '@project/shared/server/customFields';
import { logEvent } from '@project/shared/server/events';
import { normalizeValue } from '@project/shared/customFields';
import { domainFromEmail, domainFromUrl } from '@project/shared/format';
import { IMPORT_OBJECTS, type ImportObject } from '@project/shared/constants';
import { str, withRetry } from '@project/shared/server/sql';
import { CUSTOM_PREFIX, checkRow, importFieldsFor, readSheet, type RowValues } from '../features/settings/importCore';
import { parseInput } from '../server/input';

/**
 * Bring a CSV in.
 *
 * The file is read with the same parser and the same rules the preview used,
 * so what the person approved is what runs. Rows are written in chunks, one
 * record at a time — live Zite rate-limits bursts — and everything created
 * carries this import's id, which is what makes "Undo import" possible and
 * exact.
 *
 * Automations are deliberately NOT fired by an import: nobody wants three
 * hundred welcome emails because they loaded last year's conference list.
 */

const inputSchema = z.object({
  object: z.enum(IMPORT_OBJECTS),
  fileName: z.string().trim().max(200).optional(),
  csv: z.string().min(1, 'Paste or choose a file first').max(4_000_000),
  /** One entry per column: the field it feeds, or null to skip it. */
  mapping: z.array(z.string().max(80).nullable()).max(200),
  mode: z.enum(['create', 'upsert']),
  /** Import only this many rows — the preview uses it to try the first few. */
  limit: z.number().int().min(1).max(2000).optional(),
});

type Ctx = {
  object: ImportObject;
  ownerByEmail: Map<string, string>;
  tagByName: Map<string, string>;
  companyByDomain: Map<string, string>;
  companyByName: Map<string, string>;
  contactByEmail: Map<string, string>;
  leadByEmail: Map<string, string>;
  dealByKey: Map<string, string>;
};

const key = (v: string | null | undefined) => (v ?? '').trim().toLowerCase();

export default createEndpoint({
  description: 'Import companies, contacts, deals or leads from a CSV, creating or updating by a matching column',
  authenticated: true,
  inputSchema,
  outputSchema: z.object({
    importId: z.string(),
    rowCount: z.number(),
    created: z.number(),
    updated: z.number(),
    skipped: z.number(),
    errors: z.array(z.object({ row: z.number(), message: z.string() })),
  }),
  execute: async ({ input, context }) => {
    const parsed = parseInput(inputSchema, input);
    const actor = await getActor(context);
    assertCan(actor, 'data.import');

    const sheet = readSheet(parsed.csv, parsed.limit ?? 2000);
    if (!sheet.headers.length) throw new ZiteError('That file has no columns we can read', 'BAD_REQUEST');
    if (!sheet.rows.length) throw new ZiteError('That file has a header row but no data', 'BAD_REQUEST');

    const defs = await loadFieldDefs(undefined, false);
    const fields = importFieldsFor(parsed.object, defs);
    const mapping = sheet.headers.map((_, i) => parsed.mapping[i] ?? null);
    const mapped = new Set(mapping.filter(Boolean) as string[]);
    const missing = fields.filter(f => f.required && !mapped.has(f.key));
    if (missing.length && !(parsed.object !== 'Companies' && parsed.object !== 'Deals' && (mapped.has('name') || mapped.has('firstName') || mapped.has('lastName')))) {
      throw new ZiteError(`Map a column to ${missing[0].label} before importing`, 'BAD_REQUEST');
    }

    const imports = await withRetry(() =>
      zite.imports.create({
        record: {
          fileName: parsed.fileName || `${parsed.object}.csv`,
          object: parsed.object,
          status: 'Running',
          rowCount: sheet.rows.length,
          createdCount: 0,
          updatedCount: 0,
          skippedCount: 0,
          mapping: JSON.stringify(mapping),
          actorId: actor.id,
        },
      }),
    );
    const importId = imports.id;

    const ctx = await loadLookups(parsed.object);
    const errors: Array<{ row: number; message: string }> = [];
    let created = 0;
    let updated = 0;
    let skipped = 0;

    // Chunks of 100, each written one row at a time: live Zite rate-limits bursts.
    for (let start = 0; start < sheet.rows.length; start += 100) {
      const chunk = sheet.rows.slice(start, start + 100);
      for (const [offset, cells] of chunk.entries()) {
        const rowNumber = start + offset + 2; // +2: a header row, and people count from one
        const check = checkRow(fields, mapping, cells);
        if (check.errors.length) {
          skipped++;
          if (errors.length < 100) errors.push({ row: rowNumber, message: check.errors[0] });
          continue;
        }
        try {
          const result = await writeRow(actor, parsed.object, check.values, defs, ctx, parsed.mode, importId);
          if (result === 'created') created++;
          else if (result === 'updated') updated++;
          else skipped++;
        } catch (err) {
          skipped++;
          if (errors.length < 100) errors.push({ row: rowNumber, message: err instanceof Error ? err.message : 'That row couldn’t be imported' });
        }
      }
    }

    await withRetry(() =>
      zite.imports.update({
        id: importId,
        record: { status: created + updated ? 'Completed' : 'Failed', createdCount: created, updatedCount: updated, skippedCount: skipped, errors: errors.length ? JSON.stringify(errors) : null },
      }),
    );
    await logEvent({
      kind: 'import.completed',
      entity: { type: 'import', id: importId },
      actorId: actor.id,
      summary: `imported ${created} new ${parsed.object.toLowerCase()}${updated ? ` and updated ${updated}` : ''}`,
      data: { object: parsed.object, created, updated, skipped },
    });

    return { importId, rowCount: sheet.rows.length, created, updated, skipped, errors };
  },
});

/* ------------------------------------------------------------------ rows */

async function loadLookups(object: ImportObject): Promise<Ctx> {
  const [members, tags, companies] = await Promise.all([
    zite.sql({ query: `SELECT id, "email" FROM "Members" WHERE "status" <> 'Deactivated'`, params: [] }),
    zite.sql({ query: `SELECT id, "name" FROM "Tags"`, params: [] }),
    zite.sql({ query: `SELECT id, "name", "domain" FROM "Companies" ORDER BY created_at LIMIT 2000`, params: [] }),
  ]);
  const ctx: Ctx = {
    object,
    ownerByEmail: new Map(members.rows.map(r => [key(str(r.email)), String(r.id)])),
    tagByName: new Map(tags.rows.map(r => [key(str(r.name)), String(r.id)])),
    companyByDomain: new Map(companies.rows.filter(r => str(r.domain)).map(r => [key(str(r.domain)), String(r.id)])),
    companyByName: new Map(companies.rows.map(r => [key(str(r.name)), String(r.id)])),
    contactByEmail: new Map(),
    leadByEmail: new Map(),
    dealByKey: new Map(),
  };
  if (object === 'Contacts') {
    const { rows } = await zite.sql({ query: `SELECT id, "email" FROM "Contacts" WHERE COALESCE("email", '') <> '' ORDER BY created_at LIMIT 2000`, params: [] });
    ctx.contactByEmail = new Map(rows.map(r => [key(str(r.email)), String(r.id)]));
  }
  if (object === 'Leads') {
    const { rows } = await zite.sql({ query: `SELECT id, "email" FROM "Leads" WHERE COALESCE("email", '') <> '' ORDER BY created_at LIMIT 2000`, params: [] });
    ctx.leadByEmail = new Map(rows.map(r => [key(str(r.email)), String(r.id)]));
  }
  if (object === 'Deals') {
    const { rows } = await zite.sql({ query: `SELECT id, "name", "companyId" FROM "Deals" ORDER BY created_at LIMIT 2000`, params: [] });
    ctx.dealByKey = new Map(rows.map(r => [`${key(str(r.name))}|${str(r.companyId) ?? ''}`, String(r.id)]));
  }
  return ctx;
}

type Defs = Awaited<ReturnType<typeof loadFieldDefs>>;

/** Pull the `cf:` columns out of a row and turn them into the record's customFields JSON. */
function customValuesFrom(values: RowValues, defs: Defs, object: 'Company' | 'Contact' | 'Deal' | 'Lead') {
  const byKey = new Map(defs.filter(d => d.object === object).map(d => [d.key, d]));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(values)) {
    if (!k.startsWith(CUSTOM_PREFIX) || v == null) continue;
    const def = byKey.get(k.slice(CUSTOM_PREFIX.length));
    if (!def) continue;
    const normalized = normalizeValue(def, v);
    if (normalized != null) out[def.key] = normalized;
  }
  return Object.keys(out).length ? out : null;
}

function tagIdsFrom(values: RowValues, ctx: Ctx) {
  const names = Array.isArray(values.tags) ? values.tags : [];
  const ids = names.map(n => ctx.tagByName.get(key(n))).filter((x): x is string => Boolean(x));
  return ids.length ? [...new Set(ids)] : null;
}

const ownerFrom = (values: RowValues, ctx: Ctx) => ctx.ownerByEmail.get(key(String(values.ownerEmail ?? ''))) ?? null;

/** Find the company a row names, by domain then by name, creating one when the import says to. */
async function resolveCompany(values: RowValues, ctx: Ctx, importId: string, ownerId: string | null): Promise<string | null> {
  const name = String(values.companyName ?? '').trim();
  const fromEmail = domainFromEmail(String(values.contactEmail ?? values.email ?? ''));
  const fromSite = domainFromUrl(String(values.website ?? ''));
  const domain = key(fromSite || (isGenericMail(fromEmail) ? '' : fromEmail));
  if (domain && ctx.companyByDomain.has(domain)) return ctx.companyByDomain.get(domain)!;
  if (name && ctx.companyByName.has(key(name))) return ctx.companyByName.get(key(name))!;
  if (!name) return null;
  const created = await withRetry(() => zite.companies.create({ record: { name, domain: domain || null, website: domain ? `https://www.${domain}` : null, ownerId, importId } }));
  ctx.companyByName.set(key(name), created.id);
  if (domain) ctx.companyByDomain.set(domain, created.id);
  return created.id;
}

const GENERIC = /^(gmail|googlemail|yahoo|hotmail|outlook|live|aol|icloud|me|proton|protonmail|gmx|yandex|mail)\./i;
const isGenericMail = (domain: string) => !domain || GENERIC.test(`${domain}.`);

async function writeRow(
  actor: { id: string; name: string },
  object: ImportObject,
  values: RowValues,
  defs: Defs,
  ctx: Ctx,
  mode: 'create' | 'upsert',
  importId: string,
): Promise<'created' | 'updated' | 'skipped'> {
  const ownerId = ownerFrom(values, ctx);
  const tagIds = tagIdsFrom(values, ctx);

  if (object === 'Companies') {
    const name = String(values.name ?? '').trim();
    const domain = key(String(values.domain ?? '')).replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
    const existing = (domain && ctx.companyByDomain.get(domain)) || ctx.companyByName.get(key(name));
    const record = {
      name,
      domain: domain || null,
      website: values.domain ? `https://www.${domain}` : null,
      industry: values.industry ?? null,
      type: values.type ?? null,
      employees: values.employees ?? null,
      annualRevenue: values.annualRevenue ?? null,
      ownerId,
      phone: values.phone ?? null,
      address: values.address ?? null,
      city: values.city ?? null,
      region: values.region ?? null,
      postalCode: values.postalCode ?? null,
      country: values.country ?? null,
      description: values.description ?? null,
      source: values.source ?? null,
      tagIds: tagIds ? JSON.stringify(tagIds) : null,
      customFields: JSON.stringify(customValuesFrom(values, defs, 'Company') ?? {}),
    };
    if (existing) {
      if (mode === 'create') return 'skipped';
      await withRetry(() => zite.companies.update({ id: existing, record: prune(record) as never }));
      return 'updated';
    }
    const created = await withRetry(() => zite.companies.create({ record: { ...record, importId } as never }));
    ctx.companyByName.set(key(name), created.id);
    if (domain) ctx.companyByDomain.set(domain, created.id);
    return 'created';
  }

  if (object === 'Contacts') {
    const email = String(values.email ?? '').trim().toLowerCase();
    const name = String(values.name ?? '').trim() || [values.firstName, values.lastName].filter(Boolean).join(' ').trim();
    const existing = email ? ctx.contactByEmail.get(email) : undefined;
    const companyId = await resolveCompany(values, ctx, importId, ownerId);
    const record = {
      name,
      firstName: values.firstName ?? (name.includes(' ') ? name.split(' ')[0] : name) ?? null,
      lastName: values.lastName ?? (name.includes(' ') ? name.split(' ').slice(1).join(' ') : null),
      email: email || null,
      phone: values.phone ?? null,
      mobile: values.mobile ?? null,
      title: values.title ?? null,
      companyId,
      ownerId,
      source: values.source ?? null,
      linkedinUrl: values.linkedinUrl ?? null,
      city: values.city ?? null,
      country: values.country ?? null,
      background: values.background ?? null,
      tagIds: tagIds ? JSON.stringify(tagIds) : null,
      customFields: JSON.stringify(customValuesFrom(values, defs, 'Contact') ?? {}),
    };
    if (existing) {
      if (mode === 'create') return 'skipped';
      await withRetry(() => zite.contacts.update({ id: existing, record: prune(record) as never }));
      return 'updated';
    }
    const created = await withRetry(() => zite.contacts.create({ record: { ...record, importId } as never }));
    if (email) ctx.contactByEmail.set(email, created.id);
    return 'created';
  }

  if (object === 'Leads') {
    const email = String(values.email ?? '').trim().toLowerCase();
    const existing = email ? ctx.leadByEmail.get(email) : undefined;
    if (existing) {
      if (mode === 'create') return 'skipped';
      await withRetry(() =>
        zite.leads.update({
          id: existing,
          record: prune({
            phone: values.phone ?? null,
            title: values.title ?? null,
            companyName: values.companyName ?? null,
            website: values.website ?? null,
            employees: values.employees ?? null,
            industry: values.industry ?? null,
            country: values.country ?? null,
            source: values.source ?? null,
            status: values.status ?? null,
            message: values.message ?? null,
            ownerId,
          }) as never,
        }),
      );
      return 'updated';
    }
    const custom = customValuesFrom(values, defs, 'Lead');
    const lead = await createLead(
      actor,
      {
        name: (values.name as string) ?? null,
        firstName: (values.firstName as string) ?? null,
        lastName: (values.lastName as string) ?? null,
        email: email || null,
        phone: (values.phone as string) ?? null,
        title: (values.title as string) ?? null,
        companyName: (values.companyName as string) ?? null,
        website: (values.website as string) ?? null,
        employees: (values.employees as number) ?? null,
        industry: (values.industry as string) ?? null,
        country: (values.country as string) ?? null,
        source: (values.source as string) ?? 'Import',
        status: (values.status as 'New') ?? 'New',
        ownerId,
        message: (values.message as string) ?? null,
        customFields: custom ? JSON.stringify(custom) : null,
      },
      { skipTriggers: true },
    );
    await withRetry(() => zite.leads.update({ id: lead.id, record: { importId } }));
    if (email) ctx.leadByEmail.set(email, lead.id);
    return 'created';
  }

  /* Deals */
  const name = String(values.name ?? '').trim();
  const ownerForCompany = ownerId;
  const companyId = await resolveCompany(values, ctx, importId, ownerForCompany);
  const matchKey = `${key(name)}|${companyId ?? ''}`;
  const existing = ctx.dealByKey.get(matchKey);
  const { pipelines, stages } = await loadPipelines();
  const pipeline = (values.pipeline ? pipelines.find(p => key(p.name) === key(String(values.pipeline))) : null) ?? defaultPipeline(pipelines);
  if (!pipeline) throw new ZiteError('Set up a pipeline before importing deals', 'BAD_REQUEST');
  const stage = (values.stage ? stages.find(s => s.pipelineId === pipeline.id && key(s.name) === key(String(values.stage))) : null) ?? firstOpenStage(stages, pipeline.id);
  if (!stage) throw new ZiteError(`${pipeline.name} has no open stages`, 'BAD_REQUEST');

  let contactId: string | null = null;
  const contactEmail = String(values.contactEmail ?? '').trim().toLowerCase();
  if (contactEmail) {
    const { rows } = await zite.sql({ query: `SELECT id FROM "Contacts" WHERE LOWER("email") = $1 LIMIT 1`, params: [contactEmail] });
    contactId = rows[0] ? String(rows[0].id) : null;
  }

  if (existing) {
    if (mode === 'create') return 'skipped';
    await withRetry(() =>
      zite.deals.update({
        id: existing,
        record: prune({
          companyId,
          contactId,
          ownerId,
          amount: values.amount ?? null,
          closeDate: values.closeDate ?? null,
          type: values.type ?? null,
          source: values.source ?? null,
          description: values.description ?? null,
          tagIds: tagIds ? JSON.stringify(tagIds) : null,
        }) as never,
      }),
    );
    return 'updated';
  }

  const dealId = await createDeal(
    actor,
    {
      name,
      companyId,
      contactId,
      pipelineId: pipeline.id,
      stageId: stage.id,
      ownerId,
      amount: (values.amount as number) ?? null,
      closeDate: (values.closeDate as string) ?? null,
      type: (values.type as 'New Business') ?? null,
      source: (values.source as string) ?? null,
      description: (values.description as string) ?? null,
      tagIds,
      customFields: customValuesFrom(values, defs, 'Deal'),
      importId,
    },
    { skipTriggers: true },
  );
  ctx.dealByKey.set(matchKey, dealId);
  return 'created';
}

/** On an update, a blank column means "the file didn't say", not "empty it". */
function prune(record: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(record)) {
    if (v == null || v === '' || v === '{}') continue;
    out[k] = v;
  }
  return out;
}
