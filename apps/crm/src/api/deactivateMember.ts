import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { assertCan, getActor } from '@project/shared/server/actor';
import { logEvent } from '@project/shared/server/events';
import { num, withRetry } from '@project/shared/server/sql';
import { id, parseInput } from '../server/input';

/**
 * Turning a teammate's access off, and back on.
 *
 * A teammate is never deleted: their name is on deals, calls, quotes and
 * history, and deleting the row would leave every one of those saying
 * "Someone". Deactivating stops them signing in and takes them out of every
 * picker, while the record of what they did stays true.
 */

const inputSchema = z.object({ memberId: id, active: z.boolean() });

export default createEndpoint({
  description: 'Turn a teammate’s access off or back on (teammates are never deleted)',
  authenticated: true,
  inputSchema,
  outputSchema: z.object({ memberId: z.string(), status: z.string(), openRecords: z.number() }),
  execute: async ({ input, context }) => {
    const { memberId, active } = parseInput(inputSchema, input);
    const actor = await getActor(context);
    assertCan(actor, 'members.manage');

    const member = await zite.members.findOne({ id: memberId });
    if (!member) throw new ZiteError('That teammate no longer exists', 'NOT_FOUND');
    if (!active && memberId === actor.id) throw new ZiteError('You can’t turn off your own access', 'BAD_REQUEST');

    if (!active && member.role === 'Admin') {
      const { rows } = await zite.sql({ query: `SELECT COUNT(*) AS "n" FROM "Members" WHERE "role" = 'Admin' AND "status" <> 'Deactivated'`, params: [] });
      if (num(rows[0]?.n) <= 1) throw new ZiteError('This is the only admin. Make someone else an admin first.', 'CONFLICT');
    }

    const status = active ? 'Active' : 'Deactivated';
    if (member.status === status) return { memberId, status, openRecords: 0 };
    await withRetry(() => zite.members.update({ id: memberId, record: { status } }));

    // What they leave behind, so the admin knows whether to reassign anything.
    const { rows: counts } = await zite.sql({
      query: `SELECT
        (SELECT COUNT(*) FROM "Deals" WHERE "ownerId" = $1 AND "status" = 'Open') AS "deals",
        (SELECT COUNT(*) FROM "Tasks" WHERE "ownerId" = $1 AND "status" = 'Open') AS "tasks",
        (SELECT COUNT(*) FROM "Leads" WHERE "ownerId" = $1 AND "status" IN ('New', 'Working', 'Nurturing')) AS "leads"`,
      params: [memberId],
    });
    const openRecords = num(counts[0]?.deals) + num(counts[0]?.tasks) + num(counts[0]?.leads);

    await logEvent({
      kind: active ? 'member.reactivated' : 'member.deactivated',
      entity: { type: 'member', id: memberId },
      actorId: actor.id,
      summary: active ? `turned ${member.name ?? 'a teammate'}’s access back on` : `turned off ${member.name ?? 'a teammate'}’s access`,
    });
    return { memberId, status, openRecords: active ? 0 : openRecords };
  },
});
