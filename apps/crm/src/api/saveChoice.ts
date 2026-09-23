import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { assertCan, getActor } from '@project/shared/server/actor';
import { logEvent } from '@project/shared/server/events';
import { num, withRetry } from '@project/shared/server/sql';
import { CHOICE_LISTS, type ChoiceList } from '@project/shared/constants';
import { id, parseInput } from '../server/input';

/**
 * The lists an organization keeps for itself: Industry, Lead Source, Lost
 * Reason, Disqualify Reason.
 *
 * These are stored on records as text, not as ids, because that is what makes
 * a CSV import and a report readable. The cost is that renaming a value leaves
 * every record still saying the old word — so a rename offers to walk the
 * records over, and `dryRun` counts them first so the dialog can say how many.
 */

const USES: Record<ChoiceList, Array<{ table: string; client: 'companies' | 'contacts' | 'deals' | 'leads'; column: string }>> = {
  Industry: [
    { table: 'Companies', client: 'companies', column: 'industry' },
    { table: 'Leads', client: 'leads', column: 'industry' },
  ],
  'Lead Source': [
    { table: 'Companies', client: 'companies', column: 'source' },
    { table: 'Contacts', client: 'contacts', column: 'source' },
    { table: 'Deals', client: 'deals', column: 'source' },
    { table: 'Leads', client: 'leads', column: 'source' },
  ],
  'Lost Reason': [{ table: 'Deals', client: 'deals', column: 'lostReason' }],
  'Disqualify Reason': [{ table: 'Leads', client: 'leads', column: 'disqualifyReason' }],
};

const CLIENTS = { companies: () => zite.companies, contacts: () => zite.contacts, deals: () => zite.deals, leads: () => zite.leads } as const;

async function countUses(list: ChoiceList, label: string) {
  let total = 0;
  for (const use of USES[list]) {
    const { rows } = await zite.sql({ query: `SELECT COUNT(*) AS "n" FROM "${use.table}" WHERE "${use.column}" = $1`, params: [label] });
    total += num(rows[0]?.n);
  }
  return total;
}

const inputSchema = z.object({
  choiceId: id.optional(),
  list: z.enum(CHOICE_LISTS),
  label: z.string().trim().min(1, 'Give the value a name').max(80),
  archived: z.boolean().optional(),
  /** Rename the records that still carry the old label. */
  relabelRecords: z.boolean().optional(),
  /** Count what a rename would touch without writing anything. */
  dryRun: z.boolean().optional(),
  /** A new order for this list, top to bottom. */
  order: z.array(id).max(200).optional(),
});

export default createEndpoint({
  description: 'Add, rename, reorder or archive a value in one of the organization’s lists',
  authenticated: true,
  inputSchema,
  outputSchema: z.object({ choiceId: z.string(), created: z.boolean(), recordsUsing: z.number(), recordsRelabelled: z.number() }),
  execute: async ({ input, context }) => {
    const parsed = parseInput(inputSchema, input);
    const actor = await getActor(context);
    assertCan(actor, 'settings.manage');

    let choiceId = parsed.choiceId ?? '';
    let created = false;
    let recordsUsing = 0;
    let recordsRelabelled = 0;

    if (choiceId) {
      const existing = await zite.choices.findOne({ id: choiceId });
      if (!existing) throw new ZiteError('That value no longer exists', 'NOT_FOUND');
      const oldLabel = existing.label ?? '';
      const renaming = oldLabel && oldLabel !== parsed.label;
      recordsUsing = await countUses(parsed.list, oldLabel);

      if (parsed.dryRun) return { choiceId, created: false, recordsUsing, recordsRelabelled: 0 };

      if (parsed.label !== oldLabel) {
        const { rows } = await zite.sql({ query: `SELECT id FROM "Choices" WHERE "list" = $1 AND LOWER("label") = LOWER($2) AND id::text <> $3 LIMIT 1`, params: [parsed.list, parsed.label, choiceId] });
        if (rows[0]) throw new ZiteError(`“${parsed.label}” is already in this list`, 'CONFLICT');
      }

      await withRetry(() => zite.choices.update({ id: choiceId, record: { label: parsed.label, ...(parsed.archived === undefined ? {} : { archived: parsed.archived }) } }));

      if (renaming && parsed.relabelRecords) {
        for (const use of USES[parsed.list]) {
          const { rows } = await zite.sql({ query: `SELECT id FROM "${use.table}" WHERE "${use.column}" = $1`, params: [oldLabel] });
          const client = CLIENTS[use.client]();
          // Sequential on purpose: live Zite rate-limits bursts of parallel writes.
          for (const row of rows) {
            await withRetry(() => (client as { update: (a: { id: string; record: never }) => Promise<unknown> }).update({ id: String(row.id), record: { [use.column]: parsed.label } as never }));
            recordsRelabelled++;
          }
        }
      }

      await logEvent({
        kind: parsed.archived ? 'choice.archived' : 'choice.updated',
        entity: { type: 'settings', id: choiceId },
        actorId: actor.id,
        summary: parsed.archived ? `archived “${parsed.label}” from ${parsed.list}` : renaming ? `renamed “${oldLabel}” to “${parsed.label}” in ${parsed.list}` : `changed “${parsed.label}” in ${parsed.list}`,
      });
    } else {
      if (parsed.dryRun) return { choiceId: '', created: false, recordsUsing: 0, recordsRelabelled: 0 };
      const { rows } = await zite.sql({ query: `SELECT id, "label", COALESCE("position", 0) AS "position" FROM "Choices" WHERE "list" = $1`, params: [parsed.list] });
      if (rows.some(r => String(r.label).toLowerCase() === parsed.label.toLowerCase())) throw new ZiteError(`“${parsed.label}” is already in this list`, 'CONFLICT');
      const position = rows.reduce((max, r) => Math.max(max, num(r.position)), -1) + 1;
      const choice = await withRetry(() => zite.choices.create({ record: { label: parsed.label, list: parsed.list, position, archived: false } }));
      choiceId = choice.id;
      created = true;
      await logEvent({ kind: 'choice.created', entity: { type: 'settings', id: choiceId }, actorId: actor.id, summary: `added “${parsed.label}” to ${parsed.list}` });
    }

    if (parsed.order?.length) {
      const { rows } = await zite.sql({ query: `SELECT id, COALESCE("position", 0) AS "position" FROM "Choices" WHERE "list" = $1`, params: [parsed.list] });
      const known = new Set(rows.map(r => String(r.id)));
      const current = new Map(rows.map(r => [String(r.id), num(r.position)]));
      // Sequential on purpose: live Zite rate-limits bursts of parallel writes.
      for (const [index, cid] of parsed.order.filter(x => known.has(x)).entries()) {
        if (current.get(cid) === index) continue;
        await withRetry(() => zite.choices.update({ id: cid, record: { position: index } }));
      }
    }

    return { choiceId, created, recordsUsing, recordsRelabelled };
  },
});
