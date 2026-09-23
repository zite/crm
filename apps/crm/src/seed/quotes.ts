import { zite } from 'zitejs/db';
import { logEvent } from '@project/shared/server/events';
import { getSettings, updateSettings } from '@project/shared/server/settings';
import { num, numOrNull, ref, str } from '@project/shared/server/sql';
import { quoteTotals, type LineInput } from '@project/shared/quotes';
import { BILLING, includes, type Billing } from '@project/shared/constants';
import { addDays, pastIso, type Rng } from './rng';
import type { SeedPhase } from './core';

/**
 * Demo data for the quotes area: six quotes across the seeded deals, one in
 * each state a rep actually sees. Every quote is priced from its deal's own
 * line items, so the ledger's totals and the deal amounts agree to the cent.
 *
 * Idempotent and generated from the fixed seed — never Math.random(), so the
 * numbers, tokens and dates are the same on every install.
 */

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

/** Whole days between a timestamp and today, or null when there isn't one. */
function daysAgoOf(iso: string | null, today: string): number | null {
  if (!iso) return null;
  const then = Date.parse(String(iso).slice(0, 10));
  const now = Date.parse(today);
  if (Number.isNaN(then) || Number.isNaN(now)) return null;
  return Math.max(0, Math.round((now - then) / 86_400_000));
}

/** A token that looks minted but is reproducible, so a re-seed doesn't invalidate a link. */
function seededToken(rng: Rng) {
  let out = '';
  for (let i = 0; i < 32; i++) out += ALPHABET[Math.floor(rng() * ALPHABET.length) % ALPHABET.length];
  return out;
}

type Plan = {
  key: 'accepted' | 'viewed' | 'sent' | 'draft' | 'declined' | 'expired';
  status: 'Draft' | 'Sent' | 'Viewed' | 'Accepted' | 'Declined' | 'Expired';
  sentDaysAgo: number | null;
  viewedDaysAgo: number | null;
  viewCount: number;
  answeredDaysAgo: number | null;
  expiresInDays: number;
  /** Quotes are named for what is being bought, not for the deal they hang off. */
  title: string;
  buyerNote: string;
  declineReason?: string;
  acceptedBy?: { title: string };
};

const PLANS: Plan[] = [
  {
    key: 'accepted',
    status: 'Accepted',
    sentDaysAgo: 24,
    viewedDaysAgo: 22,
    viewCount: 5,
    answeredDaysAgo: 18,
    expiresInDays: 6,
    title: 'Operations platform — three sites',
    buyerNote: 'Thanks for the walkthrough with your site leads last week. This covers the three sites we agreed, with implementation across the first two months.',
    acceptedBy: { title: 'Operations Director' },
  },
  {
    key: 'viewed',
    status: 'Viewed',
    sentDaysAgo: 9,
    viewedDaysAgo: 7,
    viewCount: 4,
    answeredDaysAgo: null,
    expiresInDays: 21,
    title: 'Operations platform — year one',
    buyerNote: 'As promised after Tuesday’s call. The site licences scale with you, so you can start with what you have and add depots as they come online.',
  },
  {
    key: 'sent',
    status: 'Sent',
    sentDaysAgo: 3,
    viewedDaysAgo: null,
    viewCount: 0,
    answeredDaysAgo: null,
    expiresInDays: 27,
    title: 'Operations platform and fleet module',
    buyerNote: 'Here is the pricing we talked through. Happy to walk your finance team through it before you decide.',
  },
  {
    key: 'draft',
    status: 'Draft',
    sentDaysAgo: null,
    viewedDaysAgo: null,
    viewCount: 0,
    answeredDaysAgo: null,
    expiresInDays: 30,
    title: 'Pilot, then a two-site rollout',
    buyerNote: '',
  },
  {
    key: 'declined',
    status: 'Declined',
    sentDaysAgo: 34,
    viewedDaysAgo: 32,
    viewCount: 2,
    answeredDaysAgo: 27,
    expiresInDays: -4,
    title: 'Warehouse pilot — revised scope',
    buyerNote: 'The scope we landed on after the pilot review, with the fleet module included.',
    declineReason: 'Budget moved to next financial year — asked us to come back in the spring.',
  },
  {
    key: 'expired',
    status: 'Expired',
    sentDaysAgo: 68,
    viewedDaysAgo: 66,
    viewCount: 3,
    answeredDaysAgo: null,
    expiresInDays: -14,
    title: 'Renewal — twelve months',
    buyerNote: 'Pricing for the two-site start we discussed, valid for thirty days.',
  },
];

