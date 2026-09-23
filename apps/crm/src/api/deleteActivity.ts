import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { getActor } from '@project/shared/server/actor';
import { can } from '@project/shared/roles';
import { withRetry } from '@project/shared/server/sql';
import { id, parseInput } from '../server/input';

export default createEndpoint({
  description: 'Delete a logged activity',
  authenticated: true,
  inputSchema: z.object({ id }),
  outputSchema: z.object({ ok: z.boolean() }),
  execute: async ({ input, context }) => {
    const { id: activityId } = parseInput(z.object({ id }), input);
    const actor = await getActor(context);
    const activity = await zite.activities.findOne({ id: activityId });
    if (!activity) throw new ZiteError('That activity no longer exists', 'NOT_FOUND');
    const mine = activity.createdById === actor.id || activity.ownerId === actor.id;
    if (!mine && !can(actor.role, 'records.delete')) throw new ZiteError('You can only delete activities you logged', 'FORBIDDEN');
    await withRetry(() => zite.activities.delete({ id: activityId }));
    return { ok: true };
  },
});
