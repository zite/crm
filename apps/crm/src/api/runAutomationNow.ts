import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { assertCan, getActor } from '@project/shared/server/actor';
import { findLastMatch, runAutomationOnce, toAutomationRow } from '@project/shared/server/automationsEngine';
import { id, parseInput } from '../server/input';

/**
 * Try an automation for real on the most recent record it matches.
 *
 * This is not a simulation: the task appears, the email goes, the field
 * changes. That is the point — a rule that only ever ran in a preview is a
 * rule nobody trusts. It works whether or not the rule is switched on, so it
 * can be tried before being let loose.
 */

const inputSchema = z.object({ automationId: id });

export default createEndpoint({
  description: 'Run an automation now against the most recent record that matches its conditions',
  authenticated: true,
  inputSchema,
  outputSchema: z.object({ ran: z.boolean(), status: z.string(), detail: z.string(), entityType: z.string().nullable(), entityId: z.string().nullable() }),
  execute: async ({ input, context }) => {
    const { automationId } = parseInput(inputSchema, input);
    const actor = await getActor(context);
    assertCan(actor, 'settings.manage');

    const { rows } = await zite.sql({ query: `SELECT * FROM "Automations" WHERE id::text = $1 LIMIT 1`, params: [automationId] });
    if (!rows[0]) throw new ZiteError('That automation no longer exists', 'NOT_FOUND');
    const automation = toAutomationRow(rows[0]);
    if (!automation.actions.length) throw new ZiteError('Add an action before running this', 'BAD_REQUEST');

    const payload = await findLastMatch(automation);
    if (!payload) {
      return { ran: false, status: 'Skipped', detail: 'Nothing in the workspace matches these conditions yet', entityType: null, entityId: null };
    }

    const outcome = await runAutomationOnce(automation, { ...payload, actorId: actor.id }, { recordSkips: true });
    return { ran: outcome.status === 'Succeeded', status: outcome.status, detail: outcome.detail, entityType: payload.entityType, entityId: payload.entityId };
  },
});
