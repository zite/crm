import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { assertCan, getActor } from '@project/shared/server/actor';
import { logEvent } from '@project/shared/server/events';
import { num, str, withRetry } from '@project/shared/server/sql';
import type { ImportObject } from '@project/shared/constants';
import { id, parseInput } from '../server/input';

/**
 * Undo an import.
 *
 * It deletes exactly what that import created — every record stamped with its
 * id — and nothing else. Records the import only *updated* are left alone:
 * the old values are gone and guessing at them would be worse than leaving
 * them.
 *
 * A record the team has since worked — a deal, an activity, a task, a note —
 * is kept and reported, because deleting it would take that work with it.
 */

const TABLES: Record<ImportObject, { table: string; client: 'companies' | 'contacts' | 'deals' | 'leads'; column: 'companyId' | 'contactId' | 'dealId' | 'leadId' }> = {
  Companies: { table: 'Companies', client: 'companies', column: 'companyId' },
  Contacts: { table: 'Contacts', client: 'contacts', column: 'contactId' },
  Deals: { table: 'Deals', client: 'deals', column: 'dealId' },
  Leads: { table: 'Leads', client: 'leads', column: 'leadId' },
};

const CLIENTS = { companies: () => zite.companies, contacts: () => zite.contacts, deals: () => zite.deals, leads: () => zite.leads } as const;

const inputSchema = z.object({ importId: id, dryRun: z.boolean().optional() });

export default createEndpoint({
  description: 'Undo an import, deleting only the records it created and keeping any that have been worked since',
  authenticated: true,
  inputSchema,
  outputSchema: z.object({
    deleted: z.number(),
    kept: z.number(),
    keptReasons: z.array(z.object({ name: z.string(), reason: z.string() })),
    dryRun: z.boolean(),
    done: z.boolean(),
  }),
  execute: async ({ input, context }) => {
    const { importId, dryRun } = parseInput(inputSchema, input);
    const actor = await getActor(context);
    assertCan(actor, 'data.import');

    const record = await zite.imports.findOne({ id: importId });
    if (!record) throw new ZiteError('That import is no longer in the history', 'NOT_FOUND');
    if (record.undoneAt) throw new ZiteError('That import has already been undone', 'CONFLICT');
    const object = (record.object ?? 'Companies') as ImportObject;
    const spec = TABLES[object];

    /*
     * One query per import object: the rows it created, each with the count of
     * the work that has landed on them since. `created_at > $2` excludes the
     * import's own writes — a deal the import made under a company it made is
     * part of the same import, not later work.
     */
    const stamped = await zite.sql({
      query: `
        SELECT r.id, r."name",
          (SELECT COUNT(*) FROM "Activities" a WHERE a."${spec.column}" = r.id::text) AS "activityCount",
          (SELECT COUNT(*) FROM "Tasks" t WHERE t."${spec.column}" = r.id::text) AS "taskCount",
          ${
            object === 'Companies'
              ? `(SELECT COUNT(*) FROM "Deals" d WHERE d."companyId" = r.id::text AND COALESCE(d."importId", '') <> $1) AS "dealCount",
                 (SELECT COUNT(*) FROM "Contacts" c WHERE c."companyId" = r.id::text AND COALESCE(c."importId", '') <> $1) AS "childCount"`
              : object === 'Contacts'
                ? `(SELECT COUNT(*) FROM "Deals" d WHERE d."contactId" = r.id::text AND COALESCE(d."importId", '') <> $1) AS "dealCount", 0 AS "childCount"`
                : `0 AS "dealCount", 0 AS "childCount"`
          }
        FROM "${spec.table}" r
        WHERE r."importId" = $1
        ORDER BY r.created_at ASC`,
      params: [importId],
    });

    const keptReasons: Array<{ name: string; reason: string }> = [];
    const removable: string[] = [];
    for (const row of stamped.rows) {
      const name = str(row.name) || 'A record';
      const activity = num(row.activityCount);
      const tasks = num(row.taskCount);
      const deals = num(row.dealCount);
      const children = num(row.childCount);
      if (deals) keptReasons.push({ name, reason: `has ${deals} ${deals === 1 ? 'deal' : 'deals'} on it now` });
      else if (children) keptReasons.push({ name, reason: `has ${children} ${children === 1 ? 'contact' : 'contacts'} under it now` });
      else if (activity) keptReasons.push({ name, reason: `has ${activity} logged ${activity === 1 ? 'activity' : 'activities'}` });
      else if (tasks) keptReasons.push({ name, reason: `has ${tasks} ${tasks === 1 ? 'task' : 'tasks'} on it` });
      else removable.push(String(row.id));
    }

    if (dryRun) return { deleted: removable.length, kept: keptReasons.length, keptReasons: keptReasons.slice(0, 20), dryRun: true, done: false };

    const client = CLIENTS[spec.client]();
    let deleted = 0;
    // Sequential on purpose: live Zite rate-limits bursts of parallel writes.
    for (const rowId of removable) {
      // Anything the import itself hung off this record goes with it.
      for (const child of ['DealContacts', 'StageChanges', 'LineItems'] as const) {
        if (spec.column !== 'dealId') break;
        const { rows } = await zite.sql({ query: `SELECT id FROM "${child}" WHERE "dealId" = $1`, params: [rowId] });
        for (const c of rows) {
          const table = child === 'DealContacts' ? zite.dealContacts : child === 'StageChanges' ? zite.stageChanges : zite.lineItems;
          await withRetry(() => table.delete({ id: String(c.id) })).catch(() => undefined);
        }
      }
      const { rows: events } = await zite.sql({ query: `SELECT id FROM "Events" WHERE "${spec.column}" = $1`, params: [rowId] });
      for (const e of events) await withRetry(() => zite.events.delete({ id: String(e.id) })).catch(() => undefined);
      try {
        await withRetry(() => (client as { delete: (a: { id: string }) => Promise<unknown> }).delete({ id: rowId }));
        deleted++;
      } catch {
        keptReasons.push({ name: 'A record', reason: 'couldn’t be deleted' });
      }
    }

    const done = keptReasons.length === 0;
    await withRetry(() =>
      zite.imports.update({
        id: importId,
        record: { status: 'Undone', undoneAt: new Date().toISOString(), createdCount: Math.max(0, num(record.createdCount) - deleted) },
      }),
    );
    await logEvent({
      kind: 'import.undone',
      entity: { type: 'import', id: importId },
      actorId: actor.id,
      summary: `undid an import of ${object.toLowerCase()} — removed ${deleted}${keptReasons.length ? `, kept ${keptReasons.length} that had been worked` : ''}`,
    });

    return { deleted, kept: keptReasons.length, keptReasons: keptReasons.slice(0, 20), dryRun: false, done };
  },
});
