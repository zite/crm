import { useCallback, useEffect, useMemo, useState } from 'react';

/**
 * A list surface's own state — layout, sort, grouping, visible columns,
 * filters and search — remembered per surface so coming back to Deals feels
 * like where you left it. Saved views load into the same shape.
 */
export type SortState<K extends string = string> = { key: K; dir: 'asc' | 'desc' };

export type ListState<F extends object, K extends string = string> = {
  layout: string;
  sort: SortState<K>;
  groupBy: string | null;
  columns: string[] | null;
  filters: F;
  search: string;
};

const storageKey = (surface: string) => `crm.list.${surface}`;

function read<F extends object, K extends string>(surface: string, fallback: ListState<F, K>): ListState<F, K> {
  try {
    const raw = localStorage.getItem(storageKey(surface));
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<ListState<F, K>>;
    return { ...fallback, ...parsed, filters: { ...fallback.filters, ...(parsed.filters ?? {}) } };
  } catch {
    return fallback;
  }
}

export function useListState<F extends object, K extends string = string>(surface: string, initial: ListState<F, K>) {
  const [state, setState] = useState<ListState<F, K>>(() => read(surface, initial));

  useEffect(() => {
    try {
      localStorage.setItem(storageKey(surface), JSON.stringify(state));
    } catch {
      /* private window */
    }
  }, [surface, state]);

  const setFilters = useCallback((patch: Partial<F> | ((current: F) => F)) => {
    setState(s => ({ ...s, filters: typeof patch === 'function' ? (patch as (c: F) => F)(s.filters) : { ...s.filters, ...patch } }));
  }, []);

  const reset = useCallback(() => setState({ ...initial, layout: state.layout }), [initial, state.layout]);

  const isFiltered = useMemo(() => JSON.stringify(state.filters) !== JSON.stringify(initial.filters) || Boolean(state.search), [state.filters, state.search, initial.filters]);

  return {
    state,
    setState,
    setFilters,
    setLayout: (layout: string) => setState(s => ({ ...s, layout })),
    setSort: (sort: SortState<K>) => setState(s => ({ ...s, sort })),
    toggleSort: (key: K) => setState(s => ({ ...s, sort: s.sort.key === key ? { key, dir: s.sort.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'name' ? 'asc' : 'desc' } })),
    setGroupBy: (groupBy: string | null) => setState(s => ({ ...s, groupBy })),
    setColumns: (columns: string[] | null) => setState(s => ({ ...s, columns })),
    setSearch: (search: string) => setState(s => ({ ...s, search })),
    /** Load a saved view's config over the current state. */
    applyConfig: (config: Partial<ListState<F, K>>) => setState(s => ({ ...s, ...config, filters: { ...initial.filters, ...(config.filters ?? {}) } })),
    reset,
    isFiltered,
  };
}
