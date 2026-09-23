import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { getActor } from '@project/shared/server/actor';
import { can } from '@project/shared/roles';
import { withRetry } from '@project/shared/server/sql';
import { id, parseInput } from '../server/input';

export default createEndpoint({
  description: 'Remove a file from a record',
  authenticated: true,
  inputSchema: z.object({ id }),
  outputSchema: z.object({ ok: z.boolean() }),
  execute: async ({ input, context }) => {
    const data = parseInput(z.object({ id }), input);
    const actor = await getActor(context);
    const doc = await zite.documents.findOne({ id: data.id });
    if (!doc) throw new ZiteError('That file is already gone', 'NOT_FOUND');
    if (doc.uploadedById !== actor.id && !can(actor.role, 'records.delete')) throw new ZiteError('You can only remove files you added', 'FORBIDDEN');
    await withRetry(() => zite.documents.delete({ id: data.id }));
    return { ok: true };
  },
});
