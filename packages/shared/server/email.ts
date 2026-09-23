import { Email } from 'zitejs/email';
import { zite } from 'zitejs/db';
import type { EmailDelivery } from '../constants';
import { EMAIL_RE, longDay } from '../format';
import { firstName, type MergeContext } from '../merge';
import { formatMoney } from '../money';
import { randomToken } from '../tokens';
import type { MemberLite } from './actor';
import { pagesLink, type OrgSettings } from './settings';
import { str, withRetry } from './sql';

/**
 * Outbound email. Sends through the workspace's email integration with the
 * rep as reply-to, so a buyer's reply lands in the rep's own inbox.
 *
 * `sendEmail` never throws: it returns the delivery to record on the Activity.
 * Three rules keep a template safe to install:
 *   - reserved demo domains (example.com, *.example, *.test) are never sent to,
 *     so the seeded contacts can't generate real mail;
 *   - contacts marked Do Not Contact or unsubscribed are skipped for
 *     sequence/marketing sends (`requireConsent`);
 *   - every sequence email carries the org's mailing address and an
 *     unsubscribe link.
 */

const RESERVED = /(^|[.@])(example\.(com|org|net)|[a-z0-9-]+\.example|[a-z0-9-]+\.test|[a-z0-9-]+\.invalid|localhost)$/i;

export function isDeliverable(address: string | null | undefined) {
  const a = (address ?? '').trim();
  return EMAIL_RE.test(a) && !RESERVED.test(a);
}

type Block = { type: 'text'; content: string } | { type: 'button'; label: string; href: string; alignment?: 'left' } | { type: 'divider' } | { type: 'spacer'; height: number };

export function textToBlocks(text: string): Block[] {
  return text
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map(p => p.trim())
    .filter(Boolean)
    .map(p => ({ type: 'text' as const, content: p }));
}

export type SendResult = { delivery: EmailDelivery; reason: string | null };

