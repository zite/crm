import type { ListCompaniesInputType, ListCompaniesOutputType } from 'zitejs/api';
import type { WorkspaceApi } from '../../lib/workspace';

export type Company = ListCompaniesOutputType['companies'][number];
export type CompanyFilters = NonNullable<ListCompaniesInputType['filters']>;
export type CompanySort = NonNullable<ListCompaniesInputType['sort']>;

export const COMPANY_GROUP_OPTIONS = [
  { value: 'none', label: 'No grouping' },
  { value: 'owner', label: 'Owner' },
  { value: 'type', label: 'Type' },
  { value: 'industry', label: 'Industry' },
] as const;

export const COMPANY_SORTS = [
  { value: 'name', label: 'Name' },
  { value: 'openValue', label: 'Open pipeline' },
  { value: 'openDeals', label: 'Open deals' },
  { value: 'contacts', label: 'People' },
  { value: 'employees', label: 'Employees' },
  { value: 'revenue', label: 'Annual revenue' },
  { value: 'lastActivityAt', label: 'Last activity' },
  { value: 'createdAt', label: 'Added' },
  { value: 'customerSince', label: 'Customer since' },
] as const;

/** How quiet is too quiet — the "no activity in …" filter and its chip. */
export const STALE_OPTIONS = [30, 60, 90] as const;

export type CompanyTotals = { count: number; openValue: number; wonValue: number; customers: number; noOpenDeals: number; contacts: number };

export function companyTotals(companies: Company[]): CompanyTotals {
  return companies.reduce<CompanyTotals>(
    (acc, c) => ({
      count: acc.count + 1,
      openValue: acc.openValue + c.openDealValue,
      wonValue: acc.wonValue + c.wonValue,
      customers: acc.customers + (c.type === 'Customer' ? 1 : 0),
      noOpenDeals: acc.noOpenDeals + (c.openDealCount === 0 ? 1 : 0),
      contacts: acc.contacts + c.contactCount,
    }),
    { count: 0, openValue: 0, wonValue: 0, customers: 0, noOpenDeals: 0, contacts: 0 },
  );
}

const TYPE_ORDER = ['Customer', 'Prospect', 'Partner', 'Former Customer', 'Other'];

export function groupCompanies(companies: Company[], groupBy: string | null, ws: WorkspaceApi) {
  if (!groupBy || groupBy === 'none') return null;
  const keyFor = (c: Company) => {
    switch (groupBy) {
      case 'owner':
        return { key: c.ownerId ?? 'none', label: c.ownerId ? ws.memberName(c.ownerId) : 'Unassigned', order: c.ownerId ? 0 : 1 };
      case 'type':
        return { key: c.type ?? 'none', label: c.type ?? 'No type', order: c.type ? TYPE_ORDER.indexOf(c.type) : 99 };
      case 'industry':
        return { key: c.industry ?? 'none', label: c.industry ?? 'No industry', order: c.industry ? 0 : 99 };
      default:
        return { key: 'all', label: 'All', order: 0 };
    }
  };
  const map = new Map<string, { key: string; label: string; order: number; rows: Company[] }>();
  for (const company of companies) {
    const { key, label, order } = keyFor(company);
    if (!map.has(key)) map.set(key, { key, label, order, rows: [] });
    map.get(key)!.rows.push(company);
  }
  return [...map.values()].sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));
}

export const COMPANY_TYPE_TONE: Record<string, 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info'> = {
  Customer: 'success',
  Prospect: 'accent',
  Partner: 'info',
  'Former Customer': 'warning',
  Other: 'neutral',
};

/** 'https://www.acme.example/pricing' → 'acme.example', for a link that reads as a domain. */
export function hostLabel(url: string | null | undefined) {
  if (!url) return '';
  return url
    .replace(/^[a-z]+:\/\//i, '')
    .replace(/^www\./i, '')
    .split(/[/?#]/)[0];
}

export function externalUrl(value: string | null | undefined) {
  if (!value) return null;
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}