export const seedQuotes: SeedPhase = {
  key: 'quotes',
  label: 'quotes',
  run: async ({ today, rng }) => {
    const existing = await zite.quotes.findAll({ limit: 1 });
    if (existing.records.length) return;

    const settings = await getSettings();
    const { rows: deals } = await zite.sql({
      query: `SELECT d.id, d."name", d."amount", d."status", d."companyId", d."contactId", d."ownerId", d."closedAt",
                c."name" AS "companyName", ct."name" AS "contactName"
              FROM "Deals" d
              LEFT JOIN "Companies" c ON c.id::text = d."companyId"
              LEFT JOIN "Contacts" ct ON ct.id::text = d."contactId"
              WHERE EXISTS (SELECT 1 FROM "LineItems" li WHERE li."dealId" = d.id::text)
              ORDER BY d."status", COALESCE(d."amount", 0) DESC, d.id`,
      params: [],
    });
    if (!deals.length) return;

    // One deal per state: the accepted quote sits on a won deal, the declined
    // one on a lost deal, and the rest on open work.
    // The closed deals are taken newest-first, so the accepted and declined
    // quotes are recent work rather than something from last year.
    const byClosed = (a: Record<string, unknown>, b: Record<string, unknown>) => String(b.closedAt ?? '').localeCompare(String(a.closedAt ?? ''));
    const won = deals.filter(d => str(d.status) === 'Won').sort(byClosed);
    const lost = deals.filter(d => str(d.status) === 'Lost').sort(byClosed);
    const open = deals.filter(d => str(d.status) === 'Open');
    const pool = { accepted: won[0] ?? open[0], declined: lost[0] ?? open[4], viewed: open[0], sent: open[1], draft: open[2], expired: open[3] };

    const used = new Set<string>();
    const chosen: Array<{ plan: Plan; deal: Record<string, unknown> }> = [];
    for (const plan of PLANS) {
      const deal = pool[plan.key];
      if (!deal || used.has(String(deal.id))) continue;
      used.add(String(deal.id));
      chosen.push({ plan, deal });
    }
    if (!chosen.length) return;

    const { rows: allItems } = await zite.sql({
      query: `SELECT "dealId", "name", "description", "productId", "quantity", "unitPrice", "discount", "billing", "termMonths", "position"
              FROM "LineItems" ORDER BY "dealId", COALESCE("position", 0), created_at`,
      params: [],
    });
    const itemsByDeal = new Map<string, Record<string, unknown>[]>();
    for (const row of allItems) {
      const key = str(row.dealId) ?? '';
      if (!itemsByDeal.has(key)) itemsByDeal.set(key, []);
      itemsByDeal.get(key)!.push(row);
    }

    const prefix = settings.quoteDefaults.prefix || 'Q-';
    let nextNumber = Math.max(1, Math.round(settings.nextQuoteNumber || 1001));
    const records: Array<Record<string, unknown>> = [];
    const history: Array<{ number: string; plan: Plan; deal: Record<string, unknown>; total: number; acceptedName: string | null; sentAt: string | null; answeredAt: string | null }> = [];

    for (const { plan, deal } of chosen) {
      const dealId = String(deal.id);
      const lines = (itemsByDeal.get(dealId) ?? []).map((row, index) => {
        const billing: Billing = includes(BILLING, str(row.billing)) ? (str(row.billing) as Billing) : 'One-time';
        return {
          id: `qln-${plan.key}-${index}`,
          name: str(row.name) ?? 'Line item',
          description: str(row.description) || null,
          productId: ref(row.productId),
          quantity: num(row.quantity, 1),
          unitPrice: num(row.unitPrice),
          discount: num(row.discount),
          billing,
          termMonths: billing === 'One-time' ? null : numOrNull(row.termMonths) ?? 12,
        };
      });
      if (!lines.length) continue;

      const totals = quoteTotals(lines as LineInput[], 0);
      const number = `${prefix}${nextNumber++}`;
      const contactName = str(deal.contactName);
      // A closed deal was closed by its quote, so the whole story is anchored to
      // the day it closed: sent, then opened, then answered — never out of order.
      const closedDay = plan.answeredDaysAgo != null ? daysAgoOf(str(deal.closedAt), today) : null;
      const shift = closedDay == null ? 0 : closedDay - plan.answeredDaysAgo!;
      const at = (daysAgo: number | null, hour: number) => (daysAgo == null ? null : pastIso(rng, today, Math.max(0, daysAgo + shift), hour));
      const answeredAt = at(plan.answeredDaysAgo, 17);
      const sentAt = at(plan.sentDaysAgo, 16);
      const acceptedName = plan.key === 'accepted' ? contactName : null;

      records.push({
        number,
        title: plan.title,
        dealId,
        companyId: ref(deal.companyId),
        contactId: ref(deal.contactId),
        ownerId: ref(deal.ownerId),
        status: plan.status,
        token: seededToken(rng),
        items: JSON.stringify(lines),
        subtotal: totals.subtotal,
        discountTotal: totals.discountTotal,
        taxRate: 0,
        tax: 0,
        total: totals.total,
        currency: settings.currency,
        // An answered quote expired relative to when it went out, not to today.
        expiresOn: shift && sentAt ? addDays(String(sentAt).slice(0, 10), 30) : addDays(today, plan.expiresInDays),
        terms: settings.quoteDefaults.terms,
        buyerNote: plan.buyerNote,
        sentAt,
        viewedAt: at(plan.viewedDaysAgo, 15),
        viewCount: plan.viewCount,
        acceptedAt: plan.key === 'accepted' ? answeredAt : null,
        acceptedName,
        acceptedTitle: plan.key === 'accepted' ? plan.acceptedBy?.title ?? null : null,
        acceptedEmail: null,
        declinedAt: plan.key === 'declined' ? answeredAt : null,
        declineReason: plan.key === 'declined' ? plan.declineReason ?? null : null,
      });
      history.push({ number, plan, deal, total: totals.total, acceptedName, sentAt, answeredAt });
    }

    if (!records.length) return;
    const created = await zite.quotes.bulkCreate({ records });
    await updateSettings(settings.id, { nextQuoteNumber: nextNumber });
    const idByNumber = new Map((created.records ?? []).map(r => [String(r.number ?? ''), String(r.id)]));

    // The quotes belong on the deals' timelines too, or a rep opening a won
    // deal sees a win with no paperwork behind it.
    for (const entry of history) {
      const quoteId = idByNumber.get(entry.number);
      if (!quoteId) continue;
      const links = { dealId: String(entry.deal.id), companyId: ref(entry.deal.companyId), contactId: ref(entry.deal.contactId) };
      if (entry.sentAt) {
        await logEvent({
          kind: 'quote.sent',
          entity: { type: 'quote', id: quoteId },
          actorId: ref(entry.deal.ownerId),
          summary: `sent quote ${entry.number}`,
          occurredAt: entry.sentAt ?? undefined,
          ...links,
        });
      }
      if (entry.plan.key === 'accepted') {
        await logEvent({
          kind: 'quote.accepted',
          entity: { type: 'quote', id: quoteId },
          actorId: null,
          summary: `${entry.acceptedName ?? 'The buyer'} accepted quote ${entry.number}`,
          occurredAt: entry.answeredAt ?? undefined,
          ...links,
        });
      }
      if (entry.plan.key === 'declined') {
        await logEvent({
          kind: 'quote.declined',
          entity: { type: 'quote', id: quoteId },
          actorId: null,
          summary: `The buyer declined quote ${entry.number} — ${entry.plan.declineReason ?? 'no reason given'}`,
          occurredAt: entry.answeredAt ?? undefined,
          ...links,
        });
      }
    }
  },
};

/** Demo data for the quotes area. Owned by that area — see BRIEF.md. */
export const QUOTES_PHASES: SeedPhase[] = [seedQuotes];
