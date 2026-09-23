import { z } from 'zod';
import { createEndpoint } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { getActor } from '@project/shared/server/actor';
import { num, numOrNull, ref, str } from '@project/shared/server/sql';
import { billingLabel, lineTotal, quoteTotals } from '@project/shared/quotes';
import { includes, BILLING, type Billing } from '@project/shared/constants';
import { id, parseInput } from '../server/input';

const inputSchema = z.object({ dealId: id });

/** A deal's priced lines, in order, with each line's contract value worked out. */
export default createEndpoint({
  description: 'List the line items priced on a deal, with their totals',
  authenticated: true,
  inputSchema,
  outputSchema: z.object({
    items: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        description: z.string().nullable(),
        productId: z.string().nullable(),
        productName: z.string().nullable(),
        quantity: z.number(),
        unitPrice: z.number(),
        discount: z.number(),
        billing: z.string(),
        billingLabel: z.string(),
        termMonths: z.number().nullable(),
        position: z.number(),
        total: z.number(),
      }),
    ),
    totals: z.object({ subtotal: z.number(), discountTotal: z.number(), tax: z.number(), total: z.number() }),
  }),
  execute: async ({ input, context }) => {
    const { dealId } = parseInput(inputSchema, input);
    await getActor(context);
    const { rows } = await zite.sql({
      query: `SELECT li.id, li."name", li."description", li."productId", li."quantity", li."unitPrice", li."discount",
                li."billing", li."termMonths", li."position", p."name" AS "productName"
              FROM "LineItems" li
              LEFT JOIN "Products" p ON p.id::text = li."productId"
              WHERE li."dealId" = $1
              ORDER BY COALESCE(li."position", 0), li.created_at`,
      params: [dealId],
    });
    const items = rows.map(r => {
      const billing: Billing = includes(BILLING, str(r.billing)) ? (str(r.billing) as Billing) : 'One-time';
      const line = {
        name: str(r.name) ?? '',
        quantity: num(r.quantity, 1),
        unitPrice: num(r.unitPrice),
        discount: num(r.discount),
        billing,
        termMonths: numOrNull(r.termMonths),
      };
      return {
        id: String(r.id),
        ...line,
        description: str(r.description) || null,
        productId: ref(r.productId),
        productName: str(r.productName) || null,
        billingLabel: billingLabel(billing, line.termMonths),
        position: num(r.position),
        total: lineTotal(line),
      };
    });
    return { items, totals: quoteTotals(items, 0) };
  },
});
