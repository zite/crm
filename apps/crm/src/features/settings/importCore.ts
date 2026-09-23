import type { CustomFieldDef } from '@project/shared/customFields';
import type { ImportObject } from '@project/shared/constants';

/**
 * Everything the importer needs to agree on, in one place, so the preview in
 * the browser and the run on the server can never disagree about what a file
 * says. No React, no database — this file is imported by both.
 */

/* ------------------------------------------------------------------- CSV */

/**
 * RFC 4180: quoted fields may hold commas, newlines and doubled quotes.
 * A hand-rolled parser because a spreadsheet export is the one file format
 * people paste, and a regex split loses every address with a comma in it.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === ',' || c === '\t') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.some(v => v.trim() !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some(v => v.trim() !== '')) rows.push(row);
  return rows.map(r => r.map(v => v.trim()));
}

export type Sheet = { headers: string[]; rows: string[][] };

/** Split a pasted or uploaded file into its header row and its data rows. */
export function readSheet(text: string, maxRows = 5000): Sheet {
  const all = parseCsv(text);
  if (!all.length) return { headers: [], rows: [] };
  const headers = all[0].map((h, i) => h || `Column ${i + 1}`);
  return { headers, rows: all.slice(1, maxRows + 1).map(r => headers.map((_, i) => r[i] ?? '')) };
}

/* ---------------------------------------------------------------- fields */

export type FieldKind = 'text' | 'longText' | 'email' | 'phone' | 'url' | 'number' | 'money' | 'date' | 'select' | 'owner' | 'tags' | 'choice' | 'boolean';

export type ImportField = {
  key: string;
  label: string;
  kind: FieldKind;
  required?: boolean;
  options?: string[];
  hint?: string;
  /** Columns whose header should map here, lower-cased and stripped of punctuation. */
  aliases?: string[];
};

const OWNER: ImportField = { key: 'ownerEmail', label: 'Owner email', kind: 'owner', hint: 'Matched to a teammate by email; left unassigned if nobody matches', aliases: ['owner', 'assignedto', 'assignee', 'rep', 'accountowner', 'owneremailaddress'] };
const TAGS: ImportField = { key: 'tags', label: 'Tags', kind: 'tags', hint: 'Separate several with a semicolon; unknown tags are ignored', aliases: ['tag', 'labels', 'label'] };

