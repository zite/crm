import { zite } from 'zitejs/db';
import { includes, ROLES, type Role } from '../constants';
import { isValidTimezone } from '../dates';
import { json, num, str } from './sql';

/**
 * The organization's settings: one row in Settings, created on first read.
 * JSON columns are parsed into typed objects with defaults, so callers never
 * handle a missing key.
 */

export type LeadRouting = {
  /** round_robin: rotate through memberIds; member: always memberId; unassigned: leave for triage. */
  mode: 'round_robin' | 'member' | 'unassigned';
  memberIds: string[];
  memberId: string | null;
  cursor: number;
};

export type QuoteDefaults = {
  prefix: string;
  terms: string;
  taxRate: number;
  expiryDays: number;
  buyerNote: string;
};

export type OrgPreferences = {
  /** Show "Stalled" on deals past their stage's day limit. */
  stalledEnabled: boolean;
  /** Marking a deal lost asks for a reason from the Lost Reason list. */
  requireLostReason: boolean;
  /** Email each member a morning digest of tasks and meetings. */
  dailyDigest: boolean;
  /** Days before a lead with no activity counts as neglected on Home and in reports. */
  leadResponseHours: number;
};

export type OrgSettings = {
  id: string;
  organizationName: string;
  currency: string;
  timezone: string;
  fiscalYearStartMonth: number;
  logoUrl: string | null;
  brandColor: string;
  defaultRole: Role;
  leadRouting: LeadRouting;
  quoteDefaults: QuoteDefaults;
  nextQuoteNumber: number;
  emailFooter: string;
  mailingAddress: string;
  pagesUrl: string | null;
  preferences: OrgPreferences;
  seededAt: string | null;
  demoRemovedAt: string | null;
};

export const DEFAULT_BRAND = '#1d4e80';

export const DEFAULT_QUOTE_DEFAULTS: QuoteDefaults = {
  prefix: 'Q-',
  terms:
    'Prices are in the currency shown and exclude any taxes not listed. Subscription terms begin on the start date agreed at signature and renew for the same term unless either party gives 30 days’ written notice. Invoices are due within 30 days.',
  taxRate: 0,
  expiryDays: 30,
  buyerNote: '',
};

const DEFAULT_PREFERENCES: OrgPreferences = { stalledEnabled: true, requireLostReason: true, dailyDigest: false, leadResponseHours: 24 };

function toSettings(r: Record<string, unknown>): OrgSettings {
  const routing = json<Partial<LeadRouting>>(r.leadRouting, {});
  const quotes = json<Partial<QuoteDefaults>>(r.quoteDefaults, {});
  const prefs = json<Partial<OrgPreferences>>(r.preferences, {});
  const tz = str(r.timezone);
  return {
    id: String(r.id),
    organizationName: str(r.organizationName) || 'Your organization',
    currency: str(r.currency) || 'USD',
    timezone: tz && isValidTimezone(tz) ? tz : 'America/New_York',
    fiscalYearStartMonth: Math.min(12, Math.max(1, num(r.fiscalYearStartMonth, 1))),
    logoUrl: str(r.logoUrl) || null,
    brandColor: /^#[0-9a-f]{6}$/i.test(String(r.brandColor ?? '')) ? String(r.brandColor) : DEFAULT_BRAND,
    defaultRole: includes(ROLES, r.defaultRole) ? (r.defaultRole as Role) : 'Rep',
    leadRouting: {
      mode: routing.mode === 'member' || routing.mode === 'unassigned' ? routing.mode : 'round_robin',
      memberIds: Array.isArray(routing.memberIds) ? routing.memberIds.map(String) : [],
      memberId: routing.memberId ? String(routing.memberId) : null,
      cursor: Number(routing.cursor) || 0,
    },
    quoteDefaults: { ...DEFAULT_QUOTE_DEFAULTS, ...quotes, taxRate: Number(quotes.taxRate ?? 0) || 0, expiryDays: Number(quotes.expiryDays ?? 30) || 30 },
    nextQuoteNumber: num(r.nextQuoteNumber, 1001),
    emailFooter: str(r.emailFooter) ?? '',
    mailingAddress: str(r.mailingAddress) ?? '',
    pagesUrl: str(r.pagesUrl) || null,
    preferences: { ...DEFAULT_PREFERENCES, ...prefs },
    seededAt: str(r.seededAt) || null,
    demoRemovedAt: str(r.demoRemovedAt) || null,
  };
}

export async function getSettings(): Promise<OrgSettings> {
  const { rows } = await zite.sql({ query: `SELECT * FROM "Settings" ORDER BY created_at ASC LIMIT 1`, params: [] });
  if (rows[0]) return toSettings(rows[0]);
  const created = await zite.settings.create({
    record: {
      organizationName: 'Your organization',
      currency: 'USD',
      timezone: 'America/New_York',
      fiscalYearStartMonth: 1,
      defaultRole: 'Rep',
      nextQuoteNumber: 1001,
      leadRouting: JSON.stringify({ mode: 'round_robin', memberIds: [], memberId: null, cursor: 0 }),
      quoteDefaults: JSON.stringify(DEFAULT_QUOTE_DEFAULTS),
      preferences: JSON.stringify(DEFAULT_PREFERENCES),
    },
  });
  return toSettings(created as unknown as Record<string, unknown>);
}

export async function updateSettings(id: string, patch: Partial<Omit<OrgSettings, 'id'>>) {
  const record: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    record[k] = k === 'leadRouting' || k === 'quoteDefaults' || k === 'preferences' ? JSON.stringify(v) : v;
  }
  if (Object.keys(record).length) await zite.settings.update({ id, record: record as never });
}

/** A link into the CRM app (hash route), for emails and notifications. */
export function appLink(path: string) {
  const base = (process.env.ZITE_APP_URL ?? '').replace(/\/+$/, '');
  const clean = path.startsWith('/') ? path : `/${path}`;
  return base ? `${base}/#${clean}` : '';
}

/** A link into CRM Pages. The public app records its own URL into Settings on first visit. */
export function pagesLink(settings: Pick<OrgSettings, 'pagesUrl'>, path: string) {
  const base = (settings.pagesUrl ?? '').replace(/\/+$/, '');
  if (!base) return '';
  const clean = path.startsWith('/') ? path : `/${path}`;
  return `${base}/#${clean}`;
}
