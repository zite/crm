import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { assertCan, getActor } from '@project/shared/server/actor';
import { logEvent } from '@project/shared/server/events';
import { idList, jsonHas } from '@project/shared/server/records';
import { withRetry } from '@project/shared/server/sql';
import { id, parseInput } from '../server/input';

/**
 * Delete a tag and take it off every record that carries it — a tag id left
 * behind on a deal would render as nothing at all, which looks like a bug.
 * The first call reports how many records would change and refuses; the second
 * carries it out.
 */

const TABLES = [
  { table: 'Companies', client: 'companies' },
  { table: 'Contacts', client: 'contacts' },
  { table: 'Deals', client: 'deals' },
  { table: 'Leads', client: 'leads' },
] as const;

const CLIENTS = { companies: () => zite.companies, contacts: () => zite.contacts, deals: () => zite.deals, leads: () => zite.leads } as const;

const inputSchema = z.object({ tagId: id, confirm: z.boolean().optional() });

export default createEndpoint({
  description: 'Delete a tag and remove it from every record that carries it',
  authenticated: true,
  inputSchema,
  outputSchema: z.object({ deleted: z.boolean(), recordsUsing: z.number(), name: z.string() }),
  execute: async ({ input, context }) => {
    const { tagId, confirm } = parseInput(inputSchema, input);
    const actor = await getActor(context);
    assertCan(actor, 'settings.manage');

    const tag = await zite.tags.findOne({ id: tagId });
    if (!tag) throw new ZiteError('That tag no longer exists', 'NOT_FOUND');
    const name = tag.name ?? 'that tag';

    const holders: Array<{ client: (typeof TABLES)[number]['client']; id: string; tagIds: string[] }> = [];
    for (const t of TABLES) {
      const { rows } = await zite.sql({ query: `SELECT id, "tagIds" FROM "${t.table}" WHERE ${jsonHas('"tagIds"', '$1')}`, params: [tagId] });
      for (const row of rows) holders.push({ client: t.client, id: String(row.id), tagIds: idList(row.tagIds) });
    }

    if (holders.length && !confirm) {
      throw new ZiteError(`${holders.length} ${holders.length === 1 ? 'record carries' : 'records carry'} “${name}”. Deleting takes it off all of them.`, 'CONFLICT');
    }

    // Sequential on purpose: live Zite rate-limits bursts of parallel writes.
    for (const holder of holders) {
      const next = holder.tagIds.filter(x => x !== tagId);
      await withRetry(() =>
        (CLIENTS[holder.client]() as { update: (a: { id: string; record: never }) => Promise<unknown> }).update({ id: holder.id, record: { tagIds: next.length ? JSON.stringify(next) : null } as never }),
      );
    }
    await withRetry(() => zite.tags.delete({ id: tagId }));
    await logEvent({ kind: 'tag.deleted', entity: { type: 'settings', id: tagId }, actorId: actor.id, summary: `deleted the ${name} tag` });
    return { deleted: true, recordsUsing: holders.length, name };
  },
});
