import { z } from 'zod';
import { createEndpoint } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { getActor } from '@project/shared/server/actor';
import { withRetry } from '@project/shared/server/sql';
import { id, parseInput } from '../server/input';

const inputSchema = z.object({ ids: z.array(id).max(200).optional(), all: z.boolean().optional(), read: z.boolean().optional() });

export default createEndpoint({
  description: 'Mark notifications read or unread',
  authenticated: true,
  inputSchema,
  outputSchema: z.object({ updated: z.number() }),
  execute: async ({ input, context }) => {
    const { ids, all, read = true } = parseInput(inputSchema, input);
    const actor = await getActor(context);
    const readAt = read ? new Date().toISOString() : null;
    let targets: string[] = [];
    if (all) {
      const { rows } = await zite.sql({ query: `SELECT id FROM "Notifications" WHERE "recipientId" = $1 AND "readAt" IS NULL LIMIT 500`, params: [actor.id] });
      targets = rows.map(r => String(r.id));
    } else if (ids?.length) {
      const placeholders = ids.map((_, i) => `$${i + 2}`).join(', ');
      const { rows } = await zite.sql({ query: `SELECT id FROM "Notifications" WHERE "recipientId" = $1 AND id::text IN (${placeholders})`, params: [actor.id, ...ids] });
      targets = rows.map(r => String(r.id));
    }
    for (const notificationId of targets) await withRetry(() => zite.notifications.update({ id: notificationId, record: { readAt } }));
    return { updated: targets.length };
  },
});
