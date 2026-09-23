import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { assertCan, assertMember, getActor } from '@project/shared/server/actor';
import { logEvent } from '@project/shared/server/events';
import { withRetry } from '@project/shared/server/sql';
import { id, parseInput } from '../server/input';

/** Create or rename a team, set its lead, and choose who is on it. */

const inputSchema = z.object({
  teamId: id.optional(),
  name: z.string().trim().min(1, 'Give the team a name').max(80),
  description: z.string().trim().max(400).optional(),
  leadId: id.nullable().optional(),
  /** When given, replaces the team's roster: every id listed joins, everyone else leaves. */
  memberIds: z.array(id).max(200).optional(),
});

export default createEndpoint({
  description: 'Create or change a team: its name, description, lead and members',
  authenticated: true,
  inputSchema,
  outputSchema: z.object({ teamId: z.string(), created: z.boolean() }),
  execute: async ({ input, context }) => {
    const parsed = parseInput(inputSchema, input);
    const actor = await getActor(context);
    assertCan(actor, 'members.manage');
    if (parsed.leadId) await assertMember(parsed.leadId, 'team lead');

    const record = { name: parsed.name, description: parsed.description ?? null, leadId: parsed.leadId ?? null };
    let teamId = parsed.teamId ?? '';
    let created = false;

    if (teamId) {
      const existing = await zite.teams.findOne({ id: teamId });
      if (!existing) throw new ZiteError('That team no longer exists', 'NOT_FOUND');
      await withRetry(() => zite.teams.update({ id: teamId, record: record as never }));
      await logEvent({ kind: 'team.updated', entity: { type: 'settings', id: teamId }, actorId: actor.id, summary: `changed the ${parsed.name} team` });
    } else {
      const { rows } = await zite.sql({ query: `SELECT id FROM "Teams" WHERE LOWER("name") = LOWER($1) LIMIT 1`, params: [parsed.name] });
      if (rows[0]) throw new ZiteError(`There is already a team called “${parsed.name}”`, 'CONFLICT');
      const team = await withRetry(() => zite.teams.create({ record: { ...record, color: null } }));
      teamId = team.id;
      created = true;
      await logEvent({ kind: 'team.created', entity: { type: 'settings', id: teamId }, actorId: actor.id, summary: `created the ${parsed.name} team` });
    }

    if (parsed.memberIds) {
      const wanted = new Set(parsed.memberIds);
      const { rows } = await zite.sql({ query: `SELECT id, "teamId" FROM "Members"`, params: [] });
      // Sequential on purpose: live Zite rate-limits bursts of parallel writes.
      for (const row of rows) {
        const memberId = String(row.id);
        const on = String(row.teamId ?? '') === teamId;
        if (wanted.has(memberId) && !on) await withRetry(() => zite.members.update({ id: memberId, record: { teamId } }));
        else if (!wanted.has(memberId) && on) await withRetry(() => zite.members.update({ id: memberId, record: { teamId: null } }));
      }
    }

    return { teamId, created };
  },
});
