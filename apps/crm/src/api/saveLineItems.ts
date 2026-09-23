import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { assertCan, getActor } from '@project/shared/server/actor';
import { syncAmountFromLineItems } from '@project/shared/server/deals';
import { logEvent } from '@project/shared/server/events';
import { getSettings } from '@project/shared/server/settings';
import { num, placeholders, ref, str, withRetry } from '@project/shared/server/sql';
import { quoteTotals } from '@project/shared/quotes';
import { formatMoney } from '@project/shared/money';
import { plural } from '@project/shared/format';
import { id, parseInput } from '../server/input';
import { normalizeItems, quoteItemSchema } from '../server/quotes';

const inputSchema = z.object({
  dealId: id,
  items: z.array(quoteItemSchema).max(200),
});

/**
 * Replace a deal's line items in one write and re-price the deal from them.
 *
 * A deal with line items takes its amount from their total — that is the rule
 * the board, the forecast and every quote rely on. Clearing every line leaves
 * the last amount in place so the rep can go back to typing it by hand.
 */
export default createEndpoint({
  description: 'Save a deal’s line items and re-price the deal from their total',
  authenticated: true,
  inputSchema,
  outputSchema: z.object({ dealId: z.string(), count: z.number(), total: z.number(), amount: z.number().nullable() }),
  execute: async ({ input, context }) => {
    const data = parseInput(inputSchema, input);
    const actor = await getActor(context);
    assertCan(actor, 'records.edit');

    const { rows: dealRows } = await zite.sql({ query: `SELECT id, "name", "amount", "companyId", "contactId" FROM "Deals" WHERE id::text = $1`, params: [data.dealId] });
    const deal = dealRows[0];
    if (!deal) throw new ZiteError('That deal no longer exists', 'NOT_FOUND');

    const items = normalizeItems(data.items);
    if (items.some(i => !i.name)) throw new ZiteError('Every line needs a description', 'BAD_REQUEST');

    // Any product ids must still exist, or the line loses its link silently.
    const productIds = [...new Set(items.map(i => i.productId).filter((p): p is string => Boolean(p)))];
    const live = new Set<string>();
    if (productIds.length) {
      const { rows } = await zite.sql({ query: `SELECT id FROM "Products" WHERE id::text IN ${placeholders(productIds.length)}`, params: productIds });
      for (const r of rows) live.add(String(r.id));
    }

    const { rows: existingRows } = await zite.sql({ query: `SELECT id FROM "LineItems" WHERE "dealId" = $1`, params: [data.dealId] });
    const existing = new Set(existingRows.map(r => String(r.id)));
    const keep = new Set(items.map(i => i.id).filter((v): v is string => Boolean(v) && existing.has(v as string)));

    // Writes stay sequential: a burst of parallel writes is rate-limited live.
    for (const rowId of existing) {
      if (!keep.has(rowId)) await withRetry(() => zite.lineItems.delete({ id: rowId }));
    }
    for (const [index, item] of items.entries()) {
      const record = {
        dealId: data.dealId,
        name: item.name,
        description: item.description,
        productId: item.productId && live.has(item.productId) ? item.productId : null,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        discount: item.discount,
        billing: item.billing,
        termMonths: item.termMonths,
        position: (index + 1) * 10,
      };
      if (item.id && keep.has(item.id)) await withRetry(() => zite.lineItems.update({ id: item.id as string, record: record as never }));
      else await withRetry(() => zite.lineItems.create({ record: record as never }));
    }

    const totals = quoteTotals(items, 0);
    const amount = items.length ? totals.total : num(deal.amount, 0) || null;
    if (items.length) await syncAmountFromLineItems(data.dealId, totals.total);

    const settings = await getSettings();
    await logEvent({
      kind: 'deal.line_items_changed',
      entity: { type: 'deal', id: data.dealId },
      actorId: actor.id,
      summary: items.length
        ? `priced the deal at ${formatMoney(totals.total, settings.currency, { cents: false })} across ${plural(items.length, 'line item')}`
        : 'removed the line items, so the amount is set by hand again',
      companyId: ref(deal.companyId),
      contactId: ref(deal.contactId),
      data: { count: items.length, total: totals.total, deal: str(deal.name) },
    });

    return { dealId: data.dealId, count: items.length, total: totals.total, amount };
  },
});