export async function sendEmail(input: {
  to: string | string[];
  cc?: string[];
  subject: string;
  text: string;
  replyTo?: string | null;
  settings: OrgSettings;
  button?: { label: string; href: string } | null;
  /** Adds the org's mailing address and, when given, an unsubscribe link. */
  footer?: { unsubscribeUrl?: string | null } | null;
  signature?: string | null;
  attachments?: Array<{ filename: string; url: string }>;
}): Promise<SendResult> {
  const to = (Array.isArray(input.to) ? input.to : [input.to]).map(t => t.trim()).filter(Boolean);
  const cc = (input.cc ?? []).map(t => t.trim()).filter(isDeliverable);
  if (!to.length || to.some(t => !EMAIL_RE.test(t))) return { delivery: 'Failed', reason: 'The recipient address isn’t valid' };
  const deliverable = to.filter(isDeliverable);
  if (!deliverable.length) return { delivery: 'Not Sent', reason: 'Demo address — recorded but not delivered' };

  const blocks: Block[] = textToBlocks(input.text);
  if (input.button?.href && /^https:\/\//.test(input.button.href)) blocks.push({ type: 'spacer', height: 4 }, { type: 'button', label: input.button.label, href: input.button.href, alignment: 'left' });
  if (input.signature?.trim()) blocks.push({ type: 'text', content: input.signature.trim() });
  if (input.footer) {
    const lines = [input.settings.emailFooter.trim(), input.settings.organizationName, input.settings.mailingAddress.trim()].filter(Boolean);
    if (input.footer.unsubscribeUrl) lines.push(`Don’t want these emails? Unsubscribe: ${input.footer.unsubscribeUrl}`);
    if (lines.length) blocks.push({ type: 'divider' }, { type: 'text', content: lines.join('\n') });
  }

  try {
    const res = await Email.send({
      to: deliverable,
      ...(cc.length ? { cc } : {}),
      subject: input.subject.slice(0, 200),
      body: blocks as never,
      ...(input.replyTo && EMAIL_RE.test(input.replyTo) ? { replyTo: input.replyTo } : {}),
      ...(input.settings.logoUrl && /^https:\/\//.test(input.settings.logoUrl) ? { logo: { url: input.settings.logoUrl, height: 32 } } : {}),
      ...(input.attachments?.length ? { attachments: input.attachments.filter(a => /^https:\/\//.test(a.url)) } : {}),
    } as never);
    return (res as { success?: boolean })?.success === false ? { delivery: 'Failed', reason: 'The email service rejected the message' } : { delivery: 'Sent', reason: null };
  } catch (e) {
    console.error('Email send failed', e instanceof Error ? e.message : e);
    return { delivery: 'Failed', reason: e instanceof Error ? e.message.slice(0, 200) : 'The email couldn’t be sent' };
  }
}

/** Email a teammate (digests, assignments). Best-effort, no activity recorded. */
export async function emailMember(input: { settings: OrgSettings; to: string; subject: string; text: string; link?: { label: string; href: string } | null }) {
  return sendEmail({ to: input.to, subject: input.subject, text: input.text, settings: input.settings, button: input.link ?? null });
}

/** The contact's unsubscribe link, minting a token the first time. Empty until CRM Pages has been opened once. */
export async function unsubscribeUrl(settings: OrgSettings, contactId: string): Promise<string> {
  const contact = await zite.contacts.findOne({ id: contactId });
  if (!contact) return '';
  let token = contact.unsubscribeToken;
  if (!token) {
    token = randomToken(28);
    await withRetry(() => zite.contacts.update({ id: contactId, record: { unsubscribeToken: token } }));
  }
  return pagesLink(settings, `/u/${token}`);
}

/** Can this contact receive outreach (sequences, bulk sends)? One-to-one replies are the rep's call. */
export function hasConsent(contact: { doNotContact?: boolean | null; unsubscribedAt?: string | null }) {
  return !contact.doNotContact && !contact.unsubscribedAt;
}

/**
 * Merge values for a contact / company / deal and the sending rep. Pass any
 * ids you have; missing records simply leave their fields empty.
 */
export async function mergeContext(input: { settings: OrgSettings; sender?: MemberLite | null; contactId?: string | null; companyId?: string | null; dealId?: string | null; meetingLink?: string | null }): Promise<MergeContext> {
  const ctx: MergeContext = {
    'organization.name': input.settings.organizationName,
    'sender.name': input.sender?.name ?? '',
    'sender.first_name': firstName(input.sender?.name),
    'sender.title': input.sender?.title ?? '',
    'sender.phone': input.sender?.phone ?? '',
    meeting_link: input.meetingLink ?? '',
  };
  let companyId = input.companyId ?? null;
  if (input.dealId) {
    const { rows } = await zite.sql({ query: `SELECT "name", "amount", "closeDate", "companyId", "contactId" FROM "Deals" WHERE id::text = $1`, params: [input.dealId] });
    const d = rows[0];
    if (d) {
      ctx['deal.name'] = str(d.name) ?? '';
      ctx['deal.amount'] = d.amount == null ? '' : formatMoney(Number(d.amount), input.settings.currency, { cents: false });
      ctx['deal.close_date'] = d.closeDate ? longDay(String(d.closeDate)) : '';
      companyId = companyId ?? (str(d.companyId) || null);
    }
  }
  if (input.contactId) {
    const { rows } = await zite.sql({ query: `SELECT "name", "firstName", "lastName", "title", "email", "companyId" FROM "Contacts" WHERE id::text = $1`, params: [input.contactId] });
    const c = rows[0];
    if (c) {
      ctx['contact.name'] = str(c.name) ?? '';
      ctx['contact.first_name'] = str(c.firstName) || firstName(str(c.name));
      ctx['contact.last_name'] = str(c.lastName) ?? '';
      ctx['contact.title'] = str(c.title) ?? '';
      ctx['contact.email'] = str(c.email) ?? '';
      companyId = companyId ?? (str(c.companyId) || null);
    }
  }
  if (companyId) {
    const { rows } = await zite.sql({ query: `SELECT "name", "domain" FROM "Companies" WHERE id::text = $1`, params: [companyId] });
    if (rows[0]) {
      ctx['company.name'] = str(rows[0].name) ?? '';
      ctx['company.domain'] = str(rows[0].domain) ?? '';
    }
  }
  return ctx;
}
