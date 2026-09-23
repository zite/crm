import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { assertCan, getActor } from '@project/shared/server/actor';
import { can } from '@project/shared/roles';
import { withRetry } from '@project/shared/server/sql';
import { VIEW_SCOPES } from '@project/shared/constants';
import { id, parseInput } from '../server/input';

const inputSchema = z.object({
  id: id.optional(),
  name: z.string().trim().min(1, 'Name the view').max(80),
  scope: z.enum(VIEW_SCOPES),
  config: z.record(z.any()),
  shared: z.boolean().optional(),
  position: z.number().int().optional(),
});

export default createEndpoint({
  description: 'Create or update a saved view',
  authenticated: true,
  inputSchema,
  outputSchema: z.object({ id: z.string() }),
  execute: async ({ input, context }) => {
    const data = parseInput(inputSchema, input);
    const actor = await getActor(context);
    assertCan(actor, 'records.edit');
    const record = { name: data.name, scope: data.scope, config: JSON.stringify(data.config).slice(0, 20_000), shared: data.shared ?? false, position: data.position ?? 0 };
    if (data.id) {
      const existing = await zite.views.findOne({ id: data.id });
      if (!existing) throw new ZiteError('That view no longer exists', 'NOT_FOUND');
      if (existing.ownerId !== actor.id && !can(actor.role, 'outreach.manage')) throw new ZiteError('Only its owner or a manager can change this view', 'FORBIDDEN');
      await withRetry(() => zite.views.update({ id: data.id as string, record }));
      return { id: data.id };
    }
    const created = await withRetry(() => zite.views.create({ record: { ...record, ownerId: actor.id } }));
    return { id: created.id };
  },
});
