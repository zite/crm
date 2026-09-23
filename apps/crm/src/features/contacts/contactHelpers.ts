import type { ListContactsInputType, ListContactsOutputType } from 'zitejs/api';
import type { WorkspaceApi } from '../../lib/workspace';

export type Contact = ListContactsOutputType['contacts'][number];
export type ContactFilters = NonNullable<ListContactsInputType['filters']>;
export type ContactSort = NonNullable<ListContactsInputType['sort']>;

export const CONTACT_GROUP_OPTIONS = [
  { value: 'none', label: 'No grouping' },
  { value: 'owner', label: 'Owner' },
  { value: 'company', label: 'Company' },
  { value: 'source', label: 'Source' },
] as const;

export const CONTACT_SORTS = [
  { value: 'name', label: 'Name' },
  { value: 'company', label: 'Company' },
  { value: 'title', label: 'Job title' },
  { value: 'lastContactedAt', label: 'Last contacted' },
  { value: 'lastActivityAt', label: 'Last activity' },
  { value: 'openValue', label: 'Open pipeline' },
  { value: 'createdAt', label: 'Added' },
] as const;

export const STALE_OPTIONS = [30, 60, 90] as const;

export type ContactTotals = { count: number; withCompany: number; openValue: number; reachable: number; quiet: number };

export function contactTotals(contacts: Contact[], quietBefore: number): ContactTotals {
  return contacts.reduce<ContactTotals>(
    (acc, c) => ({
      count: acc.count + 1,
      withCompany: acc.withCompany + (c.companyId ? 1 : 0),
      openValue: acc.openValue + c.openDealValue,
      reachable: acc.reachable + (c.email && !c.doNotContact && !c.unsubscribedAt ? 1 : 0),
      quiet: acc.quiet + (!c.lastActivityAt || Date.parse(c.lastActivityAt) < quietBefore ? 1 : 0),
    }),
    { count: 0, withCompany: 0, openValue: 0, reachable: 0, quiet: 0 },
  );
}

export function groupContacts(contacts: Contact[], groupBy: string | null, ws: WorkspaceApi) {
  if (!groupBy || groupBy === 'none') return null;
  const keyFor = (c: Contact) => {
    switch (groupBy) {
      case 'owner':
        return { key: c.ownerId ?? 'none', label: c.ownerId ? ws.memberName(c.ownerId) : 'Unassigned', order: c.ownerId ? 0 : 1 };
      case 'company':
        return { key: c.companyId ?? 'none', label: c.companyName ?? 'No company', order: c.companyId ? 0 : 1 };
      case 'source':
        return { key: c.source ?? 'none', label: c.source ?? 'No source', order: c.source ? 0 : 1 };
      default:
        return { key: 'all', label: 'All', order: 0 };
    }
  };
  const map = new Map<string, { key: string; label: string; order: number; rows: Contact[] }>();
  for (const contact of contacts) {
    const { key, label, order } = keyFor(contact);
    if (!map.has(key)) map.set(key, { key, label, order, rows: [] });
    map.get(key)!.rows.push(contact);
  }
  return [...map.values()].sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));
}

/** Why we can or can't email someone, in one sentence. */
export function reachability(contact: Pick<Contact, 'email' | 'doNotContact' | 'unsubscribedAt'>) {
  if (contact.unsubscribedAt) return { canEmail: false, tone: 'danger' as const, label: 'Unsubscribed', reason: 'They unsubscribed from your emails, so nothing more can be sent to them.' };
  if (contact.doNotContact) return { canEmail: false, tone: 'danger' as const, label: 'Do not contact', reason: 'Someone on your team marked them do not contact.' };
  if (!contact.email) return { canEmail: false, tone: 'neutral' as const, label: 'No email', reason: 'Add an email address to reach them from here.' };
  return { canEmail: true, tone: 'neutral' as const, label: 'Email', reason: '' };
}
