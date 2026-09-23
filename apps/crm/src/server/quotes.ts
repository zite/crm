import { z } from 'zod';
import { ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { BILLING, type Billing } from '@project/shared/constants';
import { billingLabel, lineTotal, quoteTotals, type LineInput } from '@project/shared/quotes';
import { formatMoney, round2 } from '@project/shared/money';
import { longDay } from '@project/shared/format';
import { day, iso, num, numOrNull, ref, str, json, Params } from '@project/shared/server/sql';
import { zonedParts } from '@project/shared/dates';
import type { OrgSettings } from '@project/shared/server/settings';
import { updateSettings } from '@project/shared/server/settings';

/**
 * Everything the quote endpoints share: the stored shape of a quote's line
 * items, the one place a quote number is minted, the ledger query, and the
 * HTML the PDF is rendered from.
 *
 * All arithmetic goes through `@project/shared/quotes`, so the deal panel, the
 * editor, the PDF and the buyer's page can never disagree by a cent.
 */

/* ---------------------------------------------------------------- items -- */

/** A line on a quote. Quotes keep their own copy so a sent quote never changes under the buyer. */
export const quoteItemSchema = z.object({
  id: z.string().min(1).max(40).optional(),
  name: z.string().trim().min(1, 'Every line needs a description').max(240),
  description: z.string().max(600).nullable().optional(),
  productId: z.string().min(1).max(64).nullable().optional(),
  quantity: z.number().finite().min(0).max(1_000_000),
  unitPrice: z.number().finite().min(0).max(100_000_000),
  discount: z.number().finite().min(0).max(100),
  billing: z.enum(BILLING),
  termMonths: z.number().int().min(1).max(600).nullable(),
});

export type QuoteItem = z.infer<typeof quoteItemSchema>;

export const quoteItemRowSchema = quoteItemSchema.extend({
  id: z.string(),
  description: z.string().nullable(),
  productId: z.string().nullable(),
  /** Contract value of the line, after its discount and over its term. */
  total: z.number(),
  billingLabel: z.string(),
});

let counter = 0;
const lineId = () => `l${Date.now().toString(36)}${(counter++).toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;

/** Round the money, cap the numbers and give every line a stable id. */
export function normalizeItems(items: QuoteItem[]): QuoteItem[] {
  return items.slice(0, 200).map(item => ({
    id: item.id || lineId(),
    name: item.name.trim().slice(0, 240),
    description: item.description?.trim() ? item.description.trim().slice(0, 600) : null,
    productId: item.productId || null,
    quantity: round2(item.quantity),
    unitPrice: round2(item.unitPrice),
    discount: Math.min(100, Math.max(0, round2(item.discount))),
    billing: item.billing,
    termMonths: item.billing === 'One-time' ? null : Math.max(1, Math.round(item.termMonths ?? 12)),
  }));
}

export function itemsFromJson(value: unknown): QuoteItem[] {
  const raw = json<unknown[]>(value, []);
  if (!Array.isArray(raw)) return [];
  const parsed: QuoteItem[] = [];
  for (const entry of raw) {
    const result = quoteItemSchema.safeParse(entry);
    if (result.success) parsed.push(result.data);
  }
  return normalizeItems(parsed);
}

/** The line as the buyer and the PDF see it, with its own total worked out. */
export function toItemRow(item: QuoteItem) {
  return {
    id: item.id ?? lineId(),
    name: item.name,
    description: item.description ?? null,
    productId: item.productId ?? null,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    discount: item.discount,
    billing: item.billing,
    termMonths: item.termMonths,
    total: lineTotal(item as LineInput),
    billingLabel: billingLabel(item.billing, item.termMonths),
  };
}

export const totalsFor = (items: QuoteItem[], taxRate: number) => quoteTotals(items as LineInput[], taxRate);

/* -------------------------------------------------------------- numbering -- */

/**
 * The next quote number, reserved in the same write that hands it out, so two
 * quotes created a second apart can never share one.
 */
export async function reserveQuoteNumber(settings: OrgSettings): Promise<string> {
  const prefix = (settings.quoteDefaults.prefix || 'Q-').slice(0, 12);
  let next = Math.max(1, Math.round(settings.nextQuoteNumber || 1001));
  // A number already in use means another install or an import took it: walk past.
  for (let attempt = 0; attempt < 50; attempt++) {
    const candidate = `${prefix}${next}`;
    const { rows } = await zite.sql({ query: `SELECT 1 FROM "Quotes" WHERE "number" = $1 LIMIT 1`, params: [candidate] });
    if (!rows.length) {
      await updateSettings(settings.id, { nextQuoteNumber: next + 1 });
      return candidate;
    }
    next += 1;
  }
  throw new ZiteError('Couldn’t pick a quote number — check Settings → Quotes', 'CONFLICT');
}

/* ------------------------------------------------------------- the ledger -- */

export const QUOTE_SORT_KEYS = ['number', 'title', 'company', 'status', 'total', 'sentAt', 'expiresOn', 'owner', 'createdAt'] as const;
export type QuoteSortKey = (typeof QUOTE_SORT_KEYS)[number];

export const quoteFilterSchema = z.object({
  ids: z.array(z.string().min(1).max(64)).max(500).optional(),
  status: z.array(z.enum(['Draft', 'Sent', 'Viewed', 'Accepted', 'Declined', 'Expired', 'Void'])).optional(),
  /** Member ids; 'none' matches an unowned quote. */
  ownerIds: z.array(z.string()).optional(),
  companyId: z.string().min(1).max(64).optional(),
  dealId: z.string().min(1).max(64).optional(),
  contactId: z.string().min(1).max(64).optional(),
  /** Open quotes expiring within this many days. */
  expiringDays: z.number().int().min(0).max(365).optional(),
  search: z.string().max(120).optional(),
});
export type QuoteFilters = z.infer<typeof quoteFilterSchema>;

export const quoteRowSchema = z.object({
  id: z.string(),
  number: z.string(),
  title: z.string(),
  status: z.string(),
  /** What is stored; `status` is what it means today (a lapsed quote reads Expired). */
  storedStatus: z.string(),
  dealId: z.string().nullable(),
  dealName: z.string().nullable(),
  companyId: z.string().nullable(),
  companyName: z.string().nullable(),
  contactId: z.string().nullable(),
  contactName: z.string().nullable(),
  contactEmail: z.string().nullable(),
  ownerId: z.string().nullable(),
  subtotal: z.number(),
  discountTotal: z.number(),
  taxRate: z.number(),
  tax: z.number(),
  total: z.number(),
  currency: z.string(),
  itemCount: z.number(),
  expiresOn: z.string().nullable(),
  sentAt: z.string().nullable(),
  viewedAt: z.string().nullable(),
  viewCount: z.number(),
  acceptedAt: z.string().nullable(),
  acceptedName: z.string().nullable(),
  declinedAt: z.string().nullable(),
  declineReason: z.string().nullable(),
  createdAt: z.string().nullable(),
});
export type QuoteRow = z.infer<typeof quoteRowSchema>;

/** A quote whose expiry has passed reads as Expired without anyone rewriting the row. */
const STATUS_EXPR = `CASE WHEN q."status" IN ('Sent', 'Viewed') AND q."expiresOn" IS NOT NULL AND q."expiresOn" < $1::date THEN 'Expired' ELSE q."status" END`;

const SORT_SQL: Record<QuoteSortKey, string> = {
  number: `q."number"`,
  title: `LOWER(q."title")`,
  company: `LOWER(COALESCE(c."name", ''))`,
  status: `q."status"`,
  total: `COALESCE(q."total", 0)`,
  sentAt: `q."sentAt"`,
  expiresOn: `q."expiresOn"`,
  owner: `LOWER(COALESCE(m."name", ''))`,
  createdAt: `q.created_at`,
};

export async function queryQuotes(filters: QuoteFilters, sort: { key: QuoteSortKey; dir: 'asc' | 'desc' } | undefined, limit: number, today: string) {
  const params = new Params();
  // $1 is always today, because the status expression is used in SELECT and WHERE.
  params.add(today);
  const where: string[] = [];

  if (filters.ids?.length) where.push(`q.id::text IN ${params.list(filters.ids)}`);
  if (filters.status?.length) where.push(`(${STATUS_EXPR}) IN ${params.list(filters.status)}`);
  if (filters.companyId) where.push(`q."companyId" = ${params.add(filters.companyId)}`);
  if (filters.dealId) where.push(`q."dealId" = ${params.add(filters.dealId)}`);
  if (filters.contactId) where.push(`q."contactId" = ${params.add(filters.contactId)}`);
  if (filters.ownerIds?.length) {
    const ids = filters.ownerIds.filter(o => o !== 'none');
    const parts: string[] = [];
    if (ids.length) parts.push(`q."ownerId" IN ${params.list(ids)}`);
    if (filters.ownerIds.includes('none')) parts.push(`COALESCE(q."ownerId", '') = ''`);
    if (parts.length) where.push(`(${parts.join(' OR ')})`);
  }
  if (filters.expiringDays != null) {
    where.push(`q."status" IN ('Sent', 'Viewed') AND q."expiresOn" IS NOT NULL AND q."expiresOn" >= $1::date AND q."expiresOn" <= ($1::date + ${params.add(filters.expiringDays)}::int)`);
  }
  if (filters.search?.trim()) {
    const term = `%${filters.search.trim().toLowerCase()}%`;
    const p = params.add(term);
    where.push(`(LOWER(q."number") LIKE ${p} OR LOWER(q."title") LIKE ${p} OR LOWER(COALESCE(c."name", '')) LIKE ${p} OR LOWER(COALESCE(d."name", '')) LIKE ${p})`);
  }

  const order = sort ? `${SORT_SQL[sort.key]} ${sort.dir === 'asc' ? 'ASC' : 'DESC'} NULLS LAST, q.created_at DESC` : `q.created_at DESC`;
  const { rows, truncated } = await zite.sql({
    query: `SELECT q.id, q."number", q."title", q."status", q."dealId", q."companyId", q."contactId", q."ownerId",
              q."subtotal", q."discountTotal", q."taxRate", q."tax", q."total", q."currency", q."items",
              q."expiresOn", q."sentAt", q."viewedAt", q."viewCount", q."acceptedAt", q."acceptedName",
              q."declinedAt", q."declineReason", q.created_at,
              ${STATUS_EXPR} AS "liveStatus",
              c."name" AS "companyName", d."name" AS "dealName", ct."name" AS "contactName", ct."email" AS "contactEmail"
            FROM "Quotes" q
            LEFT JOIN "Companies" c ON c.id::text = q."companyId"
            LEFT JOIN "Deals" d ON d.id::text = q."dealId"
            LEFT JOIN "Contacts" ct ON ct.id::text = q."contactId"
            LEFT JOIN "Members" m ON m.id::text = q."ownerId"
            ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
            ORDER BY ${order}
            LIMIT ${Math.min(2000, Math.max(1, limit))}`,
    params: params.values,
  });
  return { quotes: rows.map(toQuoteRow), truncated: Boolean(truncated) };
}

export function toQuoteRow(r: Record<string, unknown>): QuoteRow {
  return {
    id: String(r.id),
    number: str(r.number) ?? '',
    title: str(r.title) ?? '',
    status: str(r.liveStatus) || str(r.status) || 'Draft',
    storedStatus: str(r.status) || 'Draft',
    dealId: ref(r.dealId),
    dealName: str(r.dealName) || null,
    companyId: ref(r.companyId),
    companyName: str(r.companyName) || null,
    contactId: ref(r.contactId),
    contactName: str(r.contactName) || null,
    contactEmail: str(r.contactEmail) || null,
    ownerId: ref(r.ownerId),
    subtotal: num(r.subtotal),
    discountTotal: num(r.discountTotal),
    taxRate: num(r.taxRate),
    tax: num(r.tax),
    total: num(r.total),
    currency: str(r.currency) || 'USD',
    itemCount: itemsFromJson(r.items).length,
    expiresOn: day(r.expiresOn),
    sentAt: iso(r.sentAt),
    viewedAt: iso(r.viewedAt),
    viewCount: num(r.viewCount),
    acceptedAt: iso(r.acceptedAt),
    acceptedName: str(r.acceptedName) || null,
    declinedAt: iso(r.declinedAt),
    declineReason: str(r.declineReason) || null,
    createdAt: iso(r.created_at),
  };
}

/** One quote by id, with its stored row, or a readable NOT_FOUND. */
export async function loadQuote(id: string, today: string) {
  const { quotes } = await queryQuotes({ ids: [id] }, undefined, 1, today);
  const row = quotes[0];
  if (!row) throw new ZiteError('That quote doesn’t exist or was deleted', 'NOT_FOUND');
  const record = await zite.quotes.findOne({ id });
  if (!record) throw new ZiteError('That quote doesn’t exist or was deleted', 'NOT_FOUND');
  return { row, record, items: itemsFromJson(record.items) };
}

/** Statuses a quote can still be edited in. */
export const isEditable = (status: string) => status === 'Draft';

export const QUOTE_LOCKED_MESSAGE = 'This quote has already been sent, so it can’t be edited. Duplicate it to make changes.';

/* --------------------------------------------------------------- the PDF -- */

const escapeHtml = (s: string) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const paragraphs = (text: string) =>
  String(text ?? '')
    .split(/\n{2,}/)
    .map(p => p.trim())
    .filter(Boolean)
    .map(p => `<p>${escapeHtml(p).replace(/\n/g, '<br />')}</p>`)
    .join('');

/**
 * The quote as a printed document: the org's name and logo, the number, who it
 * is for, every line, the totals, the terms and where it stands.
 */
export function renderQuoteHtml(input: {
  quote: QuoteRow;
  items: QuoteItem[];
  settings: OrgSettings;
  terms: string;
  buyerNote: string;
  ownerName: string | null;
  ownerEmail: string | null;
}) {
  const { quote, settings } = input;
  const currency = quote.currency || settings.currency;
  const rows = input.items.map(toItemRow);
  const totals = totalsFor(input.items, quote.taxRate);
  const cash = (n: number) => escapeHtml(formatMoney(n, currency));
  // A timestamp's calendar day in the organization's timezone, not UTC.
  const onDay = (value: string | null | undefined) => (value ? zonedParts(value, settings.timezone).day : '');
  const accepted = quote.acceptedAt
    ? `<div class="stamp accepted"><strong>Accepted</strong> by ${escapeHtml(quote.acceptedName ?? 'the buyer')} on ${escapeHtml(longDay(onDay(quote.acceptedAt)))}</div>`
    : quote.declinedAt
      ? `<div class="stamp declined"><strong>Declined</strong> on ${escapeHtml(longDay(onDay(quote.declinedAt)))}${quote.declineReason ? ` — ${escapeHtml(quote.declineReason)}` : ''}</div>`
      : quote.status === 'Void'
        ? `<div class="stamp declined"><strong>Void</strong> — this quote has been withdrawn</div>`
        : quote.status === 'Expired'
          ? `<div class="stamp declined"><strong>Expired</strong> on ${escapeHtml(longDay(quote.expiresOn ?? ''))}</div>`
          : `<div class="stamp open">Awaiting a decision${quote.expiresOn ? ` — valid until ${escapeHtml(longDay(quote.expiresOn))}` : ''}</div>`;

  return `<!doctype html><html><head><meta charset="utf-8" /><title>${escapeHtml(quote.number)}</title>
<style>
  @page { size: A4; margin: 18mm 16mm; }
  * { box-sizing: border-box; }
  body { font-family: "Helvetica Neue", Helvetica, Arial, sans-serif; color: #1d1b18; font-size: 11pt; line-height: 1.5; margin: 0; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; border-bottom: 1px solid #d4cdc1; padding-bottom: 14px; }
  .org { font-size: 15pt; font-weight: 700; }
  .addr { color: #544f48; font-size: 9.5pt; white-space: pre-line; margin-top: 4px; }
  .num { font-family: "SFMono-Regular", Menlo, monospace; font-size: 13pt; letter-spacing: 0.04em; }
  .meta { text-align: right; color: #544f48; font-size: 9.5pt; }
  h1 { font-size: 17pt; margin: 22px 0 2px; font-weight: 600; }
  .for { color: #544f48; margin-bottom: 18px; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  th { text-align: left; font-size: 8.5pt; text-transform: uppercase; letter-spacing: 0.06em; color: #6b655c; border-bottom: 1px solid #d4cdc1; padding: 0 6px 6px; }
  td { padding: 9px 6px; border-bottom: 1px solid #e7e2d9; vertical-align: top; }
  .r { text-align: right; white-space: nowrap; }
  .sub { color: #6b655c; font-size: 9.5pt; }
  .totals { width: 58%; margin-left: auto; margin-top: 14px; }
  .totals td { border: none; padding: 4px 6px; }
  .totals .grand td { border-top: 1.5px solid #1d1b18; font-weight: 700; font-size: 12.5pt; padding-top: 9px; }
  .stamp { margin-top: 22px; padding: 10px 12px; border-radius: 6px; font-size: 10pt; }
  .stamp.accepted { background: #e8f2eb; color: #14603b; }
  .stamp.declined { background: #f6e9e8; color: #8f2f28; }
  .stamp.open { background: #f1eee8; color: #544f48; }
  .terms { margin-top: 26px; border-top: 1px solid #e7e2d9; padding-top: 14px; color: #544f48; font-size: 9.5pt; }
  .terms h2 { font-size: 9pt; text-transform: uppercase; letter-spacing: 0.06em; color: #6b655c; margin: 0 0 6px; }
  .note { margin: 18px 0; padding: 12px 14px; background: #f7f5f0; border-radius: 6px; }
  p { margin: 0 0 8px; }
</style></head><body>
  <div class="head">
    <div>
      ${settings.logoUrl ? `<img src="${escapeHtml(settings.logoUrl)}" alt="" style="height:34px;margin-bottom:6px" />` : ''}
      <div class="org">${escapeHtml(settings.organizationName)}</div>
      ${settings.mailingAddress ? `<div class="addr">${escapeHtml(settings.mailingAddress)}</div>` : ''}
    </div>
    <div class="meta">
      <div class="num">${escapeHtml(quote.number)}</div>
      <div>${quote.sentAt ? `Sent ${escapeHtml(longDay(onDay(quote.sentAt)))}` : 'Draft'}</div>
      ${quote.expiresOn ? `<div>Valid until ${escapeHtml(longDay(quote.expiresOn))}</div>` : ''}
      ${input.ownerName ? `<div>${escapeHtml(input.ownerName)}${input.ownerEmail ? ` · ${escapeHtml(input.ownerEmail)}` : ''}</div>` : ''}
    </div>
  </div>
  <h1>${escapeHtml(quote.title || 'Quote')}</h1>
  <div class="for">Prepared for ${escapeHtml(quote.companyName ?? 'your team')}${quote.contactName ? ` · ${escapeHtml(quote.contactName)}` : ''}</div>
  ${input.buyerNote ? `<div class="note">${paragraphs(input.buyerNote)}</div>` : ''}
  <table>
    <thead><tr><th style="width:46%">Item</th><th class="r">Qty</th><th class="r">Unit price</th><th class="r">Discount</th><th class="r">Amount</th></tr></thead>
    <tbody>
      ${
        rows.length
          ? rows
              .map(
                item => `<tr>
        <td><strong>${escapeHtml(item.name)}</strong>${item.description ? `<div class="sub">${escapeHtml(item.description)}</div>` : ''}<div class="sub">${escapeHtml(item.billingLabel)}</div></td>
        <td class="r">${escapeHtml(String(item.quantity))}</td>
        <td class="r">${cash(item.unitPrice)}</td>
        <td class="r">${item.discount ? `${escapeHtml(String(item.discount))}%` : '—'}</td>
        <td class="r">${cash(item.total)}</td>
      </tr>`,
              )
              .join('')
          : `<tr><td colspan="5" class="sub">No line items.</td></tr>`
      }
    </tbody>
  </table>
  <table class="totals">
    <tr><td>Subtotal</td><td class="r">${cash(totals.subtotal)}</td></tr>
    ${totals.discountTotal ? `<tr><td>Discount</td><td class="r">−${cash(totals.discountTotal)}</td></tr>` : ''}
    ${quote.taxRate ? `<tr><td>Tax (${escapeHtml(String(quote.taxRate))}%)</td><td class="r">${cash(totals.tax)}</td></tr>` : ''}
    <tr class="grand"><td>Total</td><td class="r">${cash(totals.total)}</td></tr>
  </table>
  ${accepted}
  ${input.terms ? `<div class="terms"><h2>Terms</h2>${paragraphs(input.terms)}</div>` : ''}
</body></html>`;
}

/** The money figures a quote row stores, worked out once from its items. */
export function storedTotals(items: QuoteItem[], taxRate: number) {
  const totals = totalsFor(items, taxRate);
  return { subtotal: totals.subtotal, discountTotal: totals.discountTotal, tax: totals.tax, total: totals.total };
}

export const numOrZero = (v: unknown) => numOrNull(v) ?? 0;
export type { Billing };
