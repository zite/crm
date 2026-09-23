import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { assertCan, getActor } from '@project/shared/server/actor';
import { logEvent } from '@project/shared/server/events';
import { num, str, withRetry } from '@project/shared/server/sql';
import { id, parseInput } from '../server/input';
import { plural } from '@project/shared/format';

const inputSchema = z.object({ id });

/**
 * Remove a product from the price book. A product already priced on a deal is
 * history, so it is archived instead of deleted — the caller is told which.
 */
export default createEndpoint({
  description: 'Delete a price-book product, or archive it when it is already in use',
  authenticated: true,
  inputSchema,
  outputSchema: z.object({ id: z.string(), deleted: z.boolean(), archived: z.boolean(), usageCount: z.number() }),
  execute: async ({ input, context }) => {
    const data = parseInput(inputSchema, input);
    const actor = await getActor(context);
    assertCan(actor, 'products.manage');

    const product = await zite.products.findOne({ id: data.id });
    if (!product) throw new ZiteError('That product no longer exists', 'NOT_FOUND');
    const name = str(product.name) ?? 'the product';

    const { rows } = await zite.sql({ query: `SELECT COUNT(*) AS "usageTotal" FROM "LineItems" WHERE "productId" = $1`, params: [data.id] });
    const usageCount = num(rows[0]?.usageTotal);

    if (usageCount > 0) {
      if (product.active === false) {
        throw new ZiteError(`${name} is priced on ${plural(usageCount, 'deal')}, so it can’t be deleted. It is already archived.`, 'CONFLICT');
      }
      await withRetry(() => zite.products.update({ id: data.id, record: { active: false } as never }));
      await logEvent({ kind: 'product.archived', entity: { type: 'settings', id: data.id }, actorId: actor.id, summary: `archived ${name}, which is priced on ${plural(usageCount, 'deal')}` });
      return { id: data.id, deleted: false, archived: true, usageCount };
    }

    await withRetry(() => zite.products.delete({ id: data.id }));
    await logEvent({ kind: 'product.deleted', entity: { type: 'settings', id: data.id }, actorId: actor.id, summary: `deleted ${name} from the price book` });
    return { id: data.id, deleted: true, archived: false, usageCount };
  },
});
