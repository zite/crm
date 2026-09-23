import type { ListDealsOutputType } from 'zitejs/api';
import { stalledBy } from '@project/shared/deals';
import type { WorkspaceApi } from '../../lib/workspace';
import { todayString } from '../../lib/format';

export type Deal = ListDealsOutputType['deals'][number];

/** Days a deal is past its stage's limit, or 0. Honours the org's "stalled" setting. */
export function dealStalledDays(deal: Deal, ws: WorkspaceApi, today = todayString()) {
  if (!ws.settings.preferences.stalledEnabled) return 0;
  const stage = ws.stageById(deal.stageId);
  return stalledBy(deal.status, deal.stageEnteredAt, stage ? { rottingDays: stage.rottingDays } : null, today);
}

const HONORIFICS = new Set(['dr', 'mr', 'mrs', 'ms', 'mx', 'prof', 'rev', 'sir', 'dame']);

/**
 * The name to put on a button: the first word that isn't a title, so
 * "Dr. Amara Keene" reads "Email Amara", not "Email Dr.".
 */
export function givenName(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return parts.find(part => !HONORIFICS.has(part.replace(/\.$/, '').toLowerCase())) ?? name;
}

export type DealTotals = { count: number; amount: number; weighted: number };

export function totalsFor(deals: Deal[]): DealTotals {
  return deals.reduce<DealTotals>((acc, d) => ({ count: acc.count + 1, amount: acc.amount + (d.amount ?? 0), weighted: acc.weighted + d.weighted }), { count: 0, amount: 0, weighted: 0 });
}

export const GROUP_OPTIONS = [
  { value: 'none', label: 'No grouping' },
  { value: 'stage', label: 'Stage' },
  { value: 'owner', label: 'Owner' },
  { value: 'company', label: 'Company' },
  { value: 'forecast', label: 'Forecast category' },
  { value: 'type', label: 'Type' },
  { value: 'closeMonth', label: 'Close month' },
] as const;

export function groupDeals(deals: Deal[], groupBy: string | null, ws: WorkspaceApi) {
  if (!groupBy || groupBy === 'none') return null;
  const keyFor = (deal: Deal) => {
    switch (groupBy) {
      case 'stage':
        return { key: deal.stageId, label: ws.stageById(deal.stageId)?.name ?? 'No stage', order: ws.stageById(deal.stageId)?.position ?? 99 };
      case 'owner':
        return { key: deal.ownerId ?? 'none', label: deal.ownerId ? ws.memberName(deal.ownerId) : 'Unassigned', order: 0 };
      case 'company':
        return { key: deal.companyId ?? 'none', label: deal.companyName ?? 'No company', order: 0 };
      case 'forecast':
        return { key: deal.forecastCategory, label: deal.forecastCategory, order: ['Commit', 'Best Case', 'Pipeline', 'Omitted', 'Closed'].indexOf(deal.forecastCategory) };
      case 'type':
        return { key: deal.type ?? 'none', label: deal.type ?? 'No type', order: 0 };
      case 'closeMonth':
        return deal.closeDate
          ? { key: deal.closeDate.slice(0, 7), label: new Date(`${deal.closeDate.slice(0, 7)}-01T00:00:00`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }), order: 0 }
          : { key: 'none', label: 'No close date', order: 9999 };
      default:
        return { key: 'all', label: 'All', order: 0 };
    }
  };
  const map = new Map<string, { key: string; label: string; order: number; rows: Deal[] }>();
  for (const deal of deals) {
    const { key, label, order } = keyFor(deal);
    if (!map.has(key)) map.set(key, { key, label, order, rows: [] });
    map.get(key)!.rows.push(deal);
  }
  return [...map.values()].sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));
}
