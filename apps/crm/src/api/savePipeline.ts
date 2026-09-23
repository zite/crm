import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { assertCan, getActor } from '@project/shared/server/actor';
import { logEvent } from '@project/shared/server/events';
import { num, withRetry } from '@project/shared/server/sql';
import { id, parseInput } from '../server/input';

/**
 * Create, rename, archive or default a pipeline. A new pipeline is never
 * empty: it comes with the three stages every pipeline needs (a first open
 * stage, Won and Lost), so a deal can be created in it straight away.
 */

const inputSchema = z.object({
  pipelineId: id.optional(),
  name: z.string().trim().min(1, 'Give the pipeline a name').max(80),
  description: z.string().trim().max(400).optional(),
  isDefault: z.boolean().optional(),
  archived: z.boolean().optional(),
});

export default createEndpoint({
  description: 'Create or change a pipeline: name, description, whether it is the default, whether it is archived',
  authenticated: true,
  inputSchema,
  outputSchema: z.object({ pipelineId: z.string(), created: z.boolean() }),
  execute: async ({ input, context }) => {
    const parsed = parseInput(inputSchema, input);
    const actor = await getActor(context);
    assertCan(actor, 'settings.manage');

    let pipelineId = parsed.pipelineId ?? '';
    let created = false;

    if (pipelineId) {
      const existing = await zite.pipelines.findOne({ id: pipelineId });
      if (!existing) throw new ZiteError('That pipeline no longer exists', 'NOT_FOUND');
      if (parsed.archived) {
        if (existing.isDefault) throw new ZiteError('Make another pipeline the default before archiving this one', 'CONFLICT');
        const { rows } = await zite.sql({ query: `SELECT COUNT(*) AS "n" FROM "Deals" WHERE "pipelineId" = $1 AND "status" = 'Open'`, params: [pipelineId] });
        const open = num(rows[0]?.n);
        if (open) throw new ZiteError(`${open} open ${open === 1 ? 'deal is' : 'deals are'} still in this pipeline. Move or close them first.`, 'CONFLICT');
      }
      await withRetry(() =>
        zite.pipelines.update({
          id: pipelineId,
          record: { name: parsed.name, description: parsed.description ?? null, ...(parsed.archived === undefined ? {} : { archived: parsed.archived }) },
        }),
      );
      await logEvent({
        kind: parsed.archived ? 'pipeline.archived' : 'pipeline.updated',
        entity: { type: 'settings', id: pipelineId },
        actorId: actor.id,
        summary: parsed.archived ? `archived the ${parsed.name} pipeline` : `changed the ${parsed.name} pipeline`,
      });
    } else {
      const { rows } = await zite.sql({ query: `SELECT COALESCE(MAX("position"), -1) AS "maxPos", COUNT(*) AS "n" FROM "Pipelines"`, params: [] });
      const pipeline = await withRetry(() =>
        zite.pipelines.create({ record: { name: parsed.name, description: parsed.description ?? null, position: num(rows[0]?.maxPos, -1) + 1, isDefault: num(rows[0]?.n) === 0, archived: false } }),
      );
      pipelineId = pipeline.id;
      created = true;
      await zite.stages.bulkCreate({
        records: [
          { name: 'New', pipelineId, position: 0, probability: 20, kind: 'Open', rottingDays: 14, guidance: 'What are they trying to fix, and what happens if they don’t?', archived: false },
          { name: 'Won', pipelineId, position: 1, probability: 100, kind: 'Won', rottingDays: null, guidance: null, archived: false },
          { name: 'Lost', pipelineId, position: 2, probability: 0, kind: 'Lost', rottingDays: null, guidance: null, archived: false },
        ],
      });
      await logEvent({ kind: 'pipeline.created', entity: { type: 'settings', id: pipelineId }, actorId: actor.id, summary: `created the ${parsed.name} pipeline` });
    }

    if (parsed.isDefault) {
      const { rows } = await zite.sql({ query: `SELECT id FROM "Pipelines" WHERE COALESCE("isDefault", false) = true AND id::text <> $1`, params: [pipelineId] });
      // Sequential on purpose: live Zite rate-limits bursts of parallel writes.
      for (const row of rows) await withRetry(() => zite.pipelines.update({ id: String(row.id), record: { isDefault: false } }));
      await withRetry(() => zite.pipelines.update({ id: pipelineId, record: { isDefault: true, archived: false } }));
    }

    return { pipelineId, created };
  },
});
