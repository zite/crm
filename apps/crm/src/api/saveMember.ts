import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { assertCan, colorFor, getActor, nameFromEmail } from '@project/shared/server/actor';
import { logEvent } from '@project/shared/server/events';
import { notify } from '@project/shared/server/notify';
import { withRetry } from '@project/shared/server/sql';
import { EMAIL_RE } from '@project/shared/format';
import { ROLES } from '@project/shared/constants';
import { id, parseInput } from '../server/input';

/**
 * Invite a teammate, or change one.
 *
 * An invite is just a Members row with the status Invited: the person becomes
 * Active the first time they sign in with that address (see `getActor`). There
 * is no separate invitation table to get out of step with reality.
 *
 * The last active admin can't be demoted — a workspace nobody can administer
 * is a workspace nobody can fix.
 */

const inputSchema = z.object({
  memberId: id.optional(),
  email: z.string().trim().toLowerCase().max(200).optional(),
  name: z.string().trim().max(120).optional(),
  title: z.string().trim().max(120).optional(),
  role: z.enum(ROLES).optional(),
  teamId: id.nullable().optional(),
});

export default createEndpoint({
  description: 'Invite a teammate by email, or change an existing teammate’s name, title, role or team',
  authenticated: true,
  inputSchema,
  outputSchema: z.object({ memberId: z.string(), invited: z.boolean(), name: z.string() }),
  execute: async ({ input, context }) => {
    const parsed = parseInput(inputSchema, input);
    const actor = await getActor(context);
    assertCan(actor, 'members.manage');

    if (parsed.teamId) {
      const team = await zite.teams.findOne({ id: parsed.teamId });
      if (!team) throw new ZiteError('That team no longer exists', 'BAD_REQUEST');
    }

    /* ---- inviting ---- */
    if (!parsed.memberId) {
      const email = parsed.email ?? '';
      if (!EMAIL_RE.test(email)) throw new ZiteError('Enter the email address they sign in with', 'BAD_REQUEST');
      const { rows } = await zite.sql({ query: `SELECT id, "name", "status" FROM "Members" WHERE LOWER("email") = $1 LIMIT 1`, params: [email] });
      if (rows[0]) {
        const existing = rows[0];
        if (existing.status === 'Deactivated') throw new ZiteError(`${existing.name || email} is on the team but deactivated — reactivate them instead`, 'CONFLICT');
        throw new ZiteError(`${existing.name || email} is already on the team`, 'CONFLICT');
      }
      const name = parsed.name || nameFromEmail(email);
      const created = await withRetry(() =>
        zite.members.create({
          record: { name, email, role: parsed.role ?? 'Rep', status: 'Invited', title: parsed.title ?? null, teamId: parsed.teamId ?? null, color: colorFor(email) },
        }),
      );
      await logEvent({ kind: 'member.invited', entity: { type: 'member', id: created.id }, actorId: actor.id, summary: `invited ${name} as a ${parsed.role ?? 'Rep'}` });
      return { memberId: created.id, invited: true, name };
    }

    /* ---- editing ---- */
    const member = await zite.members.findOne({ id: parsed.memberId });
    if (!member) throw new ZiteError('That teammate no longer exists', 'NOT_FOUND');
    const name = parsed.name ?? member.name ?? '';

    if (parsed.role && parsed.role !== member.role && member.role === 'Admin') {
      const { rows } = await zite.sql({ query: `SELECT COUNT(*) AS "n" FROM "Members" WHERE "role" = 'Admin' AND "status" <> 'Deactivated'`, params: [] });
      if (Number(rows[0]?.n ?? 0) <= 1) throw new ZiteError('This is the only admin. Make someone else an admin first.', 'CONFLICT');
    }

    const record: Record<string, unknown> = {};
    if (parsed.name !== undefined) record.name = parsed.name;
    if (parsed.title !== undefined) record.title = parsed.title;
    if (parsed.role !== undefined) record.role = parsed.role;
    if (parsed.teamId !== undefined) record.teamId = parsed.teamId;
    if (!Object.keys(record).length) throw new ZiteError('Nothing to change', 'BAD_REQUEST');

    await withRetry(() => zite.members.update({ id: parsed.memberId as string, record: record as never }));

    if (parsed.role && parsed.role !== member.role) {
      await logEvent({ kind: 'member.role_changed', entity: { type: 'member', id: parsed.memberId }, actorId: actor.id, summary: `made ${name} a ${parsed.role}` });
      await notify({
        recipientIds: [parsed.memberId],
        kind: 'system',
        title: `${actor.name} changed your role to ${parsed.role}`,
        body: 'What you can see and change has changed with it.',
        link: '/settings/profile',
        actorId: actor.id,
      });
    }
    return { memberId: parsed.memberId, invited: false, name };
  },
});
