import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { assertCan, getActor } from '@project/shared/server/actor';
import { logEvent } from '@project/shared/server/events';
import { num, withRetry } from '@project/shared/server/sql';
import { CUSTOM_FIELD_OBJECTS, CUSTOM_FIELD_TYPES } from '@project/shared/constants';
import { fieldKey } from '@project/shared/customFields';
import { id, parseInput } from '../server/input';

/**
 * Add or change a property (a custom field) on Companies, Contacts, Deals or
 * Leads.
 *
 * The `key` is generated from the label once and then never changes: it is
 * what every record's stored value is filed under, and what an import column
 * maps to. Renaming the label is free; renaming the key would orphan every
 * value in the workspace.
 *
 * The type is fixed once too — a Number that becomes a Date would leave every
 * existing value unreadable.
 */

const inputSchema = z.object({
  fieldId: id.optional(),
  object: z.enum(CUSTOM_FIELD_OBJECTS),
  label: z.string().trim().min(1, 'Give the property a label').max(60),
  type: z.enum(CUSTOM_FIELD_TYPES),
  options: z.array(z.string().trim().min(1).max(80)).max(60).optional(),
  helpText: z.string().trim().max(240).optional(),
  required: z.boolean().optional(),
  archived: z.boolean().optional(),
  /** A new order for this object's properties, top to bottom. */
  order: z.array(id).max(200).optional(),
});

export default createEndpoint({
  description: 'Add or change a custom property on companies, contacts, deals or leads',
  authenticated: true,
  inputSchema,
  outputSchema: z.object({ fieldId: z.string(), key: z.string(), created: z.boolean() }),
  execute: async ({ input, context }) => {
    const parsed = parseInput(inputSchema, input);
    const actor = await getActor(context);
    assertCan(actor, 'settings.manage');

    const options = parsed.type === 'Select' || parsed.type === 'Multi Select' ? [...new Set(parsed.options ?? [])] : [];
    if ((parsed.type === 'Select' || parsed.type === 'Multi Select') && !options.length) throw new ZiteError('A choice property needs at least one option', 'BAD_REQUEST');

    const shared = {
      label: parsed.label,
      object: parsed.object,
      type: parsed.type,
      options: options.length ? JSON.stringify(options) : null,
      helpText: parsed.helpText || null,
      required: parsed.required ?? false,
    };

    let fieldId = parsed.fieldId ?? '';
    let key = '';
    let created = false;

    if (fieldId) {
      const existing = await zite.customFields.findOne({ id: fieldId });
      if (!existing) throw new ZiteError('That property no longer exists', 'NOT_FOUND');
      key = existing.key ?? '';
      if (existing.type !== parsed.type) throw new ZiteError('A property’s type can’t change once it holds values. Archive it and add a new one.', 'CONFLICT');
      await withRetry(() => zite.customFields.update({ id: fieldId, record: { ...shared, object: existing.object ?? parsed.object, ...(parsed.archived === undefined ? {} : { archived: parsed.archived }) } as never }));
      await logEvent({
        kind: parsed.archived ? 'field.archived' : 'field.updated',
        entity: { type: 'settings', id: fieldId },
        actorId: actor.id,
        summary: parsed.archived ? `archived the ${parsed.label} property` : `changed the ${parsed.label} property`,
      });
    } else {
      const { rows } = await zite.sql({ query: `SELECT "key", COALESCE("position", 0) AS "position" FROM "CustomFields" WHERE "object" = $1`, params: [parsed.object] });
      const taken = new Set(rows.map(r => String(r.key)));
      const base = fieldKey(parsed.label);
      key = base;
      for (let i = 2; taken.has(key); i++) key = `${base}_${i}`;
      const position = rows.reduce((max, r) => Math.max(max, num(r.position)), -1) + 1;
      const record = await withRetry(() => zite.customFields.create({ record: { ...shared, key, position, archived: false } as never }));
      fieldId = record.id;
      created = true;
      await logEvent({ kind: 'field.created', entity: { type: 'settings', id: fieldId }, actorId: actor.id, summary: `added the ${parsed.label} property to ${parsed.object.toLowerCase()} records` });
    }

    if (parsed.order?.length) {
      const { rows } = await zite.sql({ query: `SELECT id, COALESCE("position", 0) AS "position" FROM "CustomFields" WHERE "object" = $1`, params: [parsed.object] });
      const known = new Set(rows.map(r => String(r.id)));
      const current = new Map(rows.map(r => [String(r.id), num(r.position)]));
      // Sequential on purpose: live Zite rate-limits bursts of parallel writes.
      for (const [index, sid] of parsed.order.filter(x => known.has(x)).entries()) {
        if (current.get(sid) === index) continue;
        await withRetry(() => zite.customFields.update({ id: sid, record: { position: index } }));
      }
    }

    return { fieldId, key, created };
  },
});
