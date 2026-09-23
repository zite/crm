import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { assertCan, getActor } from '@project/shared/server/actor';
import { logEvent } from '@project/shared/server/events';
import { getSettings } from '@project/shared/server/settings';
import { str, withRetry } from '@project/shared/server/sql';
import { addDays, todayIn } from '@project/shared/dates';
import { randomToken } from '@project/shared/tokens';
import { id, parseInput, today as todayInput } from '../server/input';
import { itemsFromJson, reserveQuoteNumber, storedTotals } from '../server/quotes';

const inputSchema = z.object({ id, today: todayInput });

/**
 * Copy a quote into a fresh draft: same lines, terms and buyer, a new number,
 * a new expiry and a new link. The version the buyer already has is untouched.
 */
export default createEndpoint({
  description: 'Duplicate a quote into a new draft with its own number and link',
  authenticated: true,
  inputSchema,
  outputSchema: z.object({ id: z.string(), number: z.string() }),
  execute: async ({ input, context }) => {
    const data = parseInput(inputSchema, input);
    const actor = await getActor(context);
    assertCan(actor, 'quotes.manage');
    const settings = await getSettings();
    const today = data.today ?? todayIn(settings.timezone);

    const source = await zite.quotes.findOne({ id: data.id });
    if (!source) throw new ZiteError('That quote doesn’t exist or was deleted', 'NOT_FOUND');

    const items = itemsFromJson(source.items);
    const taxRate = Number(source.taxRate ?? 0) || 0;
    const totals = storedTotals(items, taxRate);
    const number = await reserveQuoteNumber(settings);

    const created = await withRetry(() =>
      zite.quotes.create({
        record: {
          number,
          title: str(source.title) || 'Quote',
          dealId: source.dealId || null,
          companyId: source.companyId || null,
          contactId: source.contactId || null,
          ownerId: source.ownerId || actor.id,
          status: 'Draft',
          token: randomToken(32),
          items: JSON.stringify(items),
          subtotal: totals.subtotal,
          discountTotal: totals.discountTotal,
          taxRate,
          tax: totals.tax,
          total: totals.total,
          currency: str(source.currency) || settings.currency,
          expiresOn: addDays(today, settings.quoteDefaults.expiryDays),
          terms: str(source.terms) ?? settings.quoteDefaults.terms,
          buyerNote: str(source.buyerNote) ?? '',
          viewCount: 0,
        } as never,
      }),
    );

    await logEvent({
      kind: 'quote.duplicated',
      entity: { type: 'quote', id: created.id },
      actorId: actor.id,
      summary: `copied ${str(source.number) ?? 'a quote'} into ${number}`,
      dealId: source.dealId || null,
      companyId: source.companyId || null,
      contactId: source.contactId || null,
    });

    return { id: created.id, number };
  },
});
