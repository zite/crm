import { ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import type { CustomFieldObject } from '../constants';
import { normalizeValue, parseCustomValues, type CustomFieldDef, type CustomValues } from '../customFields';
import { bool, json, num, str } from './sql';

export async function loadFieldDefs(object?: CustomFieldObject, includeArchived = false): Promise<CustomFieldDef[]> {
  const { rows } = await zite.sql({
    query: `SELECT * FROM "CustomFields" WHERE ($1::text IS NULL OR "object" = $1) ${includeArchived ? '' : 'AND COALESCE("archived", false) = false'} ORDER BY "object", COALESCE("position", 0), created_at`,
    params: [object ?? null],
  });
  return rows.map(r => ({
    id: String(r.id),
    key: str(r.key) ?? '',
    label: str(r.label) ?? '',
    object: String(r.object) as CustomFieldObject,
    type: String(r.type) as CustomFieldDef['type'],
    options: json<string[]>(r.options, []),
    helpText: str(r.helpText) || null,
    required: bool(r.required),
    position: num(r.position),
    archived: bool(r.archived),
  }));
}

/**
 * Merge a patch of custom values into a record's existing JSON. Unknown keys
 * and unreadable values are rejected with a sentence naming the field; `null`
 * clears a value. Returns the JSON string to store.
 */
export async function mergeCustomValues(object: CustomFieldObject, existingRaw: unknown, patch: Record<string, unknown> | null | undefined, opts: { enforceRequired?: boolean } = {}): Promise<string | undefined> {
  if (!patch || !Object.keys(patch).length) return undefined;
  const defs = await loadFieldDefs(object, true);
  const byKey = new Map(defs.map(d => [d.key, d]));
  const next: CustomValues = { ...parseCustomValues(existingRaw) };
  for (const [key, raw] of Object.entries(patch)) {
    const def = byKey.get(key);
    if (!def) throw new ZiteError(`There’s no ${object.toLowerCase()} field called “${key}”`, 'BAD_REQUEST');
    const v = normalizeValue(def, raw);
    if (v === undefined) throw new ZiteError(`“${raw}” isn’t a valid value for ${def.label}`, 'BAD_REQUEST');
    if (v === null || (Array.isArray(v) && !v.length)) delete next[key];
    else next[key] = v;
  }
  if (opts.enforceRequired) {
    const missing = defs.filter(d => d.required && !d.archived && (next[d.key] == null || next[d.key] === ''));
    if (missing.length) throw new ZiteError(`${missing[0].label} is required`, 'BAD_REQUEST');
  }
  return JSON.stringify(next);
}