const BASE: Record<ImportObject, ImportField[]> = {
  Companies: [
    { key: 'name', label: 'Company name', kind: 'text', required: true, aliases: ['company', 'companyname', 'account', 'accountname', 'organization', 'organisation'] },
    { key: 'domain', label: 'Domain', kind: 'text', hint: 'Used to match an existing company', aliases: ['website', 'url', 'websitedomain', 'companydomain'] },
    { key: 'industry', label: 'Industry', kind: 'choice', aliases: ['sector', 'vertical'] },
    { key: 'type', label: 'Type', kind: 'select', options: ['Prospect', 'Customer', 'Partner', 'Former Customer', 'Other'], aliases: ['accounttype', 'relationship', 'lifecyclestage'] },
    { key: 'employees', label: 'Employees', kind: 'number', aliases: ['headcount', 'size', 'employeecount', 'numberofemployees'] },
    { key: 'annualRevenue', label: 'Annual revenue', kind: 'money', aliases: ['revenue', 'arr', 'turnover'] },
    OWNER,
    { key: 'phone', label: 'Phone', kind: 'phone', aliases: ['telephone', 'phonenumber'] },
    { key: 'address', label: 'Street', kind: 'text', aliases: ['street', 'address1', 'streetaddress'] },
    { key: 'city', label: 'City', kind: 'text', aliases: ['town'] },
    { key: 'region', label: 'State or region', kind: 'text', aliases: ['state', 'province', 'county'] },
    { key: 'postalCode', label: 'Postal code', kind: 'text', aliases: ['zip', 'zipcode', 'postcode'] },
    { key: 'country', label: 'Country', kind: 'text', aliases: [] },
    { key: 'description', label: 'Description', kind: 'longText', aliases: ['about', 'notes', 'summary'] },
    { key: 'source', label: 'Source', kind: 'choice', aliases: ['leadsource', 'origin'] },
    TAGS,
  ],
  Contacts: [
    { key: 'firstName', label: 'First name', kind: 'text', aliases: ['first', 'givenname', 'forename'] },
    { key: 'lastName', label: 'Last name', kind: 'text', aliases: ['last', 'surname', 'familyname'] },
    { key: 'name', label: 'Full name', kind: 'text', hint: 'Used when first and last aren’t given separately', aliases: ['fullname', 'contact', 'contactname', 'person'] },
    { key: 'email', label: 'Email', kind: 'email', required: true, hint: 'Used to match an existing contact', aliases: ['emailaddress', 'workemail', 'e-mail'] },
    { key: 'phone', label: 'Phone', kind: 'phone', aliases: ['telephone', 'phonenumber', 'workphone'] },
    { key: 'mobile', label: 'Mobile', kind: 'phone', aliases: ['cell', 'cellphone', 'mobilephone'] },
    { key: 'title', label: 'Job title', kind: 'text', aliases: ['jobtitle', 'position', 'role'] },
    { key: 'companyName', label: 'Company', kind: 'text', hint: 'Matched by name or domain; a new company is created when nothing matches', aliases: ['company', 'account', 'accountname', 'employer', 'organization'] },
    OWNER,
    { key: 'source', label: 'Source', kind: 'choice', aliases: ['leadsource', 'origin'] },
    { key: 'linkedinUrl', label: 'LinkedIn', kind: 'url', aliases: ['linkedin', 'linkedinprofile'] },
    { key: 'city', label: 'City', kind: 'text', aliases: ['town'] },
    { key: 'country', label: 'Country', kind: 'text', aliases: [] },
    { key: 'background', label: 'Background', kind: 'longText', aliases: ['notes', 'about', 'bio'] },
    TAGS,
  ],
  Deals: [
    { key: 'name', label: 'Deal name', kind: 'text', required: true, aliases: ['deal', 'opportunity', 'opportunityname', 'dealname'] },
    { key: 'companyName', label: 'Company', kind: 'text', hint: 'Matched by name or domain; a new company is created when nothing matches', aliases: ['company', 'account', 'accountname', 'organization'] },
    { key: 'contactEmail', label: 'Primary contact email', kind: 'email', aliases: ['contact', 'contactemail', 'email', 'primarycontact'] },
    { key: 'pipeline', label: 'Pipeline', kind: 'text', hint: 'Falls back to the default pipeline', aliases: ['pipelinename'] },
    { key: 'stage', label: 'Stage', kind: 'text', hint: 'Falls back to the pipeline’s first stage', aliases: ['dealstage', 'stagename', 'status'] },
    OWNER,
    { key: 'amount', label: 'Amount', kind: 'money', aliases: ['value', 'dealvalue', 'arr', 'total'] },
    { key: 'closeDate', label: 'Close date', kind: 'date', hint: 'YYYY-MM-DD, or MM/DD/YYYY', aliases: ['expectedclose', 'closedate', 'closingdate'] },
    { key: 'type', label: 'Type', kind: 'select', options: ['New Business', 'Expansion', 'Renewal'], aliases: ['dealtype', 'opportunitytype'] },
    { key: 'source', label: 'Source', kind: 'choice', aliases: ['leadsource', 'origin'] },
    { key: 'description', label: 'Description', kind: 'longText', aliases: ['notes', 'about'] },
    TAGS,
  ],
  Leads: [
    { key: 'firstName', label: 'First name', kind: 'text', aliases: ['first', 'givenname', 'forename'] },
    { key: 'lastName', label: 'Last name', kind: 'text', aliases: ['last', 'surname', 'familyname'] },
    { key: 'name', label: 'Full name', kind: 'text', aliases: ['fullname', 'lead', 'leadname', 'person'] },
    { key: 'email', label: 'Email', kind: 'email', required: true, hint: 'Used to match an existing lead', aliases: ['emailaddress', 'workemail', 'e-mail'] },
    { key: 'phone', label: 'Phone', kind: 'phone', aliases: ['telephone', 'phonenumber'] },
    { key: 'title', label: 'Job title', kind: 'text', aliases: ['jobtitle', 'position', 'role'] },
    { key: 'companyName', label: 'Company', kind: 'text', aliases: ['company', 'account', 'organization', 'employer'] },
    { key: 'website', label: 'Website', kind: 'url', aliases: ['url', 'domain'] },
    { key: 'employees', label: 'Employees', kind: 'number', aliases: ['headcount', 'size', 'companysize'] },
    { key: 'industry', label: 'Industry', kind: 'choice', aliases: ['sector', 'vertical'] },
    { key: 'country', label: 'Country', kind: 'text', aliases: [] },
    { key: 'source', label: 'Source', kind: 'choice', aliases: ['leadsource', 'origin', 'channel'] },
    { key: 'status', label: 'Status', kind: 'select', options: ['New', 'Working', 'Nurturing', 'Qualified', 'Disqualified'], aliases: ['leadstatus'] },
    { key: 'message', label: 'Message', kind: 'longText', aliases: ['notes', 'comments', 'enquiry', 'inquiry'] },
    OWNER,
  ],
};

export const CUSTOM_PREFIX = 'cf:';

/** The base fields for an object plus its custom properties, which import like any other column. */
export function importFieldsFor(object: ImportObject, customFields: Array<Pick<CustomFieldDef, 'key' | 'label' | 'object' | 'type' | 'options' | 'archived'>> = []): ImportField[] {
  const target = { Companies: 'Company', Contacts: 'Contact', Deals: 'Deal', Leads: 'Lead' }[object];
  const custom = customFields
    .filter(f => f.object === target && !f.archived)
    .map<ImportField>(f => ({
      key: `${CUSTOM_PREFIX}${f.key}`,
      label: f.label,
      kind: f.type === 'Number' ? 'number' : f.type === 'Currency' ? 'money' : f.type === 'Date' ? 'date' : f.type === 'Checkbox' ? 'boolean' : f.type === 'URL' ? 'url' : f.type === 'Select' || f.type === 'Multi Select' ? 'select' : 'text',
      options: f.options,
      hint: 'A property your team added',
      aliases: [f.label],
    }));
  return [...BASE[object], ...custom];
}

