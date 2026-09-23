import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { assertCan, getActor } from '@project/shared/server/actor';
import { logEvent } from '@project/shared/server/events';
import { num, withRetry } from '@project/shared/server/sql';
import type { ChoiceList } from '@project/shared/constants';
import { id, parseInput } from '../server/input';

/**
 * Delete a list value. Records that already carry it keep the word — history
 * shouldn't change because a list did — so a value still in use is refused
 * until the caller confirms, and archiving is offered instead.
 */

const USES: Record<ChoiceList, Array<{ table: string; column: string }>> = {
  Industry: [
    { table: 'Companies', column: 'industry' },
    { table: 'Leads', column: 'industry' },
  ],
  'Lead Source': [
    { table: 'Companies', column: 'source' },
    { table: 'Contacts', column: 'source' },
    { table: 'Deals', column: 'source' },
    { table: 'Leads', column: 'source' },
  ],
  'Lost Reason': [{ table: 'Deals', column: 'lostReason' }],
  'Disqualify Reason': [{ table: 'Leads', column: 'disqualifyReason' }],
};

const inputSchema = z.object({ choiceId: id, confirm: z.boolean().optional() });

export default createEndpoint({
  description: 'Delete a value from one of the organization’s lists',
  authenticated: true,
  inputSchema,
  outputSchema: z.object({ deleted: z.boolean(), recordsUsing: z.number(), label: z.string() }),
  execute: async ({ input, context }) => {
    const { choiceId, confirm } = parseInput(inputSchema, input);
    const actor = await getActor(context);
    assertCan(actor, 'settings.manage');

    const choice = await zite.choices.findOne({ id: choiceId });
    if (!choice) throw new ZiteError('That value no longer exists', 'NOT_FOUND');
    const label = choice.label ?? '';
    const list = (choice.list ?? 'Industry') as ChoiceList;

    let recordsUsing = 0;
    for (const use of USES[list] ?? []) {
      const { rows } = await zite.sql({ query: `SELECT COUNT(*) AS "n" FROM "${use.table}" WHERE "${use.column}" = $1`, params: [label] });
      recordsUsing += num(rows[0]?.n);
    }

    if (recordsUsing && !confirm) {
      throw new ZiteError(`${recordsUsing} ${recordsUsing === 1 ? 'record still uses' : 'records still use'} “${label}”. They keep the word, but it won’t be offered again — archive it instead to keep it on the list.`, 'CONFLICT');
    }

    await withRetry(() => zite.choices.delete({ id: choiceId }));
    await logEvent({ kind: 'choice.deleted', entity: { type: 'settings', id: choiceId }, actorId: actor.id, summary: `removed “${label}” from ${list}` });
    return { deleted: true, recordsUsing, label };
  },
});
