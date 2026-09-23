import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { assertCan, getActor } from '@project/shared/server/actor';
import { logEvent } from '@project/shared/server/events';
import { num, withRetry } from '@project/shared/server/sql';
import { TABLE } from '@project/shared/server/records';
import type { CustomFieldObject } from '@project/shared/constants';
import { id, parseInput } from '../server/input';

/**
 * Delete a property for good.
 *
 * Archiving is the usual answer — it hides the property everywhere but keeps
 * every value, so it can come back. Deleting is for a property added by
 * mistake, so the first call only counts the records that still hold a value
 * and refuses; the caller repeats with `confirm` once the person has seen that
 * number.
 */

const OBJECT_TABLE: Record<CustomFieldObject, keyof typeof TABLE> = { Company: 'company', Contact: 'contact', Deal: 'deal', Lead: 'lead' };

const inputSchema = z.object({ fieldId: id, confirm: z.boolean().optional() });

export default createEndpoint({
  description: 'Delete a custom property, after reporting how many records still hold a value for it',
  authenticated: true,
  inputSchema,
  outputSchema: z.object({ deleted: z.boolean(), recordsWithValues: z.number(), label: z.string() }),
  execute: async ({ input, context }) => {
    const { fieldId, confirm } = parseInput(inputSchema, input);
    const actor = await getActor(context);
    assertCan(actor, 'settings.manage');

    const field = await zite.customFields.findOne({ id: fieldId });
    if (!field) throw new ZiteError('That property no longer exists', 'NOT_FOUND');
    const label = field.label ?? 'that property';
    const table = TABLE[OBJECT_TABLE[(field.object ?? 'Deal') as CustomFieldObject]];

    const { rows } = await zite.sql({
      query: `SELECT COUNT(*) AS "n" FROM "${table}" WHERE COALESCE(NULLIF("customFields", ''), '{}')::jsonb ? $1`,
      params: [field.key ?? ''],
    });
    const recordsWithValues = num(rows[0]?.n);

    if (!confirm) {
      throw new ZiteError(
        recordsWithValues
          ? `${recordsWithValues} ${recordsWithValues === 1 ? 'record still has' : 'records still have'} a value for ${label}. Deleting hides those values for good — archive it instead to keep them.`
          : `Delete ${label}? Nothing uses it yet, so nothing will be lost.`,
        'CONFLICT',
      );
    }

    await withRetry(() => zite.customFields.delete({ id: fieldId }));
    await logEvent({ kind: 'field.deleted', entity: { type: 'settings', id: fieldId }, actorId: actor.id, summary: `deleted the ${label} property` });
    return { deleted: true, recordsWithValues, label };
  },
});
