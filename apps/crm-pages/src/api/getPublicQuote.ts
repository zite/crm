import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { isDemo } from '@project/shared/server/demoPreview';
import { logEvent } from '@project/shared/server/events';
import { notify } from '@project/shared/server/notify';
import { getSettings } from '@project/shared/server/settings';
import { day, iso, json, num, str, withRetry } from '@project/shared/server/sql';
import { billingLabel, lineTotal, quoteTotals, type LineInput } from '@project/shared/quotes';
import { BILLING, includes, type Billing } from '@project/shared/constants';
import { todayIn } from '@project/shared/dates';
import { parseInput } from '../server/input';

/**
 * A quote as the buyer sees it, found only by the unguessable token in their
 * link. Unauthenticated, so it returns the document and nothing else: no deal,
 * no internal amounts, no other quotes, no owner notes.
 *
 * Opening it for the first time is news to the rep — it marks the quote Viewed
 * and tells the owner.
 */
const inputSchema = z.object({ token: z.string().trim().min(16, 'This link isn’t valid').max(64, 'This link isn’t valid').regex(/^[A-Za-z0-9]+$/, 'This link isn’t valid') });

const NOT_FOUND = 'This quote link is no longer valid. Ask for a new one.';

const itemSchema = z.object({
  name: z.string(),
  description: z.string().nullable(),
  quantity: z.number(),
  unitPrice: z.number(),
  discount: z.number(),
  billing: z.string(),
  billingLabel: z.string(),
  total: z.number(),
});

export default createEndpoint({
  description: 'Load a quote for its buyer from the link token',
  inputSchema,
  outputSchema: z.object({
    number: z.string(),
    title: z.string(),
    status: z.enum(['Open', 'Accepted', 'Declined', 'Expired', 'Void']),
    companyName: z.string().nullable(),
    contactName: z.string().nullable(),
    items: z.array(itemSchema),
    subtotal: z.number(),
    discountTotal: z.number(),
    taxRate: z.number(),
    tax: z.number(),
    total: z.number(),
    currency: z.string(),
    expiresOn: z.string().nullable(),
    sentAt: z.string().nullable(),
    terms: z.string(),
    buyerNote: z.string(),
    acceptedName: z.string().nullable(),
    acceptedTitle: z.string().nullable(),
    acceptedAt: z.string().nullable(),
    declinedAt: z.string().nullable(),
    preparedBy: z.object({ name: z.string(), title: z.string().nullable(), email: z.string().nullable() }).nullable(),
  }),
  execute: async ({ input }) => {
    const { token } = parseInput(inputSchema, input);
    const { rows } = await zite.sql({
      query: `SELECT q.id, q."number", q."title", q."status", q."items", q."taxRate", q."currency", q."expiresOn", q."sentAt",
                q."viewedAt", q."viewCount", q."terms", q."buyerNote", q."acceptedName", q."acceptedTitle", q."acceptedAt",
                q."declinedAt", q."ownerId", q."dealId", q."companyId", q."contactId",
                c."name" AS "companyName", ct."name" AS "contactName",
                m."name" AS "ownerName", m."title" AS "ownerTitle", m."email" AS "ownerEmail"
              FROM "Quotes" q
              LEFT JOIN "Companies" c ON c.id::text = q."companyId"
              LEFT JOIN "Contacts" ct ON ct.id::text = q."contactId"
              LEFT JOIN "Members" m ON m.id::text = q."ownerId"
              WHERE q."token" = $1
              LIMIT 1`,
      params: [token],
    });
    const q = rows[0];
    // The same answer for "no such quote" and "not yet shared", so a token can't be probed.
    if (!q || (str(q.status) || 'Draft') === 'Draft') throw new ZiteError(NOT_FOUND, 'NOT_FOUND');

    const settings = await getSettings();
    const today = todayIn(settings.timezone);
    const stored = str(q.status) || 'Draft';
    const expiresOn = day(q.expiresOn);
    const lapsed = Boolean(expiresOn && expiresOn < today);
    const status =
      stored === 'Accepted' ? 'Accepted' : stored === 'Declined' ? 'Declined' : stored === 'Void' ? 'Void' : stored === 'Expired' || lapsed ? 'Expired' : 'Open';

    const raw = json<unknown[]>(q.items, []);
    const items = (Array.isArray(raw) ? raw : []).map(entry => {
      const e = (entry ?? {}) as Record<string, unknown>;
      const billing: Billing = includes(BILLING, e.billing) ? (e.billing as Billing) : 'One-time';
      const line: LineInput = {
        name: String(e.name ?? ''),
        quantity: Number(e.quantity) || 0,
        unitPrice: Number(e.unitPrice) || 0,
        discount: Number(e.discount) || 0,
        billing,
        termMonths: e.termMonths == null ? null : Number(e.termMonths),
      };
      return {
        name: line.name,
        description: e.description ? String(e.description) : null,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        discount: line.discount,
        billing,
        billingLabel: billingLabel(billing, line.termMonths),
        total: lineTotal(line),
        line,
      };
    });
    const taxRate = num(q.taxRate);
    const totals = quoteTotals(items.map(i => i.line), taxRate);

    // First open: the rep should hear about it, and only once.
    if ((stored === 'Sent' || stored === 'Viewed') && !lapsed && !isDemo()) {
      const firstView = stored === 'Sent' && !q.viewedAt;
      const now = new Date().toISOString();
      await withRetry(() =>
        zite.quotes.update({
          id: String(q.id),
          record: { status: 'Viewed', viewedAt: q.viewedAt ? iso(q.viewedAt) : now, viewCount: num(q.viewCount) + 1 } as never,
        }),
      ).catch(() => undefined);
      if (firstView) {
        await logEvent({
          kind: 'quote.viewed',
          entity: { type: 'quote', id: String(q.id) },
          actorId: null,
          summary: `Quote ${str(q.number) ?? ''} was opened by the buyer`.replace(/\s+/g, ' '),
          dealId: str(q.dealId) || null,
          companyId: str(q.companyId) || null,
          contactId: str(q.contactId) || null,
        });
        await notify({
          recipientIds: [str(q.ownerId)],
          kind: 'quote_viewed',
          title: `${str(q.companyName) || 'The buyer'} opened ${str(q.number) ?? 'your quote'}`,
          body: str(q.title) || null,
          link: `/quotes/${String(q.id)}`,
          entityType: 'quote',
          entityId: String(q.id),
        });
      }
    }

    return {
      number: str(q.number) ?? '',
      title: str(q.title) ?? '',
      status: status as 'Open' | 'Accepted' | 'Declined' | 'Expired' | 'Void',
      companyName: str(q.companyName) || null,
      contactName: str(q.contactName) || null,
      items: items.map(({ line: _line, ...rest }) => rest),
      subtotal: totals.subtotal,
      discountTotal: totals.discountTotal,
      taxRate,
      tax: totals.tax,
      total: totals.total,
      currency: str(q.currency) || settings.currency,
      expiresOn,
      sentAt: iso(q.sentAt),
      terms: str(q.terms) ?? '',
      buyerNote: str(q.buyerNote) ?? '',
      acceptedName: str(q.acceptedName) || null,
      acceptedTitle: str(q.acceptedTitle) || null,
      acceptedAt: iso(q.acceptedAt),
      declinedAt: iso(q.declinedAt),
      preparedBy: q.ownerName ? { name: String(q.ownerName), title: str(q.ownerTitle) || null, email: str(q.ownerEmail) || null } : null,
    };
  },
});
