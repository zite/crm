import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { assertCan, getActor } from '@project/shared/server/actor';
import { logEvent } from '@project/shared/server/events';
import { withRetry } from '@project/shared/server/sql';
import { TAG_COLORS } from '@project/shared/constants';
import { id, parseInput } from '../server/input';

/**
 * The tag palette. Tags are ids on records, so renaming one is safe: every
 * record that carries it follows automatically.
 */

const inputSchema = z.object({
  tagId: id.optional(),
  name: z.string().trim().min(1, 'Give the tag a name').max(40),
  color: z.enum(TAG_COLORS),
  description: z.string().trim().max(200).optional(),
});

export default createEndpoint({
  description: 'Add or change a tag in the organization’s palette',
  authenticated: true,
  inputSchema,
  outputSchema: z.object({ tagId: z.string(), created: z.boolean() }),
  execute: async ({ input, context }) => {
    const parsed = parseInput(inputSchema, input);
    const actor = await getActor(context);
    assertCan(actor, 'settings.manage');

    const { rows } = await zite.sql({ query: `SELECT id FROM "Tags" WHERE LOWER("name") = LOWER($1) AND ($2::text IS NULL OR id::text <> $2) LIMIT 1`, params: [parsed.name, parsed.tagId ?? null] });
    if (rows[0]) throw new ZiteError(`There is already a tag called “${parsed.name}”`, 'CONFLICT');

    const record = { name: parsed.name, color: parsed.color, description: parsed.description || null };
    if (parsed.tagId) {
      const existing = await zite.tags.findOne({ id: parsed.tagId });
      if (!existing) throw new ZiteError('That tag no longer exists', 'NOT_FOUND');
      await withRetry(() => zite.tags.update({ id: parsed.tagId as string, record }));
      await logEvent({ kind: 'tag.updated', entity: { type: 'settings', id: parsed.tagId }, actorId: actor.id, summary: `changed the ${parsed.name} tag` });
      return { tagId: parsed.tagId, created: false };
    }

    const tag = await withRetry(() => zite.tags.create({ record }));
    await logEvent({ kind: 'tag.created', entity: { type: 'settings', id: tag.id }, actorId: actor.id, summary: `added the ${parsed.name} tag` });
    return { tagId: tag.id, created: true };
  },
});
