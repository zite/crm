import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { assertCan, getActor } from '@project/shared/server/actor';
import { canManageAsset } from '@project/shared/roles';
import { ref, withRetry } from '@project/shared/server/sql';
import { id, parseInput } from '../server/input';

/** Delete templates. Only their owner, a manager or an admin may. Archiving is the reversible option. */
const inputSchema = z.object({ ids: z.array(id).min(1).max(100) });

export default createEndpoint({
  description: 'Delete one or more email templates',
  authenticated: true,
  inputSchema,
  outputSchema: z.object({ deleted: z.number(), refused: z.number() }),
  execute: async ({ input, context }) => {
    const { ids } = parseInput(inputSchema, input);
    const actor = await getActor(context);
    assertCan(actor, 'outreach.send');

    let deleted = 0;
    let refused = 0;
    // Sequential: live Zite rate-limits bursts of parallel writes.
    for (const templateId of ids) {
      const template = await zite.emailTemplates.findOne({ id: templateId });
      if (!template) continue;
      if (!canManageAsset(actor.role, actor.id, ref(template.ownerId))) {
        refused++;
        continue;
      }
      await withRetry(() => zite.emailTemplates.delete({ id: templateId }));
      deleted++;
    }
    if (!deleted && refused) throw new ZiteError(refused === 1 ? 'Only its owner or a manager can delete that template' : 'Only their owners or a manager can delete those templates', 'FORBIDDEN');
    return { deleted, refused };
  },
});
