import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { assertCan, getActor } from '@project/shared/server/actor';
import { logEvent } from '@project/shared/server/events';
import { withRetry } from '@project/shared/server/sql';
import { id, parseInput } from '../server/input';

/**
 * Put a pipeline's stages in a new order. The board, the stage track and the
 * stage meter all read `position`, so one write moves every one of them.
 * Closed stages always sit after the open ones, whatever order was sent.
 */

const inputSchema = z.object({ pipelineId: id, stageIds: z.array(id).min(1).max(40) });

export default createEndpoint({
  description: 'Reorder the stages in a pipeline',
  authenticated: true,
  inputSchema,
  outputSchema: z.object({ ordered: z.number() }),
  execute: async ({ input, context }) => {
    const { pipelineId, stageIds } = parseInput(inputSchema, input);
    const actor = await getActor(context);
    assertCan(actor, 'settings.manage');

    const { rows } = await zite.sql({ query: `SELECT id, "kind", "position" FROM "Stages" WHERE "pipelineId" = $1`, params: [pipelineId] });
    if (!rows.length) throw new ZiteError('That pipeline no longer exists', 'NOT_FOUND');
    const byId = new Map(rows.map(r => [String(r.id), r]));
    const wanted = stageIds.filter(sid => byId.has(sid));
    if (wanted.length !== rows.length) throw new ZiteError('The stage order is out of date — reload and try again', 'CONFLICT');

    const open = wanted.filter(sid => byId.get(sid)?.kind === 'Open');
    const closed = wanted.filter(sid => byId.get(sid)?.kind !== 'Open').sort((a, b) => (byId.get(a)?.kind === 'Won' ? -1 : 1) - (byId.get(b)?.kind === 'Won' ? -1 : 1));
    const order = [...open, ...closed];

    let ordered = 0;
    // Sequential on purpose: live Zite rate-limits bursts of parallel writes.
    for (const [index, stageId] of order.entries()) {
      if (Number(byId.get(stageId)?.position ?? -1) === index) continue;
      await withRetry(() => zite.stages.update({ id: stageId, record: { position: index } }));
      ordered++;
    }
    if (ordered) await logEvent({ kind: 'pipeline.reordered', entity: { type: 'settings', id: pipelineId }, actorId: actor.id, summary: 'reordered the pipeline’s stages' });
    return { ordered };
  },
});
