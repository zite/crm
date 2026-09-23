import { z } from 'zod';
import { createEndpoint } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { getActor } from '@project/shared/server/actor';
import { iso, num, ref, str } from '@project/shared/server/sql';
import { parseInput } from '../server/input';

const inputSchema = z.object({ filter: z.enum(['all', 'unread']).optional(), limit: z.number().int().min(1).max(200).optional() });

export default createEndpoint({
  description: 'The signed-in teammate’s inbox',
  authenticated: true,
  inputSchema,
  outputSchema: z.object({
    notifications: z.array(z.object({ id: z.string(), kind: z.string(), title: z.string(), body: z.string().nullable(), link: z.string().nullable(), entityType: z.string().nullable(), entityId: z.string().nullable(), actorId: z.string().nullable(), readAt: z.string().nullable(), occurredAt: z.string() })),
    unread: z.number(),
  }),
  execute: async ({ input, context }) => {
    const { filter = 'all', limit = 60 } = parseInput(inputSchema, input);
    const actor = await getActor(context);
    const [{ rows }, counts] = await Promise.all([
      zite.sql({
        query: `SELECT * FROM "Notifications" WHERE "recipientId" = $1 ${filter === 'unread' ? 'AND "readAt" IS NULL' : ''} ORDER BY COALESCE("occurredAt", created_at) DESC LIMIT ${limit}`,
        params: [actor.id],
      }),
      zite.sql({ query: `SELECT COUNT(*) AS "unreadTotal" FROM "Notifications" WHERE "recipientId" = $1 AND "readAt" IS NULL`, params: [actor.id] }),
    ]);
    return {
      notifications: rows.map(r => ({
        id: String(r.id),
        kind: str(r.kind) ?? 'system',
        title: str(r.title) ?? '',
        body: str(r.body) || null,
        link: str(r.link) || null,
        entityType: str(r.entityType) || null,
        entityId: ref(r.entityId),
        actorId: ref(r.actorId),
        readAt: iso(r.readAt),
        occurredAt: iso(r.occurredAt) ?? iso(r.created_at) ?? '',
      })),
      unread: num(counts.rows[0]?.unreadTotal),
    };
  },
});