/* --------------------------------------------------------------- mapping */

const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

/**
 * A best guess at which column is which, by exact header, then by the aliases
 * every CRM export uses ("Account Name", "Assigned To"). A column it can't
 * place is left unmapped rather than guessed at.
 */
export function guessMapping(headers: string[], fields: ImportField[]): Array<string | null> {
  const byNormal = new Map<string, string>();
  for (const f of fields) {
    byNormal.set(normalize(f.key), f.key);
    byNormal.set(normalize(f.label), f.key);
    for (const alias of f.aliases ?? []) byNormal.set(normalize(alias), f.key);
  }
  const used = new Set<string>();
  return headers.map(h => {
    const key = byNormal.get(normalize(h));
    if (!key || used.has(key)) return null;
    used.add(key);
    return key;
  });
}

/* ------------------------------------------------------------ validation */

export const EMAIL_SHAPE = /^[^\s@]{1,64}@[^\s@.]+(\.[^\s@.]+)+$/;

/** 'MM/DD/YYYY', 'D Mon YYYY' and ISO all mean the same day — normalise to YYYY-MM-DD. */
export function toDay(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  const slash = v.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})$/);
  if (slash) {
    const [, a, b, c] = slash;
    const year = c.length === 2 ? `20${c}` : c;
    return `${year}-${a.padStart(2, '0')}-${b.padStart(2, '0')}`;
  }
  const parsed = Date.parse(v);
  if (Number.isNaN(parsed)) return null;
  return new Date(parsed).toISOString().slice(0, 10);
}

export function toNumber(raw: string): number | null {
  const v = raw.replace(/[$€£,\s]/g, '').replace(/^\((.*)\)$/, '-$1');
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const TRUTHY = new Set(['yes', 'y', 'true', '1', 'x', 'checked']);
const FALSY = new Set(['no', 'n', 'false', '0', '']);

export type RowValues = Record<string, string | number | boolean | string[] | null>;
export type RowCheck = { values: RowValues; errors: string[] };

/** Read one row through the mapping, turning every cell into the shape the server stores. */
export function checkRow(fields: ImportField[], mapping: Array<string | null>, cells: string[]): RowCheck {
  const byKey = new Map(fields.map(f => [f.key, f]));
  const values: RowValues = {};
  const errors: string[] = [];

  mapping.forEach((key, index) => {
    if (!key) return;
    const field = byKey.get(key);
    const raw = (cells[index] ?? '').trim();
    if (!field || !raw) return;
    switch (field.kind) {
      case 'email': {
        const email = raw.toLowerCase();
        if (!EMAIL_SHAPE.test(email)) errors.push(`${field.label} “${raw}” isn’t an email address`);
        else values[key] = email;
        break;
      }
      case 'number':
      case 'money': {
        const n = toNumber(raw);
        if (n == null) errors.push(`${field.label} “${raw}” isn’t a number`);
        else if (field.kind === 'money' && n < 0) errors.push(`${field.label} can’t be negative`);
        else values[key] = n;
        break;
      }
      case 'date': {
        const day = toDay(raw);
        if (!day) errors.push(`${field.label} “${raw}” isn’t a date we can read`);
        else values[key] = day;
        break;
      }
      case 'boolean': {
        const v = raw.toLowerCase();
        if (TRUTHY.has(v)) values[key] = true;
        else if (FALSY.has(v)) values[key] = false;
        else errors.push(`${field.label} “${raw}” should be yes or no`);
        break;
      }
      case 'select': {
        const match = (field.options ?? []).find(o => o.toLowerCase() === raw.toLowerCase());
        if (!match) errors.push(`${field.label} “${raw}” isn’t one of ${(field.options ?? []).join(', ')}`);
        else values[key] = match;
        break;
      }
      case 'tags':
        values[key] = raw.split(/[;,]/).map(t => t.trim()).filter(Boolean).slice(0, 20);
        break;
      case 'url':
        values[key] = /^https?:\/\//i.test(raw) ? raw : `https://${raw.replace(/^\/+/, '')}`;
        break;
      default:
        values[key] = raw.slice(0, field.kind === 'longText' ? 8000 : 400);
    }
  });

  const named = Boolean(values.name || values.firstName || values.lastName);
  for (const field of fields) {
    if (!field.required) continue;
    const given = values[field.key] != null && values[field.key] !== '';
    // A person with a name but no address is still worth keeping — they just can't be matched or emailed.
    if (!given && !(field.key === 'email' && named)) errors.push(`${field.label} is missing`);
  }
  return { values, errors };
}

export const MATCH_LABEL: Record<ImportObject, string> = {
  Companies: 'domain, then name',
  Contacts: 'email address',
  Deals: 'name and company',
  Leads: 'email address',
};
