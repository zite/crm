import { useQuery, useQueryClient, type QueryClient, type UseQueryOptions } from '@tanstack/react-query';
import { getDeal, getTimeline, listDeals, listDocuments, listNotifications, listTasks, search, type GetDealOutputType, type ListDealsInputType, type ListDealsOutputType, type ListTasksInputType, type ListTasksOutputType } from 'zitejs/api';
import { todayString } from './format';

/**
 * Query keys. Each area owns a first segment; invalidate by prefix after a
 * write. Keep every input that changes the result inside the key — a key that
 * omits a filter will serve one surface's rows to another.
 *
 *   workspace · deals · deal · timeline · tasks · notifications · documents · search
 *   companies · contacts · leads · quotes · outreach · reports · settings (per area)
 */
export const qk = {
  deals: (input: ListDealsInputType) => ['deals', input] as const,
  deal: (id: string) => ['deal', id] as const,
  timeline: (type: string, id: string, extra?: Record<string, unknown>) => ['timeline', type, id, extra ?? {}] as const,
  tasks: (input: ListTasksInputType) => ['tasks', input] as const,
  notifications: (filter: string) => ['notifications', filter] as const,
  documents: (type: string, id: string) => ['documents', type, id] as const,
  search: (query: string, kinds?: string[]) => ['search', query, kinds ?? []] as const,
};

/** Invalidate whole areas: invalidate(qc, 'deals', 'deal'). */
export function invalidate(qc: QueryClient, ...roots: string[]) {
  for (const root of roots) void qc.invalidateQueries({ queryKey: [root] });
}

export function useDeals(input: ListDealsInputType, options?: Partial<UseQueryOptions<ListDealsOutputType>>) {
  const withToday = { today: todayString(), ...input };
  return useQuery({ queryKey: qk.deals(withToday), queryFn: () => listDeals(withToday), ...options });
}

export function useDeal(id: string | null | undefined, options?: Partial<UseQueryOptions<GetDealOutputType>>) {
  return useQuery({
    queryKey: qk.deal(id ?? ''),
    queryFn: () => getDeal({ id: id as string, today: todayString() }),
    enabled: Boolean(id),
    retry: (count, error) => count < 2 && !/not exist|NOT_FOUND/i.test(String((error as Error)?.message)),
    ...options,
  });
}

export function useTimeline(type: 'company' | 'contact' | 'deal' | 'lead', id: string | null | undefined, extra?: { kinds?: Array<'Note' | 'Call' | 'Email' | 'Meeting'>; history?: boolean; limit?: number }) {
  return useQuery({
    queryKey: qk.timeline(type, id ?? '', extra),
    queryFn: () => getTimeline({ type, id: id as string, ...extra }),
    enabled: Boolean(id),
  });
}

export function useTasks(input: ListTasksInputType, options?: Partial<UseQueryOptions<ListTasksOutputType>>) {
  const withToday = { today: todayString(), ...input };
  return useQuery({ queryKey: qk.tasks(withToday), queryFn: () => listTasks(withToday), ...options });
}

export function useNotifications(filter: 'all' | 'unread' = 'all') {
  return useQuery({ queryKey: qk.notifications(filter), queryFn: () => listNotifications({ filter }), refetchInterval: 120_000 });
}

export function useDocuments(type: 'company' | 'contact' | 'deal' | 'lead', id: string | null | undefined) {
  return useQuery({ queryKey: qk.documents(type, id ?? ''), queryFn: () => listDocuments({ type, id: id as string }), enabled: Boolean(id) });
}

export function useSearch(query: string, kinds?: Array<'company' | 'contact' | 'deal' | 'lead'>, enabled = true) {
  return useQuery({
    queryKey: qk.search(query, kinds),
    queryFn: () => search({ query, kinds, limit: 8 }),
    enabled: enabled && query.trim().length > 1,
    staleTime: 20_000,
  });
}

/** Everything a write to a deal can change. */
export function invalidateDeal(qc: QueryClient, dealId?: string) {
  invalidate(qc, 'deals', 'reports', 'home');
  if (dealId) void qc.invalidateQueries({ queryKey: qk.deal(dealId) });
  else invalidate(qc, 'deal');
  invalidate(qc, 'timeline');
}

export function useQueryClientSafe() {
  return useQueryClient();
}
