import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { getActor } from '@project/shared/server/actor';
import { json, withRetry } from '@project/shared/server/sql';
import { isValidTimezone } from '@project/shared/dates';
import { parseInput } from '../server/input';

/**
 * Your own profile. Everyone can change theirs; nobody can change anyone
 * else's here (that is Settings → Teammates, which only an admin can open).
 * Notification preferences live in the member's `preferences` JSON so a new
 * one can be added without a schema change.
 */

const inputSchema = z
  .object({
    name: z.string().trim().min(1, 'Your name can’t be empty').max(120),
    title: z.string().trim().max(120),
    phone: z.string().trim().max(60),
    timezone: z.string().min(1).max(64),
    emailSignature: z.string().max(2000),
    preferences: z.object({ dailyDigest: z.boolean().optional(), taskReminders: z.boolean().optional(), mentionEmails: z.boolean().optional() }).partial(),
  })
  .partial();

export default createEndpoint({
  description: 'Change your own name, title, phone, timezone, email signature and notification preferences',
  authenticated: true,
  inputSchema,
  outputSchema: z.object({ saved: z.boolean(), preferences: z.record(z.any()) }),
  execute: async ({ input, context }) => {
    const patch = parseInput(inputSchema, input);
    const actor = await getActor(context);
    if (!Object.keys(patch).length) throw new ZiteError('Nothing to change', 'BAD_REQUEST');
    if (patch.timezone && !isValidTimezone(patch.timezone)) throw new ZiteError('That isn’t a timezone we recognise', 'BAD_REQUEST');

    const me = await zite.members.findOne({ id: actor.id });
    if (!me) throw new ZiteError('We couldn’t find your teammate record', 'NOT_FOUND');
    const current = json<Record<string, unknown>>(me.preferences, {});
    const preferences = patch.preferences ? { ...current, ...patch.preferences } : current;

    const record: Record<string, unknown> = {};
    if (patch.name !== undefined) record.name = patch.name;
    if (patch.title !== undefined) record.title = patch.title;
    if (patch.phone !== undefined) record.phone = patch.phone;
    if (patch.timezone !== undefined) record.timezone = patch.timezone;
    if (patch.emailSignature !== undefined) record.emailSignature = patch.emailSignature;
    if (patch.preferences !== undefined) record.preferences = JSON.stringify(preferences);

    await withRetry(() => zite.members.update({ id: actor.id, record: record as never }));
    return { saved: true, preferences };
  },
});
