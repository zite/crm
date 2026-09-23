import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { assertCan, assertMember, getActor } from '@project/shared/server/actor';
import { logEvent } from '@project/shared/server/events';
import { getSettings } from '@project/shared/server/settings';
import { ref, str, withRetry } from '@project/shared/server/sql';
import { addDays, todayIn } from '@project/shared/dates';
import { randomToken } from '@project/shared/tokens';
import { day, id, parseInput, today as todayInput } from '../server/input';
import { QUOTE_LOCKED_MESSAGE, normalizeItems, quoteItemSchema, reserveQuoteNumber, storedTotals } from '../server/quotes';

const inputSchema = z.object({
  id: id.optional(),
  title: z.string().trim().max(200).optional(),
  dealId: id.nullable().optional(),
  companyId: id.nullable().optional(),
  contactId: id.nullable().optional(),
  ownerId: id.nullable().optional(),
  items: z.array(quoteItemSchema).max(200).optional(),
  taxRate: z.number().finite().min(0).max(100).optional(),
  expiresOn: day.nullable().optional(),
  terms: z.string().max(8000).optional(),
  buyerNote: z.string().max(4000).optional(),
  today: todayInput,
});

async function assertExists(table: 'Companies' | 'Contacts' | 'Deals', value: string | null | undefined, noun: string) {
  if (!value) return;
  const { rows } = await zite.sql({ query: `SELECT 1 FROM "${table}" WHERE id::text = $1`, params: [value] });
  if (!rows[0]) throw new ZiteError(`That ${noun} no longer exists`, 'BAD_REQUEST');
}

/**
 * Create or update a draft quote. The number comes from Settings and is
 * reserved in the same write that hands it out, so a number is never reused.
 * Once a quote has been sent it is a record of what the buyer was shown, so it
 * can only be duplicated or voided.
 */
export default createEndpoint({
  description: 'Create or update a draft quote and re-total it',
  authenticated: true,
  inputSchema,
  outputSchema: z.object({ id: z.string(), number: z.string(), total: z.number(), created: z.boolean() }),
  execute: async ({ input, context }) => {
    const data = parseInput(inputSchema, input);
    const actor = await getActor(context);
    assertCan(actor, 'quotes.manage');
    const settings = await getSettings();
    const today = data.today ?? todayIn(settings.timezone);

    const existing = data.id ? await zite.quotes.findOne({ id: data.id }) : null;
    if (data.id && !existing) throw new ZiteError('That quote doesn’t exist or was deleted', 'NOT_FOUND');
    if (existing && (existing.status ?? 'Draft') !== 'Draft') throw new ZiteError(QUOTE_LOCKED_MESSAGE, 'CONFLICT');

    await assertExists('Deals', data.dealId, 'deal');
    await assertExists('Companies', data.companyId, 'company');
    await assertExists('Contacts', data.contactId, 'contact');
    if (data.ownerId !== undefined && data.ownerId) await assertMember(data.ownerId);

    // A quote on a deal inherits the deal's company and contact unless told otherwise.
    let companyId = data.companyId === undefined ? ref(existing?.companyId) : data.companyId;
    let contactId = data.contactId === undefined ? ref(existing?.contactId) : data.contactId;
    if (data.dealId) {
      const { rows } = await zite.sql({ query: `SELECT "companyId", "contactId" FROM "Deals" WHERE id::text = $1`, params: [data.dealId] });
      const deal = rows[0];
      if (deal) {
        if (!companyId) companyId = ref(deal.companyId);
        if (!contactId) contactId = ref(deal.contactId);
      }
    }

    const items = normalizeItems(data.items ?? []);
    const taxRate = data.taxRate ?? (existing ? Number(existing.taxRate ?? 0) : settings.quoteDefaults.taxRate);
    const totals = storedTotals(items, taxRate);
    const title = (data.title ?? str(existing?.title) ?? '').trim();

    const record = {
      title: title.slice(0, 200) || 'Quote',
      dealId: data.dealId === undefined ? ref(existing?.dealId) : data.dealId,
      companyId,
      contactId,
      ownerId: data.ownerId === undefined ? ref(existing?.ownerId) ?? actor.id : data.ownerId,
      items: JSON.stringify(items),
      taxRate,
      subtotal: totals.subtotal,
      discountTotal: totals.discountTotal,
      tax: totals.tax,
      total: totals.total,
      expiresOn: data.expiresOn === undefined ? (existing?.expiresOn ? String(existing.expiresOn).slice(0, 10) : addDays(today, settings.quoteDefaults.expiryDays)) : data.expiresOn,
      terms: data.terms === undefined ? (str(existing?.terms) ?? settings.quoteDefaults.terms) : data.terms,
      buyerNote: data.buyerNote === undefined ? (str(existing?.buyerNote) ?? settings.quoteDefaults.buyerNote) : data.buyerNote,
    };

    if (existing) {
      await withRetry(() => zite.quotes.update({ id: existing.id, record: record as never }));
      await logEvent({
        kind: 'quote.updated',
        entity: { type: 'quote', id: existing.id },
        actorId: actor.id,
        summary: `updated quote ${existing.number ?? ''}`.trim(),
        dealId: record.dealId,
        companyId: record.companyId,
        contactId: record.contactId,
      });
      return { id: existing.id, number: str(existing.number) ?? '', total: totals.total, created: false };
    }

    const number = await reserveQuoteNumber(settings);
    const created = await withRetry(() =>
      zite.quotes.create({
        record: {
          ...record,
          number,
          status: 'Draft',
          token: randomToken(32),
          currency: settings.currency,
          viewCount: 0,
        } as never,
      }),
    );
    await logEvent({
      kind: 'quote.created',
      entity: { type: 'quote', id: created.id },
      actorId: actor.id,
      summary: `started quote ${number}`,
      dealId: record.dealId,
      companyId: record.companyId,
      contactId: record.contactId,
    });
    return { id: created.id, number, total: totals.total, created: true };
  },
});
