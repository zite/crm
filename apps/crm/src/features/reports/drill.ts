import type { ListDealsInputType } from 'zitejs/api';

export type DealDrill = NonNullable<ListDealsInputType['filters']>;

/**
 * Drilling from a figure to the rows behind it.
 *
 * The deals ledger keeps its own state (layout, sort, filters) under
 * `crm.list.deals` and reads it when it mounts, so a drill-down hands the
 * filters over there and navigates. Coming from a report always lands on the
 * list rather than the board — you came to read rows.
 */
const DEALS_KEY = 'crm.list.deals';

export function pushDealFilters(filters: DealDrill) {
  try {
    const raw = localStorage.getItem(DEALS_KEY);
    const current = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    localStorage.setItem(
      DEALS_KEY,
      JSON.stringify({
        ...current,
        layout: 'list',
        groupBy: null,
        sort: { key: 'amount', dir: 'desc' },
        search: '',
        // Replace the filters outright: a drill-down means "exactly these rows",
        // not "these on top of whatever was left over from last time".
        filters,
      }),
    );
  } catch {
    /* private window — the list just opens unfiltered */
  }
}

/** Everything closed-won in a window, optionally for one person. */
export const wonFilters = (from: string, to: string, ownerIds?: string[]): DealDrill => ({ status: ['Won'], closedFrom: from, closedTo: to, ...(ownerIds ? { ownerIds } : {}) });

export const lostFilters = (from: string, to: string, ownerIds?: string[], lostReasons?: string[]): DealDrill => ({
  status: ['Lost'],
  closedFrom: from,
  closedTo: to,
  ...(ownerIds ? { ownerIds } : {}),
  ...(lostReasons ? { lostReasons } : {}),
});

/** Open deals expected to close in the window, optionally in one forecast bucket. */
export const openFilters = (from: string, to: string, options?: { ownerIds?: string[]; forecastCategories?: string[]; pipelineId?: string | null }): DealDrill => ({
  status: ['Open'],
  closeFrom: from,
  closeTo: to,
  ...(options?.ownerIds ? { ownerIds: options.ownerIds } : {}),
  ...(options?.forecastCategories ? { forecastCategories: options.forecastCategories } : {}),
  ...(options?.pipelineId ? { pipelineId: options.pipelineId } : {}),
});
