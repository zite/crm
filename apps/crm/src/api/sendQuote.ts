import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { assertCan, getActor, memberById } from '@project/shared/server/actor';
import { createActivity } from '@project/shared/server/activities';
import { sendEmail } from '@project/shared/server/email';
import { logEvent } from '@project/shared/server/events';
import { notify } from '@project/shared/server/notify';
import { getSettings, pagesLink } from '@project/shared/server/settings';
import { str, withRetry } from '@project/shared/server/sql';
import { addDays, todayIn } from '@project/shared/dates';
import { EMAIL_RE } from '@project/shared/format';
import { formatMoney } from '@project/shared/money';
import { randomToken } from '@project/shared/tokens';
import { id, parseInput, today as todayInput } from '../server/input';
import { itemsFromJson, storedTotals } from '../server/quotes';

const inputSchema = z.object({
  id,
  to: z.string().trim().max(200),
  cc: z.array(z.string().trim().max(200)).max(5).optional(),
  subject: z.string().trim().min(1, 'Give the email a subject').max(200),
  message: z.string().trim().min(1, 'Write a line for the buyer').max(8000),
  today: todayInput,
});

/**
 * Send a quote to its buyer. Sending freezes the line items into the quote's
 * own snapshot, hands over an unguessable link to the public page, records the
 * email on the deal and the contact, and tells the owner it went out.
 */
export default createEndpoint({
  description: 'Send a quote to the buyer and record it on the timeline',
  authenticated: true,
  inputSchema,
  outputSchema: z.object({
    id: z.string(),
    delivery: z.string(),
    reason: z.string().nullable(),
    publicUrl: z.string(),
    activityId: z.string(),
  }),
  execute: async ({ input, context }) => {
    const data = parseInput(inputSchema, input);
    const actor = await getActor(context);
    assertCan(actor, 'quotes.manage');
    const settings = await getSettings();
    const today = data.today ?? todayIn(settings.timezone);

    const quote = await zite.quotes.findOne({ id: data.id });
    if (!quote) throw new ZiteError('That quote doesn’t exist or was deleted', 'NOT_FOUND');
    const status = quote.status ?? 'Draft';
    if (status === 'Void') throw new ZiteError('This quote was voided. Duplicate it to send a fresh one.', 'CONFLICT');
    if (status !== 'Draft') throw new ZiteError('This quote has already been sent. Duplicate it to send a new version.', 'CONFLICT');

    const items = itemsFromJson(quote.items);
    if (!items.length) throw new ZiteError('Add at least one line before sending this quote', 'BAD_REQUEST');
    if (!EMAIL_RE.test(data.to)) throw new ZiteError('That email address doesn’t look right', 'BAD_REQUEST');

    const token = quote.token || randomToken(32);
    const expiresOn = quote.expiresOn ? String(quote.expiresOn).slice(0, 10) : addDays(today, settings.quoteDefaults.expiryDays);
    const taxRate = Number(quote.taxRate ?? 0) || 0;
    const totals = storedTotals(items, taxRate);
    const publicUrl = pagesLink(settings, `/q/${token}`);
    const sender = await memberById(actor.id);
    const now = new Date().toISOString();

    // The link matters more than the button: put it in the body too, so it
    // survives a plain-text client and a non-https address.
    const body = publicUrl && !data.message.includes(publicUrl) ? `${data.message}\n\n${publicUrl}` : data.message;

    const result = await sendEmail({
      to: data.to,
      cc: data.cc,
      subject: data.subject,
      text: body,
      replyTo: actor.email,
      settings,
      signature: sender?.signature ?? null,
      button: publicUrl ? { label: 'View the quote', href: publicUrl } : null,
    });

    await withRetry(() =>
      zite.quotes.update({
        id: quote.id,
        record: {
          status: 'Sent',
          sentAt: now,
          token,
          expiresOn,
          items: JSON.stringify(items),
          subtotal: totals.subtotal,
          discountTotal: totals.discountTotal,
          tax: totals.tax,
          total: totals.total,
        } as never,
      }),
    );

    const activityId = await createActivity(actor, {
      kind: 'Email',
      subject: data.subject,
      body,
      direction: 'Outbound',
      delivery: result.delivery,
      emailFrom: actor.email,
      emailTo: data.to,
      emailCc: data.cc?.join(', ') || null,
      dealId: quote.dealId || null,
      contactId: quote.contactId || null,
      companyId: quote.companyId || null,
    });

    const money = formatMoney(totals.total, quote.currency || settings.currency, { cents: false });
    const summary = `sent quote ${quote.number ?? ''} (${money}) to ${data.to}`.replace(/\s+/g, ' ');
    // One event, linked to the deal, company and contact: it lands on each of
    // their timelines (getTimeline filters Events by those columns).
    await logEvent({ kind: 'quote.sent', entity: { type: 'quote', id: quote.id }, actorId: actor.id, summary, dealId: quote.dealId || null, companyId: quote.companyId || null, contactId: quote.contactId || null });

    await notify({
      recipientIds: [quote.ownerId || null],
      kind: 'quote_sent',
      title: `${actor.name} sent ${quote.number ?? 'a quote'} to ${data.to}`,
      body: `${str(quote.title) || 'Quote'} · ${money}`,
      link: `/quotes/${quote.id}`,
      entityType: 'quote',
      entityId: quote.id,
      actorId: actor.id,
    });

    return { id: quote.id, delivery: result.delivery, reason: result.reason, publicUrl, activityId };
  },
});
