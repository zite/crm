import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { assertCan, getActor } from '@project/shared/server/actor';
import { logEvent } from '@project/shared/server/events';
import { withRetry } from '@project/shared/server/sql';
import { id, parseInput } from '../server/input';

/** Delete a team. Its members stay — they simply stop belonging to a team. */

const inputSchema = z.object({ teamId: id });

export default createEndpoint({
  description: 'Delete a team (its members keep their records and lose only the team label)',
  authenticated: true,
  inputSchema,
  outputSchema: z.object({ deleted: z.boolean(), membersFreed: z.number() }),
  execute: async ({ input, context }) => {
    const { teamId } = parseInput(inputSchema, input);
    const actor = await getActor(context);
    assertCan(actor, 'members.manage');

    const team = await zite.teams.findOne({ id: teamId });
    if (!team) throw new ZiteError('That team no longer exists', 'NOT_FOUND');

    const { rows } = await zite.sql({ query: `SELECT id FROM "Members" WHERE "teamId" = $1`, params: [teamId] });
    // Sequential on purpose: live Zite rate-limits bursts of parallel writes.
    for (const row of rows) await withRetry(() => zite.members.update({ id: String(row.id), record: { teamId: null } }));
    await withRetry(() => zite.teams.delete({ id: teamId }));
    await logEvent({ kind: 'team.deleted', entity: { type: 'settings', id: teamId }, actorId: actor.id, summary: `deleted the ${team.name ?? ''} team`.replace('  ', ' ') });

    return { deleted: true, membersFreed: rows.length };
  },
});
