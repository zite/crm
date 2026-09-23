import { z } from 'zod';
import { createEndpoint } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { assertCan, getActor } from '@project/shared/server/actor';
import { can } from '@project/shared/roles';
import { withRetry } from '@project/shared/server/sql';
import { id, parseInput } from '../server/input';

export default createEndpoint({
  description: 'Delete tasks you own (managers can delete any)',
  authenticated: true,
  inputSchema: z.object({ ids: z.array(id).min(1).max(500) }),
  outputSchema: z.object({ deleted: z.number() }),
  execute: async ({ input, context }) => {
    const { ids } = parseInput(z.object({ ids: z.array(id).min(1).max(500) }), input);
    const actor = await getActor(context);
    assertCan(actor, 'records.edit');
    let deleted = 0;
    for (const taskId of ids) {
      const task = await zite.tasks.findOne({ id: taskId });
      if (!task) continue;
      const mine = task.ownerId === actor.id || task.createdById === actor.id;
      if (!mine && !can(actor.role, 'records.delete')) continue;
      await withRetry(() => zite.tasks.delete({ id: taskId }));
      deleted++;
    }
    return { deleted };
  },
});
