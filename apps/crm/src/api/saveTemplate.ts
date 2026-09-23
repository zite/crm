import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { assertCan, assertCanManageAsset, assertMember, getActor } from '@project/shared/server/actor';
import { ref, withRetry } from '@project/shared/server/sql';
import { id, parseInput } from '../server/input';

/**
 * Create or change an email template. Reps own theirs; managers and admins may
 * change anyone's. "Shared" is what puts a template in front of the team.
 */
const inputSchema = z.object({
  id: id.optional(),
  name: z.string().trim().min(1, 'Give the template a name').max(120),
  subject: z.string().trim().max(200).default(''),
  body: z.string().max(20_000).default(''),
  category: z.string().trim().max(60).default(''),
  shared: z.boolean().default(false),
  archived: z.boolean().optional(),
  ownerId: id.nullable().optional(),
});

export default createEndpoint({
  description: 'Create or update an email template',
  authenticated: true,
  inputSchema,
  outputSchema: z.object({ id: z.string(), created: z.boolean() }),
  execute: async ({ input, context }) => {
    const data = parseInput(inputSchema, input);
    const actor = await getActor(context);
    assertCan(actor, 'outreach.send');

    const fields = {
      name: data.name,
      subject: data.subject,
      body: data.body,
      category: data.category,
      shared: data.shared,
      ...(data.archived === undefined ? {} : { archived: data.archived }),
    };
    const ownerId = data.ownerId === undefined ? undefined : data.ownerId === null ? null : await assertMember(data.ownerId, 'owner');

    if (data.id) {
      const existing = await zite.emailTemplates.findOne({ id: data.id });
      if (!existing) throw new ZiteError('That template no longer exists', 'NOT_FOUND');
      assertCanManageAsset(actor, ref(existing.ownerId), 'template');
      await withRetry(() => zite.emailTemplates.update({ id: data.id as string, record: { ...fields, ...(ownerId === undefined ? {} : { ownerId }) } }));
      return { id: data.id, created: false };
    }

    const created = await withRetry(() =>
      zite.emailTemplates.create({ record: { ...fields, archived: data.archived ?? false, ownerId: ownerId ?? actor.id, useCount: 0, lastUsedAt: null } }),
    );
    return { id: created.id, created: true };
  },
});
