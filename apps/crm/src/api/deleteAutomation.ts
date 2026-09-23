import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { assertCan, getActor } from '@project/shared/server/actor';
import { logEvent } from '@project/shared/server/events';
import { withRetry } from '@project/shared/server/sql';
import { id, parseInput } from '../server/input';

/** Delete an automation and its run log. Switching it off is the reversible option. */

const inputSchema = z.object({ automationId: id });

export default createEndpoint({
  description: 'Delete an automation and the record of its runs',
  authenticated: true,
  inputSchema,
  outputSchema: z.object({ deleted: z.boolean(), runsRemoved: z.number(), name: z.string() }),
  execute: async ({ input, context }) => {
    const { automationId } = parseInput(inputSchema, input);
    const actor = await getActor(context);
    assertCan(actor, 'settings.manage');

    const automation = await zite.automations.findOne({ id: automationId });
    if (!automation) throw new ZiteError('That automation no longer exists', 'NOT_FOUND');

    const { rows } = await zite.sql({ query: `SELECT id FROM "AutomationRuns" WHERE "automationId" = $1`, params: [automationId] });
    // Sequential on purpose: live Zite rate-limits bursts of parallel writes.
    for (const row of rows) await withRetry(() => zite.automationRuns.delete({ id: String(row.id) }));
    await withRetry(() => zite.automations.delete({ id: automationId }));
    await logEvent({ kind: 'automation.deleted', entity: { type: 'settings', id: automationId }, actorId: actor.id, summary: `deleted the automation “${automation.name ?? ''}”` });

    return { deleted: true, runsRemoved: rows.length, name: automation.name ?? '' };
  },
});
