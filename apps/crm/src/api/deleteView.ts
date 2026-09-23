import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { getActor } from '@project/shared/server/actor';
import { can } from '@project/shared/roles';
import { withRetry } from '@project/shared/server/sql';
import { id, parseInput } from '../server/input';

export default createEndpoint({
  description: 'Delete a saved view',
  authenticated: true,
  inputSchema: z.object({ id }),
  outputSchema: z.object({ ok: z.boolean() }),
  execute: async ({ input, context }) => {
    const data = parseInput(z.object({ id }), input);
    const actor = await getActor(context);
    const view = await zite.views.findOne({ id: data.id });
    if (!view) throw new ZiteError('That view no longer exists', 'NOT_FOUND');
    if (view.ownerId !== actor.id && !can(actor.role, 'outreach.manage')) throw new ZiteError('Only its owner or a manager can delete this view', 'FORBIDDEN');
    await withRetry(() => zite.views.delete({ id: data.id }));
    return { ok: true };
  },
});
