import type { CustomFieldObject, CustomFieldType } from './constants';

/**
 * Custom fields are defined in the CustomFields table and stored per record
 * as a JSON object in that record's `customFields` text column, keyed by the
 * definition's `key`. Values are normalized here on the way in so every
 * reader sees one shape: numbers are numbers, dates are 'YYYY-MM-DD', a
 * multi-select is a string[], a checkbox is a boolean.
 */

export type CustomFieldDef = {
  id: string;
  key: string;
  label: string;
  object: CustomFieldObject;
  type: CustomFieldType;
  options: string[];
  helpText: string | null;
  required: boolean;
  position: number;
  archived: boolean;
};

export type CustomValues = Record<string, string | number | boolean | string[] | null>;

export function fieldKey(label: string) {
  const base = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  return base || 'field';
}

/** Normalize one value for a definition. Returns undefined when it can't be read (the caller reports it). */
export function normalizeValue(def: Pick<CustomFieldDef, 'type' | 'options'>, raw: unknown): CustomValues[string] | undefined {
  if (raw == null || raw === '') return null;
  switch (def.type) {
    case 'Text':
    case 'Long Text':
      return String(raw).slice(0, def.type === 'Text' ? 500 : 10_000);
    case 'URL': {
      const s = String(raw).trim();
      const url = /^https?:\/\//i.test(s) ? s : `https://${s}`;
      try {
        new URL(url);
        return url;
      } catch {
        return undefined;
      }
    }
    case 'Number':
    case 'Currency': {
      const n = typeof raw === 'number' ? raw : Number(String(raw).replace(/[$,\s]/g, ''));
      return Number.isFinite(n) ? n : undefined;
    }
    case 'Date': {
      const s = String(raw).slice(0, 10);
      return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : undefined;
    }
    case 'Checkbox':
      return raw === true || raw === 'true' || raw === 'yes' || raw === 1 || raw === '1';
    case 'Select': {
      const s = String(raw);
      const match = def.options.find(o => o.toLowerCase() === s.toLowerCase());
      return match ?? undefined;
    }
    case 'Multi Select': {
      const list = Array.isArray(raw) ? raw.map(String) : String(raw).split(/[;,]/).map(v => v.trim()).filter(Boolean);
      const out: string[] = [];
      for (const v of list) {
        const match = def.options.find(o => o.toLowerCase() === v.toLowerCase());
        if (!match) return undefined;
        if (!out.includes(match)) out.push(match);
      }
      return out;
    }
  }
  return undefined;
}

/** A value as plain text for tables, CSV and merge fields. */
export function displayValue(def: Pick<CustomFieldDef, 'type'>, v: CustomValues[string] | undefined): string {
  if (v == null || v === '') return '';
  if (Array.isArray(v)) return v.join(', ');
  if (def.type === 'Checkbox') return v ? 'Yes' : 'No';
  return String(v);
}

export function parseCustomValues(raw: unknown): CustomValues {
  if (raw == null || raw === '') return {};
  if (typeof raw === 'object') return raw as CustomValues;
  try {
    const v = JSON.parse(String(raw));
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as CustomValues) : {};
  } catch {
    return {};
  }
}
