import { ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import type { LeadStatus } from '../constants';
import { domainFromEmail, domainFromUrl } from '../format';
import { scoreLead, type LeadFit } from '../leads';
import { randomToken, shortId, slugify } from '../tokens';
import type { Actor } from './actor';
import { assertMember } from './actor';
import { createActivity } from './activities';
import { runTrigger } from './automations';
import { createDeal } from './deals';
import { logEvent } from './events';
import { nextLeadOwner } from './leadRouting';
import { notify } from './notify';
import { getSettings, type OrgSettings } from './settings';
import { enrollContacts } from './sequences';
import { iso, json, num, numOrNull, ref, str, withRetry } from './sql';

/**
 * The leads engine: the one place a lead is created, converted, or made from a
 * web form. Both apps call in here — the CRM with an actor, CRM Pages with
 * none — so scoring, routing, history, notifications and automations happen
 * exactly once and exactly the same way.
 *
 * Converting is idempotent on purpose: a lead carries `convertedAt` and the
 * ids of what it became, and a second convert returns those instead of making
 * a second contact, company and deal.
 */

// ---------------------------------------------------------------- form fields

export const FORM_FIELD_TYPES = ['short_text', 'long_text', 'email', 'phone', 'number', 'select', 'checkbox'] as const;
export type FormFieldType = (typeof FORM_FIELD_TYPES)[number];

/** Field keys that map straight onto a Lead column; anything else is a free answer. */
export const LEAD_FIELD_KEYS = ['firstName', 'lastName', 'name', 'email', 'phone', 'title', 'companyName', 'website', 'employees', 'industry', 'country', 'message'] as const;
export type LeadFieldKey = (typeof LEAD_FIELD_KEYS)[number];

export type FormFieldDef = {
  id: string;
  key: string;
  type: FormFieldType;
  label: string;
  required: boolean;
  placeholder: string | null;
  help: string | null;
  options: string[];
};

/** The hidden field a robot fills in and a person never sees. */
export const HONEYPOT_FIELD = 'website_url_confirm';

export const DEFAULT_FORM_FIELDS: FormFieldDef[] = [
  { id: 'fld_name', key: 'name', type: 'short_text', label: 'Your name', required: true, placeholder: null, help: null, options: [] },
  { id: 'fld_email', key: 'email', type: 'email', label: 'Work email', required: true, placeholder: null, help: null, options: [] },
  { id: 'fld_company', key: 'companyName', type: 'short_text', label: 'Company', required: true, placeholder: null, help: null, options: [] },
  { id: 'fld_message', key: 'message', type: 'long_text', label: 'What are you trying to solve?', required: false, placeholder: null, help: null, options: [] },
];

const asType = (v: unknown): FormFieldType => ((FORM_FIELD_TYPES as readonly string[]).includes(String(v)) ? (v as FormFieldType) : 'short_text');

/** Read a form's `fields` JSON column, tolerating anything ever written to it. Always contains one email field. */
export function parseFormFields(raw: unknown): FormFieldDef[] {
  const list = json<unknown[]>(raw, []);
  const out: FormFieldDef[] = [];
  const seen = new Set<string>();
  for (const item of Array.isArray(list) ? list : []) {
    if (!item || typeof item !== 'object') continue;
    const f = item as Record<string, unknown>;
    const type = asType(f.type);
    const label = String(f.label ?? '').trim().slice(0, 120);
    if (!label) continue;
    let key = String(f.key ?? '').trim();
    if (!/^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(key)) key = fieldKeyFromLabel(label);
    while (seen.has(key)) key = `${key}_${out.length + 1}`;
    seen.add(key);
    out.push({
      id: String(f.id ?? '').trim() || shortId(),
      key,
      type: key === 'email' ? 'email' : type,
      label,
      required: key === 'email' ? true : f.required === true,
      placeholder: f.placeholder ? String(f.placeholder).slice(0, 120) : null,
      help: f.help ? String(f.help).slice(0, 200) : null,
      options: Array.isArray(f.options) ? f.options.map(o => String(o).slice(0, 80)).filter(Boolean).slice(0, 40) : [],
    });
  }
  if (!out.some(f => f.key === 'email')) {
    out.unshift({ id: shortId(), key: 'email', type: 'email', label: 'Work email', required: true, placeholder: null, help: null, options: [] });
  }
  return out.slice(0, 30);
}

/** 'What's your budget?' → 'whats_your_budget', never colliding with a lead column by accident. */
export function fieldKeyFromLabel(label: string) {
  const base = slugify(label).replace(/-/g, '_').replace(/^[^a-z]+/, '') || 'field';
  return base.slice(0, 40);
}

export type SubmissionAnswers = Record<string, string | number | boolean>;

/**
 * Check one submission against a form's fields. Returns clean answers keyed by
 * field key, or the first problem as `{ key, message }` — the same check the
 * browser runs, so nothing can be posted past the form.
 */
export function validateAnswers(fields: FormFieldDef[], raw: Record<string, unknown>): { answers: SubmissionAnswers } | { error: { key: string; message: string } } {
  const answers: SubmissionAnswers = {};
  for (const field of fields) {
    const value = raw[field.key];
    const text = value == null ? '' : String(value).trim();
    if (field.type === 'checkbox') {
      const checked = value === true || text === 'true';
      if (field.required && !checked) return { error: { key: field.key, message: `${field.label} is required` } };
      if (checked) answers[field.key] = true;
      continue;
    }
    if (!text) {
      if (field.required) return { error: { key: field.key, message: `${field.label} is required` } };
      continue;
    }
    if (text.length > (field.type === 'long_text' ? 4000 : 240)) return { error: { key: field.key, message: `${field.label} is too long` } };
    if (field.type === 'email' && !isEmail(text)) return { error: { key: field.key, message: 'That email address doesn’t look right' } };
    if (field.type === 'number') {
      const n = Number(text.replace(/[, ]/g, ''));
      if (!Number.isFinite(n)) return { error: { key: field.key, message: `${field.label} has to be a number` } };
      answers[field.key] = n;
      continue;
    }
    if (field.type === 'select' && field.options.length && !field.options.includes(text)) {
      return { error: { key: field.key, message: `Choose one of the options for ${field.label}` } };
    }
    answers[field.key] = text;
  }
  return { answers };
}

export const isEmail = (v: string) => /^[^\s@]{1,64}@[^\s@.]+(\.[^\s@.]+)+$/.test(v.trim()) && v.length <= 200;

/** The answers people wrote that aren't lead columns, as a readable block for the lead's message. */
export function extraAnswerLines(fields: FormFieldDef[], answers: SubmissionAnswers) {
  const keys = new Set<string>(LEAD_FIELD_KEYS as readonly string[]);
  return fields
    .filter(f => !keys.has(f.key) && answers[f.key] !== undefined)
    .map(f => `${f.label}: ${answers[f.key] === true ? 'Yes' : String(answers[f.key])}`);
}

// ---------------------------------------------------------------------- leads

export type LeadInput = {
  name?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
  title?: string | null;
  companyName?: string | null;
  website?: string | null;
  employees?: number | null;
  industry?: string | null;
  country?: string | null;
  source?: string | null;
  sourceDetail?: string | null;
  status?: LeadStatus;
  ownerId?: string | null;
  message?: string | null;
  formId?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  tagIds?: string[] | null;
  customFields?: string | null;
  receivedAt?: string | null;
  /** Set by the importer, so an undo knows exactly which rows it created. */
  importId?: string | null;
};

export function leadName(input: { name?: string | null; firstName?: string | null; lastName?: string | null; email?: string | null }) {
  const full = (input.name ?? '').trim() || [input.firstName, input.lastName].filter(Boolean).join(' ').trim();
  if (full) return full.slice(0, 160);
  const email = (input.email ?? '').trim();
  return email ? email.split('@')[0].replace(/[._-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).slice(0, 160) : 'Unnamed lead';
}

export function splitName(full: string) {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { firstName: null as string | null, lastName: null as string | null };
  if (parts.length === 1) return { firstName: parts[0], lastName: null as string | null };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

/**
 * The only writer of new Leads. Scores the lead, records history, tells the
 * owner, and fires `lead.created`. `actor` is null for the public form.
 */
export async function createLead(actor: Pick<Actor, 'id' | 'name'> | null, input: LeadInput, opts: { skipTriggers?: boolean } = {}) {
  const name = leadName(input);
  const email = (input.email ?? '').trim().toLowerCase() || null;
  if (email && !isEmail(email)) throw new ZiteError('That email address doesn’t look right', 'BAD_REQUEST');
  const split = input.firstName || input.lastName ? { firstName: input.firstName ?? null, lastName: input.lastName ?? null } : splitName(name);
  if (input.ownerId) await assertMember(input.ownerId);
  const fit: LeadFit = {
    employees: input.employees ?? null,
    title: input.title ?? null,
    email,
    phone: input.phone ?? null,
    companyName: input.companyName ?? null,
    source: input.source ?? null,
    message: input.message ?? null,
  };
  const { score } = scoreLead(fit);
  const now = new Date().toISOString();
  const created = await withRetry(() =>
    zite.leads.create({
      record: {
        name,
        firstName: split.firstName,
        lastName: split.lastName,
        email,
        phone: input.phone ?? null,
        title: input.title ?? null,
        companyName: input.companyName ?? null,
        website: input.website ?? null,
        employees: input.employees ?? null,
        industry: input.industry ?? null,
        country: input.country ?? null,
        source: input.source ?? null,
        sourceDetail: input.sourceDetail ?? null,
        status: input.status ?? 'New',
        score,
        ownerId: input.ownerId ?? null,
        message: input.message ?? null,
        formId: input.formId ?? null,
        utmSource: input.utmSource ?? null,
        utmMedium: input.utmMedium ?? null,
        utmCampaign: input.utmCampaign ?? null,
        tagIds: input.tagIds?.length ? JSON.stringify([...new Set(input.tagIds)]) : null,
        customFields: input.customFields ?? null,
        receivedAt: input.receivedAt ?? now,
      importId: input.importId ?? null,
      },
    }),
  );
  await logEvent({
    kind: 'lead.created',
    entity: { type: 'lead', id: created.id },
    actorId: actor?.id ?? null,
    summary: actor ? `added the lead${input.source ? ` from ${input.source}` : ''}` : `came in${input.source ? ` through ${input.source}` : ''}`,
    leadId: created.id,
  });
  if (input.ownerId && input.ownerId !== actor?.id) {
    await notify({
      recipientIds: [input.ownerId],
      kind: 'lead',
      title: actor ? `${actor.name} gave you a lead: ${name}` : `New lead: ${name}${input.companyName ? ` at ${input.companyName}` : ''}`,
      body: input.message ? input.message.slice(0, 280) : null,
      link: `/leads/${created.id}`,
      entityType: 'lead',
      entityId: created.id,
      actorId: actor?.id ?? null,
    });
  }
  if (!opts.skipTriggers) await runTrigger('lead.created', { entityType: 'lead', entityId: created.id, actorId: actor?.id ?? null });
  return { id: created.id, name, score };
}

// -------------------------------------------------------------------- convert

export type ConvertCompanyChoice = { mode: 'match' | 'existing' | 'new' | 'none'; companyId?: string | null; name?: string | null; domain?: string | null };
export type ConvertContactChoice = { mode: 'match' | 'existing' | 'new'; contactId?: string | null };
export type ConvertDealChoice = { create: boolean; name?: string | null; amount?: number | null; pipelineId?: string | null; stageId?: string | null; closeDate?: string | null; ownerId?: string | null };

export type ConvertResult = {
  leadId: string;
  contactId: string | null;
  companyId: string | null;
  dealId: string | null;
  contactName: string | null;
  companyName: string | null;
  dealName: string | null;
  /** True when the lead was already converted and nothing new was made. */
  alreadyConverted: boolean;
};

/** gmail.com is not a company — never match or create a company from a personal address. */
const FREE_MAIL_DOMAIN = /^(gmail|googlemail|yahoo|hotmail|outlook|live|aol|icloud|me|proton|protonmail|gmx|yandex|mail)\./i;
export const workDomain = (email: string | null | undefined) => {
  const d = domainFromEmail(email);
  return d && !FREE_MAIL_DOMAIN.test(`${d}.`) ? d : '';
};

/** Companies whose domain matches the lead's, so a rep links instead of duplicating. */
export async function matchCompanies(lead: { website?: string | null; email?: string | null; companyName?: string | null }) {
  const domain = domainFromUrl(lead.website) || workDomain(lead.email);
  const name = (lead.companyName ?? '').trim();
  if (!domain && !name) return [];
  const { rows } = await zite.sql({
    query: `SELECT id, "name", "domain", "type", "ownerId",
        (SELECT COUNT(*) FROM "Contacts" c WHERE c."companyId" = co.id::text) AS "contactTotal"
      FROM "Companies" co
      WHERE ($1::text <> '' AND LOWER(COALESCE(co."domain", '')) = $1)
         OR ($2::text <> '' AND LOWER(co."name") = LOWER($2))
      ORDER BY CASE WHEN LOWER(COALESCE(co."domain", '')) = $1 THEN 0 ELSE 1 END, co."name"
      LIMIT 5`,
    params: [domain.toLowerCase(), name],
  });
  return rows.map(r => ({ id: String(r.id), name: str(r.name) ?? '', domain: str(r.domain) || null, type: str(r.type) || null, ownerId: ref(r.ownerId), contactCount: num(r.contactTotal) }));
}

/** The contact that already owns this email address, if there is one. */
export async function matchContact(email: string | null | undefined) {
  const clean = (email ?? '').trim().toLowerCase();
  if (!clean) return null;
  const { rows } = await zite.sql({
    query: `SELECT c.id, c."name", c."email", c."title", c."companyId", c."ownerId", co."name" AS "companyName"
      FROM "Contacts" c LEFT JOIN "Companies" co ON co.id::text = c."companyId"
      WHERE LOWER(c."email") = $1 ORDER BY c.created_at ASC LIMIT 1`,
    params: [clean],
  });
  const r = rows[0];
  return r ? { id: String(r.id), name: str(r.name) ?? '', email: str(r.email) || null, title: str(r.title) || null, companyId: ref(r.companyId), companyName: str(r.companyName) || null, ownerId: ref(r.ownerId) } : null;
}

/**
 * Turn a lead into a contact (and a company, and optionally a deal), carrying
 * its conversation across. Running it twice returns the first result.
 */
export async function convertLead(
  actor: Pick<Actor, 'id' | 'name'>,
  leadId: string,
  choice: { company?: ConvertCompanyChoice; contact?: ConvertContactChoice; deal?: ConvertDealChoice; ownerId?: string | null; today?: string },
): Promise<ConvertResult> {
  const { rows } = await zite.sql({ query: `SELECT * FROM "Leads" WHERE id::text = $1`, params: [leadId] });
  const lead = rows[0];
  if (!lead) throw new ZiteError('That lead no longer exists', 'NOT_FOUND');

  const existingContactId = ref(lead.convertedContactId);
  if (iso(lead.convertedAt) && existingContactId) {
    const names = await convertedNames({ contactId: existingContactId, companyId: ref(lead.convertedCompanyId), dealId: ref(lead.convertedDealId) });
    return { leadId, contactId: existingContactId, companyId: ref(lead.convertedCompanyId), dealId: ref(lead.convertedDealId), ...names, alreadyConverted: true };
  }

  const name = str(lead.name) ?? 'the lead';
  const email = (str(lead.email) ?? '').trim().toLowerCase() || null;
  const ownerId = choice.ownerId !== undefined ? choice.ownerId : ref(lead.ownerId) ?? actor.id;
  if (ownerId) await assertMember(ownerId);
  const now = new Date().toISOString();
  const today = choice.today && /^\d{4}-\d{2}-\d{2}$/.test(choice.today) ? choice.today : now.slice(0, 10);

  // 1. Company — link the one they named, the domain match, or make a new one.
  const companyChoice = choice.company ?? { mode: 'match' as const };
  let companyId: string | null = null;
  let companyCreated = false;
  if (companyChoice.mode === 'existing' && companyChoice.companyId) {
    const { rows: c } = await zite.sql({ query: `SELECT id FROM "Companies" WHERE id::text = $1`, params: [companyChoice.companyId] });
    if (!c[0]) throw new ZiteError('That company no longer exists', 'BAD_REQUEST');
    companyId = companyChoice.companyId;
  } else if (companyChoice.mode === 'match') {
    companyId = (await matchCompanies({ website: str(lead.website), email, companyName: str(lead.companyName) }))[0]?.id ?? null;
    if (!companyId && str(lead.companyName)) {
      companyId = await createCompanyFromLead(actor, lead, companyChoice, ownerId);
      companyCreated = true;
    }
  } else if (companyChoice.mode === 'new') {
    companyId = await createCompanyFromLead(actor, lead, companyChoice, ownerId);
    companyCreated = true;
  }

  // 2. Contact — link the email match, or make one from the lead.
  const contactChoice = choice.contact ?? { mode: 'match' as const };
  let contactId: string | null = null;
  let contactCreated = false;
  if (contactChoice.mode === 'existing' && contactChoice.contactId) {
    const { rows: c } = await zite.sql({ query: `SELECT id, "companyId" FROM "Contacts" WHERE id::text = $1`, params: [contactChoice.contactId] });
    if (!c[0]) throw new ZiteError('That contact no longer exists', 'BAD_REQUEST');
    contactId = contactChoice.contactId;
    if (companyId && !ref(c[0].companyId)) await withRetry(() => zite.contacts.update({ id: contactId as string, record: { companyId } }));
  } else {
    const match = contactChoice.mode === 'match' ? await matchContact(email) : null;
    if (match) {
      contactId = match.id;
      if (companyId && !match.companyId) await withRetry(() => zite.contacts.update({ id: match.id, record: { companyId } }));
    } else {
      const split = { firstName: str(lead.firstName), lastName: str(lead.lastName) };
      const fallback = splitName(name);
      const created = await withRetry(() =>
        zite.contacts.create({
          record: {
            name,
            firstName: split.firstName || fallback.firstName,
            lastName: split.lastName || fallback.lastName,
            email,
            phone: str(lead.phone) || null,
            title: str(lead.title) || null,
            companyId,
            ownerId,
            source: str(lead.source) || null,
            country: str(lead.country) || null,
            background: str(lead.message) || null,
            tagIds: str(lead.tagIds) || null,
            customFields: str(lead.customFields) || null,
            unsubscribeToken: randomToken(),
            lastActivityAt: iso(lead.lastActivityAt),
          },
        }),
      );
      contactId = created.id;
      contactCreated = true;
    }
  }

  // 3. Deal — optional, and always through the deal engine.
  let dealId: string | null = null;
  const dealChoice = choice.deal;
  if (dealChoice?.create) {
    dealId = await createDeal(
      actor,
      {
        name: (dealChoice.name ?? '').trim() || `${str(lead.companyName) || name} — new business`,
        companyId,
        contactId,
        pipelineId: dealChoice.pipelineId ?? null,
        stageId: dealChoice.stageId ?? null,
        ownerId: dealChoice.ownerId !== undefined ? dealChoice.ownerId : ownerId,
        amount: dealChoice.amount ?? null,
        closeDate: dealChoice.closeDate ?? null,
        source: str(lead.source) || null,
        description: str(lead.message) || null,
      },
      { today },
    );
  }

  // 4. Carry the conversation across. Activities and tasks keep their lead link
  //    (so the lead still reads as a story) and gain the new records.
  await relinkChildren(leadId, { contactId, companyId, dealId });

  // 5. The lead itself.
  await withRetry(() =>
    zite.leads.update({
      id: leadId,
      record: {
        status: 'Qualified',
        convertedAt: now,
        convertedContactId: contactId,
        convertedCompanyId: companyId,
        convertedDealId: dealId,
        ...(ref(lead.ownerId) ? {} : { ownerId }),
      },
    }),
  );

  const names = await convertedNames({ contactId, companyId, dealId });
  const madeParts = [contactCreated ? 'a new contact' : 'an existing contact', companyId ? (companyCreated ? 'a new company' : 'an existing company') : null, dealId ? 'a deal' : null].filter(Boolean);
  // One summary event, cross-linked so it reads on every record it touched, plus
  // one specific line where a record's own history needs it. Anything more and
  // the same sentence appears four times on one timeline.
  await logEvent({ kind: 'lead.converted', entity: { type: 'lead', id: leadId }, actorId: actor.id, summary: `converted the lead into ${madeParts.join(', ')}`, leadId, contactId, companyId, dealId });
  if (contactId && contactCreated) await logEvent({ kind: 'contact.from_lead', entity: { type: 'contact', id: contactId }, actorId: actor.id, summary: `created this contact from the lead “${name}”` });
  if (companyId && companyCreated) await logEvent({ kind: 'company.from_lead', entity: { type: 'company', id: companyId }, actorId: actor.id, summary: `created this company converting the lead “${name}”` });

  const dealOwner = dealId ? (dealChoice?.ownerId !== undefined ? dealChoice.ownerId : ownerId) : null;
  if (dealId && dealOwner) {
    await notify({
      recipientIds: [dealOwner],
      kind: 'lead',
      title: `${actor.name} converted ${name} into ${names.dealName ?? 'a deal'}`,
      body: str(lead.companyName) ? `From ${str(lead.companyName)}.` : null,
      link: `/deals/${dealId}`,
      entityType: 'deal',
      entityId: dealId,
      actorId: actor.id,
    });
  }
  await runTrigger('lead.converted', { entityType: 'lead', entityId: leadId, actorId: actor.id, data: { contactId, companyId, dealId } });

  return { leadId, contactId, companyId, dealId, ...names, alreadyConverted: false };
}

async function createCompanyFromLead(actor: Pick<Actor, 'id' | 'name'>, lead: Record<string, unknown>, choice: ConvertCompanyChoice, ownerId: string | null) {
  const name = (choice.name ?? str(lead.companyName) ?? '').trim();
  if (!name) throw new ZiteError('Give the company a name', 'BAD_REQUEST');
  const domain = ((choice.domain ?? '').trim() || domainFromUrl(str(lead.website)) || workDomain(str(lead.email))).toLowerCase() || null;
  const created = await withRetry(() =>
    zite.companies.create({
      record: {
        name: name.slice(0, 200),
        domain,
        website: str(lead.website) || (domain ? `https://www.${domain}` : null),
        industry: str(lead.industry) || null,
        type: 'Prospect',
        employees: numOrNull(lead.employees),
        ownerId,
        country: str(lead.country) || null,
        source: str(lead.source) || null,
      },
    }),
  );
  await runTrigger('company.created', { entityType: 'company', entityId: created.id, actorId: actor.id });
  return created.id;
}

/** Give the lead's activities, tasks, documents and history their new homes. */
async function relinkChildren(leadId: string, links: { contactId: string | null; companyId: string | null; dealId: string | null }) {
  if (!links.contactId && !links.companyId && !links.dealId) return;
  const tables = [
    ['activities', 'Activities'],
    ['tasks', 'Tasks'],
    ['documents', 'Documents'],
  ] as const;
  for (const [client, table] of tables) {
    const { rows } = await zite.sql({ query: `SELECT id, "companyId", "contactId", "dealId" FROM "${table}" WHERE "leadId" = $1 LIMIT 500`, params: [leadId] });
    for (const row of rows) {
      const patch: Record<string, unknown> = {};
      if (links.contactId && !ref(row.contactId)) patch.contactId = links.contactId;
      if (links.companyId && !ref(row.companyId)) patch.companyId = links.companyId;
      if (links.dealId && !ref(row.dealId) && client !== 'documents') patch.dealId = links.dealId;
      if (!Object.keys(patch).length) continue;
      await withRetry(() => (zite[client] as { update: (a: { id: string; record: never }) => Promise<unknown> }).update({ id: String(row.id), record: patch as never }));
    }
  }
}

async function convertedNames(links: { contactId: string | null; companyId: string | null; dealId: string | null }) {
  const [contact, company, deal] = await Promise.all([
    links.contactId ? zite.sql({ query: `SELECT "name" FROM "Contacts" WHERE id::text = $1`, params: [links.contactId] }) : Promise.resolve({ rows: [] as Record<string, unknown>[] }),
    links.companyId ? zite.sql({ query: `SELECT "name" FROM "Companies" WHERE id::text = $1`, params: [links.companyId] }) : Promise.resolve({ rows: [] as Record<string, unknown>[] }),
    links.dealId ? zite.sql({ query: `SELECT "name" FROM "Deals" WHERE id::text = $1`, params: [links.dealId] }) : Promise.resolve({ rows: [] as Record<string, unknown>[] }),
  ]);
  return {
    contactName: str(contact.rows[0]?.name) || null,
    companyName: str(company.rows[0]?.name) || null,
    dealName: str(deal.rows[0]?.name) || null,
  };
}

// --------------------------------------------------------------- form submits

export type FormRecord = {
  id: string;
  name: string;
  slug: string;
  status: string;
  fields: FormFieldDef[];
  assignment: string;
  assigneeId: string | null;
  source: string;
  notifyIds: string[];
  sequenceId: string | null;
  tagIds: string[];
  ownerId: string | null;
  submissionCount: number;
};

export function toFormRecord(r: Record<string, unknown>): FormRecord {
  return {
    id: String(r.id),
    name: str(r.name) ?? '',
    slug: str(r.slug) ?? '',
    status: str(r.status) || 'Live',
    fields: parseFormFields(r.fields),
    assignment: str(r.assignment) || 'Round Robin',
    assigneeId: ref(r.assigneeId),
    source: str(r.source) || 'Website form',
    notifyIds: json<string[]>(r.notifyIds, []),
    sequenceId: ref(r.sequenceId),
    tagIds: json<string[]>(r.tagIds, []),
    ownerId: ref(r.ownerId),
    submissionCount: num(r.submissionCount),
  };
}

export type SubmitContext = {
  form: FormRecord;
  answers: SubmissionAnswers;
  utm: { source?: string | null; medium?: string | null; campaign?: string | null };
  pageUrl?: string | null;
  referrer?: string | null;
  settings?: OrgSettings;
};

export type SubmitOutcome = { outcome: 'New Lead' | 'Existing Lead' | 'Existing Contact' | 'Spam'; leadId: string | null; contactId: string | null; submissionId: string; duplicate: boolean };

const DEDUPE_MINUTES = 10;

/**
 * One web-form submission, end to end: recognise the person, create or update
 * what they map onto, record the submission, bump the form, tell the team and
 * fire `form.submitted`. Unauthenticated — the caller has already re-parsed and
 * size-capped everything that reaches here.
 */
export async function submitFormEntry(ctx: SubmitContext): Promise<SubmitOutcome> {
  const form = ctx.form;
  const settings = ctx.settings ?? (await getSettings());
  const answers = ctx.answers;
  const email = String(answers.email ?? '').trim().toLowerCase();
  const now = new Date().toISOString();
  const displayName = leadName({ name: answers.name ? String(answers.name) : null, firstName: answers.firstName ? String(answers.firstName) : null, lastName: answers.lastName ? String(answers.lastName) : null, email });

  // A second click, or a double-submitting browser, must not make a second lead.
  const { rows: recent } = await zite.sql({
    query: `SELECT id, "leadId", "contactId", "outcome" FROM "Submissions"
      WHERE "formId" = $1 AND LOWER("email") = $2 AND "submittedAt" > $3 ORDER BY "submittedAt" DESC LIMIT 1`,
    params: [form.id, email, new Date(Date.now() - DEDUPE_MINUTES * 60_000).toISOString()],
  });
  if (recent[0]) {
    return {
      outcome: (str(recent[0].outcome) || 'New Lead') as SubmitOutcome['outcome'],
      leadId: ref(recent[0].leadId),
      contactId: ref(recent[0].contactId),
      submissionId: String(recent[0].id),
      duplicate: true,
    };
  }

  const extras = extraAnswerLines(form.fields, answers);
  const written = String(answers.message ?? '').trim();
  const messageBody = [written, extras.join('\n')].filter(Boolean).join('\n\n').slice(0, 4000) || null;

  let outcome: SubmitOutcome['outcome'] = 'New Lead';
  let leadId: string | null = null;
  let contactId: string | null = null;

  const contact = await matchContact(email);
  if (contact) {
    // Already a customer or in flight: this is news on their timeline, not a new lead.
    outcome = 'Existing Contact';
    contactId = contact.id;
    await createActivity(null, {
      kind: 'Note',
      subject: `${form.name} submitted`,
      body: messageBody ? `Filled in “${form.name}”.\n\n${messageBody}` : `Filled in “${form.name}”.`,
      occurredAt: now,
      direction: 'Inbound',
      contactId: contact.id,
      companyId: contact.companyId,
      ownerId: contact.ownerId,
    });
    await notify({
      recipientIds: [contact.ownerId, ...form.notifyIds],
      kind: 'form_submission',
      title: `${contact.name} filled in ${form.name}`,
      body: messageBody ? messageBody.slice(0, 280) : null,
      link: `/contacts/${contact.id}`,
      entityType: 'contact',
      entityId: contact.id,
    });
    if (form.sequenceId) {
      // The form has no signed-in actor; enrollment is attributed to the form's owner.
      const enroller: Actor = { id: form.ownerId ?? '', name: form.name, email: '', role: 'Rep', created: false };
      await enrollContacts({ actor: enroller, sequenceId: form.sequenceId, contactIds: [contact.id], ownerId: contact.ownerId }).catch(() => undefined);
    }
  } else {
    const { rows: openLeads } = await zite.sql({
      query: `SELECT id, "name", "message", "ownerId", "status" FROM "Leads"
        WHERE LOWER("email") = $1 AND "status" IN ('New', 'Working', 'Nurturing') ORDER BY created_at DESC LIMIT 1`,
      params: [email],
    });
    const open = openLeads[0];
    if (open) {
      // They came back. Add what they wrote instead of starting again.
      outcome = 'Existing Lead';
      leadId = String(open.id);
      const previous = str(open.message) ?? '';
      const appended = [previous, messageBody ? `— ${new Date(now).toISOString().slice(0, 10)} via ${form.name} —\n${messageBody}` : `— ${new Date(now).toISOString().slice(0, 10)} — submitted ${form.name} again`].filter(Boolean).join('\n\n').slice(0, 8000);
      await withRetry(() => zite.leads.update({ id: leadId as string, record: { message: appended, lastActivityAt: now } }));
      await createActivity(null, {
        kind: 'Note',
        subject: `${form.name} submitted again`,
        body: messageBody ?? `Filled in “${form.name}” again.`,
        occurredAt: now,
        direction: 'Inbound',
        leadId,
      });
      await notify({
        recipientIds: [ref(open.ownerId), ...form.notifyIds],
        kind: 'form_submission',
        title: `${str(open.name) ?? 'A lead'} filled in ${form.name} again`,
        body: messageBody ? messageBody.slice(0, 280) : null,
        link: `/leads/${leadId}`,
        entityType: 'lead',
        entityId: leadId,
      });
    } else {
      outcome = 'New Lead';
      const ownerId = await nextLeadOwner({
        settings,
        mode: form.assignment === 'Member' ? 'member' : form.assignment === 'Unassigned' ? 'unassigned' : 'round_robin',
        memberId: form.assigneeId,
      });
      const employees = typeof answers.employees === 'number' ? answers.employees : answers.employees ? Number(String(answers.employees).replace(/[^0-9.]/g, '')) || null : null;
      const created = await createLead(null, {
        name: displayName,
        firstName: answers.firstName ? String(answers.firstName) : null,
        lastName: answers.lastName ? String(answers.lastName) : null,
        email,
        phone: answers.phone ? String(answers.phone) : null,
        title: answers.title ? String(answers.title) : null,
        companyName: answers.companyName ? String(answers.companyName) : null,
        website: answers.website ? String(answers.website) : null,
        employees,
        industry: answers.industry ? String(answers.industry) : null,
        country: answers.country ? String(answers.country) : null,
        source: form.source,
        sourceDetail: form.name,
        message: messageBody,
        ownerId,
        formId: form.id,
        utmSource: ctx.utm.source ?? null,
        utmMedium: ctx.utm.medium ?? null,
        utmCampaign: ctx.utm.campaign ?? null,
        tagIds: form.tagIds,
        receivedAt: now,
      });
      leadId = created.id;
      await notify({
        recipientIds: form.notifyIds.filter(id => id !== ownerId),
        kind: 'form_submission',
        title: `New lead from ${form.name}: ${displayName}`,
        body: answers.companyName ? `From ${String(answers.companyName)}.` : messageBody?.slice(0, 280) ?? null,
        link: `/leads/${leadId}`,
        entityType: 'lead',
        entityId: leadId,
      });
    }
  }

  const submission = await withRetry(() =>
    zite.submissions.create({
      record: {
        formId: form.id,
        email,
        name: displayName,
        answers: JSON.stringify(answers).slice(0, 16_000),
        leadId,
        contactId,
        outcome,
        submittedAt: now,
        pageUrl: ctx.pageUrl ? ctx.pageUrl.slice(0, 500) : null,
        referrer: ctx.referrer ? ctx.referrer.slice(0, 500) : null,
        utm: ctx.utm.source || ctx.utm.medium || ctx.utm.campaign ? JSON.stringify(ctx.utm) : null,
      },
    }),
  );
  await bumpForm(form.id, now);
  await runTrigger('form.submitted', { entityType: 'form', entityId: form.id, actorId: null, data: { submissionId: submission.id, leadId, contactId, outcome } });
  return { outcome, leadId, contactId, submissionId: submission.id, duplicate: false };
}

/** Record a robot's attempt without telling it, and without making a lead. */
export async function recordSpam(form: FormRecord, email: string, pageUrl?: string | null) {
  const created = await withRetry(() =>
    zite.submissions.create({
      record: { formId: form.id, email: email.slice(0, 200), name: null, answers: null, outcome: 'Spam', submittedAt: new Date().toISOString(), pageUrl: pageUrl ? pageUrl.slice(0, 500) : null },
    }),
  ).catch(() => null);
  return created?.id ?? null;
}

async function bumpForm(formId: string, at: string) {
  const { rows } = await zite.sql({ query: `SELECT "submissionCount" FROM "Forms" WHERE id::text = $1`, params: [formId] });
  if (!rows[0]) return;
  await withRetry(() => zite.forms.update({ id: formId, record: { submissionCount: num(rows[0].submissionCount) + 1, lastSubmissionAt: at } })).catch(() => undefined);
}

/** A lead's status change, with the history and automation every path owes. */
export async function setLeadStatus(actor: Pick<Actor, 'id' | 'name'>, leadId: string, status: LeadStatus, opts: { disqualifyReason?: string | null; previous?: string | null } = {}) {
  const record: Record<string, unknown> = { status };
  if (status === 'Disqualified') record.disqualifyReason = opts.disqualifyReason ?? null;
  else if (opts.previous === 'Disqualified') record.disqualifyReason = null;
  await withRetry(() => zite.leads.update({ id: leadId, record: record as never }));
  await logEvent({
    kind: 'lead.status_changed',
    entity: { type: 'lead', id: leadId },
    actorId: actor.id,
    summary: status === 'Disqualified' ? `disqualified the lead${opts.disqualifyReason ? ` — ${opts.disqualifyReason}` : ''}` : `moved the lead to ${status}`,
    leadId,
    data: { from: opts.previous ?? null, to: status },
  });
  await runTrigger('lead.status_changed', { entityType: 'lead', entityId: leadId, actorId: actor.id, data: { from: opts.previous ?? null, to: status } });
}

