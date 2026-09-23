import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { assertCan, getActor } from '@project/shared/server/actor';
import { logEvent } from '@project/shared/server/events';
import { num, withRetry } from '@project/shared/server/sql';
import { STAGE_KINDS } from '@project/shared/constants';
import { id, parseInput } from '../server/input';

/**
 * Add or change a stage.
 *
 * A pipeline needs exactly one Won stage and one Lost stage — they are what
 * "mark won" and "mark lost" mean — so changing a kind is checked against
 * what is already there rather than left to produce a pipeline that can't
 * close a deal.
 */

const inputSchema = z.object({
  stageId: id.optional(),
  pipelineId: id,
  name: z.string().trim().min(1, 'Give the stage a name').max(60),
  kind: z.enum(STAGE_KINDS).optional(),
  probability: z.number().int().min(0).max(100).optional(),
  rottingDays: z.number().int().min(1).max(365).nullable().optional(),
  guidance: z.string().trim().max(600).optional(),
  archived: z.boolean().optional(),
});

export default createEndpoint({
  description: 'Add or change a pipeline stage: name, kind, probability, rotting days and guidance',
  authenticated: true,
  inputSchema,
  outputSchema: z.object({ stageId: z.string(), created: z.boolean() }),
  execute: async ({ input, context }) => {
    const parsed = parseInput(inputSchema, input);
    const actor = await getActor(context);
    assertCan(actor, 'settings.manage');

    const pipeline = await zite.pipelines.findOne({ id: parsed.pipelineId });
    if (!pipeline) throw new ZiteError('That pipeline no longer exists', 'BAD_REQUEST');

    const { rows: siblings } = await zite.sql({ query: `SELECT id, "kind", "position" FROM "Stages" WHERE "pipelineId" = $1 ORDER BY COALESCE("position", 0)`, params: [parsed.pipelineId] });
    const kind = parsed.kind ?? 'Open';
    if (kind !== 'Open') {
      const clash = siblings.find(s => s.kind === kind && String(s.id) !== parsed.stageId);
      if (clash) throw new ZiteError(`This pipeline already has a ${kind} stage. A pipeline can only have one.`, 'CONFLICT');
    }

    const record: Record<string, unknown> = {
      name: parsed.name,
      pipelineId: parsed.pipelineId,
      kind,
      probability: parsed.probability ?? (kind === 'Won' ? 100 : kind === 'Lost' ? 0 : 50),
      rottingDays: kind === 'Open' ? parsed.rottingDays ?? null : null,
      guidance: parsed.guidance || null,
    };
    if (parsed.archived !== undefined) record.archived = parsed.archived;

    if (parsed.stageId) {
      const existing = siblings.find(s => String(s.id) === parsed.stageId);
      if (!existing) throw new ZiteError('That stage no longer exists', 'NOT_FOUND');
      if (parsed.archived) {
        if (existing.kind !== 'Open') throw new ZiteError('The Won and Lost stages can’t be archived — every pipeline needs both', 'CONFLICT');
        const { rows } = await zite.sql({ query: `SELECT COUNT(*) AS "n" FROM "Deals" WHERE "stageId" = $1 AND "status" = 'Open'`, params: [parsed.stageId] });
        const open = num(rows[0]?.n);
        if (open) throw new ZiteError(`${open} open ${open === 1 ? 'deal is' : 'deals are'} in ${parsed.name}. Move them to another stage first.`, 'CONFLICT');
      }
      await withRetry(() => zite.stages.update({ id: parsed.stageId as string, record: record as never }));
      await logEvent({ kind: 'stage.updated', entity: { type: 'settings', id: parsed.stageId }, actorId: actor.id, summary: `changed the ${parsed.name} stage in ${pipeline.name ?? 'a pipeline'}` });
      return { stageId: parsed.stageId, created: false };
    }

    // New open stages go in just before Won, so the closed stages stay at the end.
    const firstClosed = siblings.find(s => s.kind !== 'Open');
    record.position = kind === 'Open' && firstClosed ? num(firstClosed.position) : siblings.length;
    record.archived = false;
    const created = await withRetry(() => zite.stages.create({ record: record as never }));
    if (kind === 'Open' && firstClosed) {
      // Sequential on purpose: live Zite rate-limits bursts of parallel writes.
      for (const s of siblings.filter(s => num(s.position) >= num(firstClosed.position))) {
        await withRetry(() => zite.stages.update({ id: String(s.id), record: { position: num(s.position) + 1 } }));
      }
    }
    await logEvent({ kind: 'stage.created', entity: { type: 'settings', id: created.id }, actorId: actor.id, summary: `added the ${parsed.name} stage to ${pipeline.name ?? 'a pipeline'}` });
    return { stageId: created.id, created: true };
  },
});
