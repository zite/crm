import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { assertCan, getActor } from '@project/shared/server/actor';
import { logEvent } from '@project/shared/server/events';
import { canManageAsset } from '@project/shared/roles';
import { nextRunAfter, parseSequenceSettings, parseSteps } from '@project/shared/server/sequencesEngine';
import { getSettings } from '@project/shared/server/settings';
import { iso, num, ref, str, withRetry } from '@project/shared/server/sql';
import { id, parseInput } from '../server/input';

/**
 * Pause, resume or stop enrollments — one, or every one you've selected.
 *
 *   pause   keeps the place in the cadence; nothing sends until you resume
 *   resume  puts it back in the diary (immediately if its step is already due)
 *   stop    ends it for good, recorded as "Stopped by hand"
 *
 * You can change an enrollment you own, or any of them if you manage outreach.
 */
const inputSchema = z.object({ ids: z.array(id).min(1).max(500), action: z.enum(['pause', 'resume', 'stop']) });

const VERB = { pause: 'paused', resume: 'resumed', stop: 'stopped' } as const;

export default createEndpoint({
  description: 'Pause, resume or stop sequence enrollments',
  authenticated: true,
  inputSchema,
  outputSchema: z.object({ updated: z.number(), refused: z.number(), unchanged: z.number() }),
  execute: async ({ input, context }) => {
    const { ids, action } = parseInput(inputSchema, input);
    const actor = await getActor(context);
    assertCan(actor, 'outreach.send');
    const settings = await getSettings();
    const now = new Date();

    const placeholders = ids.map((_, i) => `$${i + 1}`).join(', ');
    const { rows } = await zite.sql({
      query: `
        SELECT e.id, e."ownerId", e."status", e."stepIndex", e."nextRunAt", e."contactId", e."sequenceId",
               s."steps", s."settings", s."name" AS "sequenceName", s."ownerId" AS "sequenceOwnerId"
        FROM "Enrollments" e
        LEFT JOIN "Sequences" s ON s.id::text = e."sequenceId"
        WHERE e.id::text IN (${placeholders})`,
      params: ids,
    });

    let updated = 0;
    let refused = 0;
    let unchanged = 0;
    // Sequential: live Zite rate-limits bursts of parallel writes.
    for (const r of rows) {
      const ownerId = ref(r.ownerId);
      if (!canManageAsset(actor.role, actor.id, ownerId) && !canManageAsset(actor.role, actor.id, ref(r.sequenceOwnerId))) {
        refused++;
        continue;
      }
      const status = str(r.status) || 'Active';
      if (action === 'pause' && status !== 'Active') {
        unchanged++;
        continue;
      }
      if (action === 'resume' && status !== 'Paused') {
        unchanged++;
        continue;
      }
      if (action === 'stop' && (status === 'Finished' || status === 'Exited')) {
        unchanged++;
        continue;
      }

      if (action === 'pause') {
        await withRetry(() => zite.enrollments.update({ id: String(r.id), record: { status: 'Paused' } }));
      } else if (action === 'resume') {
        const steps = parseSteps(r.steps);
        const stepIndex = num(r.stepIndex);
        const done = stepIndex >= steps.length;
        const nextRunAt = iso(r.nextRunAt) ?? (done ? null : nextRunAfter(now, 0, parseSequenceSettings(r.settings), settings.timezone));
        await withRetry(() => zite.enrollments.update({ id: String(r.id), record: { status: done ? 'Finished' : 'Active', nextRunAt, ...(done ? { finishedAt: now.toISOString() } : {}) } }));
      } else {
        await withRetry(() => zite.enrollments.update({ id: String(r.id), record: { status: 'Exited', exitReason: 'Manually', finishedAt: now.toISOString(), nextRunAt: null } }));
      }
      updated++;
      const contactId = ref(r.contactId);
      if (contactId) {
        await logEvent({
          kind: `sequence.${action}d`,
          entity: { type: 'contact', id: contactId },
          actorId: actor.id,
          summary: `${VERB[action]} this contact’s “${str(r.sequenceName) || 'sequence'}” enrollment`,
          contactId,
          data: { sequenceId: str(r.sequenceId) },
        });
      }
    }

    if (!updated && refused) throw new ZiteError('You can only change enrollments you own', 'FORBIDDEN');
    return { updated, refused, unchanged };
  },
});
