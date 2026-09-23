import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { assertCan, getActor } from '@project/shared/server/actor';
import { can } from '@project/shared/roles';
import { ACTIVITY_OUTCOMES } from '@project/shared/constants';
import { withRetry } from '@project/shared/server/sql';
import { id, isoDateTime, parseInput } from '../server/input';

const inputSchema = z.object({
  id,
  subject: z.string().max(240).nullable().optional(),
  body: z.string().max(20_000).nullable().optional(),
  occurredAt: isoDateTime.optional(),
  endsAt: isoDateTime.nullable().optional(),
  durationMinutes: z.number().int().min(0).max(1440).nullable().optional(),
  outcome: z.enum(ACTIVITY_OUTCOMES).nullable().optional(),
  location: z.string().max(500).nullable().optional(),
  pinned: z.boolean().optional(),
});

export default createEndpoint({
  description: 'Edit a logged activity (its author, or a manager)',
  authenticated: true,
  inputSchema,
  outputSchema: z.object({ ok: z.boolean() }),
  execute: async ({ input, context }) => {
    const { id: activityId, ...patch } = parseInput(inputSchema, input);
    const actor = await getActor(context);
    assertCan(actor, 'records.edit');
    const activity = await zite.activities.findOne({ id: activityId });
    if (!activity) throw new ZiteError('That activity no longer exists', 'NOT_FOUND');
    const mine = activity.createdById === actor.id || activity.ownerId === actor.id;
    if (!mine && !can(actor.role, 'records.delete')) throw new ZiteError('You can only edit activities you logged', 'FORBIDDEN');
    const record = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
    if (!Object.keys(record).length) throw new ZiteError('Nothing to change', 'BAD_REQUEST');
    await withRetry(() => zite.activities.update({ id: activityId, record: record as never }));
    return { ok: true };
  },
});
