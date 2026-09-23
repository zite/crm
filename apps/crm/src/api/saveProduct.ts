import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { assertCan, getActor } from '@project/shared/server/actor';
import { logEvent } from '@project/shared/server/events';
import { str, withRetry } from '@project/shared/server/sql';
import { BILLING } from '@project/shared/constants';
import { round2 } from '@project/shared/money';
import { id, money, parseInput } from '../server/input';

const inputSchema = z.object({
  id: id.optional(),
  name: z.string().trim().min(1, 'Give the product a name').max(160),
  sku: z.string().trim().max(60).optional(),
  description: z.string().trim().max(1000).optional(),
  unitPrice: money,
  billing: z.enum(BILLING),
  category: z.string().trim().max(80).optional(),
  active: z.boolean().optional(),
});

/** Add a product to the price book, or change one. Managers and admins only. */
export default createEndpoint({
  description: 'Create or update a price-book product',
  authenticated: true,
  inputSchema,
  outputSchema: z.object({ id: z.string(), created: z.boolean() }),
  execute: async ({ input, context }) => {
    const data = parseInput(inputSchema, input);
    const actor = await getActor(context);
    assertCan(actor, 'products.manage');

    const sku = (data.sku ?? '').trim();
    if (sku) {
      const { rows } = await zite.sql({ query: `SELECT id, "name" FROM "Products" WHERE LOWER("sku") = $1 LIMIT 1`, params: [sku.toLowerCase()] });
      if (rows[0] && String(rows[0].id) !== data.id) throw new ZiteError(`${str(rows[0].name) ?? 'Another product'} already uses the SKU ${sku}`, 'CONFLICT');
    }

    const record = {
      name: data.name.slice(0, 160),
      sku,
      description: (data.description ?? '').slice(0, 1000),
      unitPrice: round2(data.unitPrice),
      billing: data.billing,
      category: (data.category ?? '').slice(0, 80),
      active: data.active ?? true,
    };

    if (data.id) {
      const existing = await zite.products.findOne({ id: data.id });
      if (!existing) throw new ZiteError('That product no longer exists', 'NOT_FOUND');
      await withRetry(() => zite.products.update({ id: data.id as string, record: record as never }));
      await logEvent({ kind: 'product.updated', entity: { type: 'settings', id: data.id }, actorId: actor.id, summary: `updated the product ${record.name}` });
      return { id: data.id, created: false };
    }

    const created = await withRetry(() => zite.products.create({ record: record as never }));
    await logEvent({ kind: 'product.created', entity: { type: 'settings', id: created.id }, actorId: actor.id, summary: `added ${record.name} to the price book` });
    return { id: created.id, created: true };
  },
});
