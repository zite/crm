import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { assertCan, getActor } from '@project/shared/server/actor';
import { logEvent } from '@project/shared/server/events';
import { canManageAsset } from '@project/shared/roles';
import { ref, str, withRetry } from '@project/shared/server/sql';
import { id, parseInput } from '../server/input';

/**
 * Delete sequences and their enrollments. The emails already sent and the
 * tasks already created stay where they are — they are history on a contact,
 * not part of the sequence. Archiving is the reversible option.
 */
const inputSchema = z.object({ ids: z.array(id).min(1).max(50) });

export default createEndpoint({
  description: 'Delete one or more sequences and the enrollments on them',
  authenticated: true,
  inputSchema,
  outputSchema: z.object({ deleted: z.number(), enrollmentsRemoved: z.number(), refused: z.number() }),
  execute: async ({ input, context }) => {
    const { ids } = parseInput(inputSchema, input);
    const actor = await getActor(context);
    assertCan(actor, 'outreach.send');

    let deleted = 0;
    let enrollmentsRemoved = 0;
    let refused = 0;
    // Sequential: live Zite rate-limits bursts of parallel writes.
    for (const sequenceId of ids) {
      const sequence = await zite.sequences.findOne({ id: sequenceId });
      if (!sequence) continue;
      if (!canManageAsset(actor.role, actor.id, ref(sequence.ownerId))) {
        refused++;
        continue;
      }
      const { rows } = await zite.sql({ query: `SELECT id FROM "Enrollments" WHERE "sequenceId" = $1 LIMIT 2000`, params: [sequenceId] });
      for (const row of rows) {
        await withRetry(() => zite.enrollments.delete({ id: String(row.id) }));
        enrollmentsRemoved++;
      }
      await withRetry(() => zite.sequences.delete({ id: sequenceId }));
      deleted++;
      await logEvent({ kind: 'sequence.deleted', entity: { type: 'sequence', id: sequenceId }, actorId: actor.id, summary: `deleted the sequence “${str(sequence.name) ?? ''}”` });
    }
    if (!deleted && refused) throw new ZiteError('Only its owner or a manager can delete that sequence', 'FORBIDDEN');
    return { deleted, enrollmentsRemoved, refused };
  },
});
