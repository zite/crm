import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { assertCan, getActor } from '@project/shared/server/actor';
import { updateDeal, loadPipelines } from '@project/shared/server/deals';
import { logEvent } from '@project/shared/server/events';
import { getSettings } from '@project/shared/server/settings';
import { num, withRetry } from '@project/shared/server/sql';
import { todayIn } from '@project/shared/dates';
import { id, parseInput, today as todayInput } from '../server/input';

/**
 * Delete a stage.
 *
 * A stage holding deals is never deleted quietly: the call is refused with the
 * count, and the caller may retry with `moveToStageId` to walk those deals over
 * first. The moves go through `updateDeal`, so each one gets its stage history,
 * its event and its automations exactly as a person dragging the card would.
 */

const inputSchema = z.object({ stageId: id, moveToStageId: id.optional(), today: todayInput });

export default createEndpoint({
  description: 'Delete a pipeline stage, optionally moving the deals in it to another stage first',
  authenticated: true,
  inputSchema,
  outputSchema: z.object({ deleted: z.boolean(), moved: z.number(), blockedBy: z.number(), stageName: z.string() }),
  execute: async ({ input, context }) => {
    const parsed = parseInput(inputSchema, input);
    const actor = await getActor(context);
    assertCan(actor, 'settings.manage');

    const stage = await zite.stages.findOne({ id: parsed.stageId });
    if (!stage) throw new ZiteError('That stage no longer exists', 'NOT_FOUND');
    const stageName = stage.name ?? 'that stage';
    if (stage.kind !== 'Open') throw new ZiteError(`${stageName} is the ${stage.kind} stage — every pipeline needs one, so it can’t be deleted`, 'CONFLICT');

    const { rows: openStages } = await zite.sql({
      query: `SELECT COUNT(*) AS "n" FROM "Stages" WHERE "pipelineId" = $1 AND "kind" = 'Open' AND COALESCE("archived", false) = false AND id::text <> $2`,
      params: [stage.pipelineId, parsed.stageId],
    });
    if (num(openStages[0]?.n) === 0) throw new ZiteError('A pipeline needs at least one open stage', 'CONFLICT');

    const { rows: held } = await zite.sql({ query: `SELECT id FROM "Deals" WHERE "stageId" = $1`, params: [parsed.stageId] });

    if (held.length && !parsed.moveToStageId) {
      throw new ZiteError(`${held.length} ${held.length === 1 ? 'deal is' : 'deals are'} in ${stageName}. Choose a stage to move them to first.`, 'CONFLICT');
    }

    let moved = 0;
    if (held.length && parsed.moveToStageId) {
      const target = await zite.stages.findOne({ id: parsed.moveToStageId });
      if (!target || target.pipelineId !== stage.pipelineId) throw new ZiteError('Choose a stage in the same pipeline', 'BAD_REQUEST');
      if (parsed.moveToStageId === parsed.stageId) throw new ZiteError('Choose a different stage to move the deals to', 'BAD_REQUEST');
      const settings = await getSettings();
      const pipelines = await loadPipelines();
      const today = parsed.today ?? todayIn(settings.timezone);
      // Sequential on purpose: live Zite rate-limits bursts of parallel writes.
      for (const row of held) {
        await updateDeal(actor, String(row.id), { stageId: parsed.moveToStageId }, { today, settings, pipelines });
        moved++;
      }
    }

    await withRetry(() => zite.stages.delete({ id: parsed.stageId }));
    await logEvent({
      kind: 'stage.deleted',
      entity: { type: 'settings', id: parsed.stageId },
      actorId: actor.id,
      summary: moved ? `deleted the ${stageName} stage and moved ${moved} ${moved === 1 ? 'deal' : 'deals'}` : `deleted the ${stageName} stage`,
    });
    return { deleted: true, moved, blockedBy: 0, stageName };
  },
});
