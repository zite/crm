import { useMutation, useQuery, useQueryClient, type QueryClient, type UseQueryOptions } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  deleteLeads as deleteLeadsApi,
  getLead,
  listLeads,
  updateLeads as updateLeadsApi,
  type GetLeadOutputType,
  type ListLeadsInputType,
  type ListLeadsOutputType,
  type UpdateLeadsInputType,
} from 'zitejs/api';
import { errorMessage } from '../../lib/errors';
import { invalidate } from '../../lib/queries';
import { invalidateWorkspace } from '../../lib/workspace';

/**
 * The leads area's data layer. Keys start with `leads` / `lead`, so a write
 * invalidates by prefix and every list — the ledger, the review deck, the home
 * worklist — catches up at once.
 *
 * Status, owner and disqualify are the three things a rep does over and over,
 * so they are optimistic: the row changes under the cursor, and a failure rolls
 * back with the server's own sentence.
 */
export type Lead = ListLeadsOutputType['leads'][number];
export type LeadFilters = NonNullable<ListLeadsInputType['filters']>;
export type LeadSort = NonNullable<ListLeadsInputType['sort']>;
export type LeadPatch = UpdateLeadsInputType['patch'];

export const leadKeys = {
  list: (input: ListLeadsInputType) => ['leads', input] as const,
  one: (id: string) => ['lead', id] as const,
};

export function useLeads(input: ListLeadsInputType, options?: Partial<UseQueryOptions<ListLeadsOutputType>>) {
  return useQuery({ queryKey: leadKeys.list(input), queryFn: () => listLeads(input), ...options });
}

export function useLead(id: string | null | undefined, opts: { matches?: boolean } = {}, options?: Partial<UseQueryOptions<GetLeadOutputType>>) {
  return useQuery({
    queryKey: [...leadKeys.one(id ?? ''), opts.matches ?? false],
    queryFn: () => getLead({ id: id as string, matches: opts.matches }),
    enabled: Boolean(id),
    retry: (count, error) => count < 2 && !/doesn’t exist|NOT_FOUND/i.test(String((error as Error)?.message)),
    ...options,
  });
}

/** Everything a write to a lead can change. */
export function invalidateLead(qc: QueryClient, leadId?: string) {
  invalidate(qc, 'leads', 'home', 'reports', 'timeline', 'submissions');
  if (leadId) void qc.invalidateQueries({ queryKey: leadKeys.one(leadId) });
  else invalidate(qc, 'lead');
  void invalidateWorkspace(qc);
}

export function useLeadActions() {
  const qc = useQueryClient();

  const patchCaches = (ids: string[], apply: (lead: Lead) => Lead) => {
    const set = new Set(ids);
    const snapshots: Array<[readonly unknown[], ListLeadsOutputType]> = [];
    qc.getQueriesData<ListLeadsOutputType>({ queryKey: ['leads'] }).forEach(([key, data]) => {
      if (!data) return;
      snapshots.push([key, data]);
      qc.setQueryData<ListLeadsOutputType>(key, { ...data, leads: data.leads.map(l => (set.has(l.id) ? apply(l) : l)) });
    });
    return () => snapshots.forEach(([key, data]) => qc.setQueryData(key, data));
  };

  const update = useMutation({
    mutationFn: (vars: { ids: string[]; patch: LeadPatch; optimistic?: (lead: Lead) => Lead }) => updateLeadsApi({ ids: vars.ids, patch: vars.patch }),
    onMutate: async vars => {
      if (!vars.optimistic) return {};
      await qc.cancelQueries({ queryKey: ['leads'] });
      return { rollback: patchCaches(vars.ids, vars.optimistic) };
    },
    onError: (error, _vars, context) => {
      (context as { rollback?: () => void })?.rollback?.();
      toast.error(errorMessage(error, 'Couldn’t save that change'));
    },
    onSuccess: (result, vars) => {
      if (result.failed.length) toast.error(`${result.failed.length} of ${vars.ids.length} couldn’t be updated: ${result.failed[0].message}`);
    },
    onSettled: (_r, _e, vars) => invalidateLead(qc, vars.ids.length === 1 ? vars.ids[0] : undefined),
  });

  const remove = useMutation({
    mutationFn: (ids: string[]) => deleteLeadsApi({ ids }),
    onSuccess: result => toast.success(result.deleted === 1 ? 'Lead deleted' : `${result.deleted} leads deleted`),
    onError: error => toast.error(errorMessage(error, 'Couldn’t delete that lead')),
    onSettled: () => invalidateLead(qc),
  });

  return {
    update,
    remove,
    setOwner: (ids: string[], ownerId: string | null) => update.mutate({ ids, patch: { ownerId }, optimistic: lead => ({ ...lead, ownerId }) }),
    setStatus: (ids: string[], status: Lead['status']) =>
      update.mutate({ ids, patch: { status }, optimistic: lead => ({ ...lead, status, disqualifyReason: status === 'Disqualified' ? lead.disqualifyReason : null }) }),
    /** Start working: move to Working and take it if nobody has. */
    startWorking: (ids: string[], meId: string) =>
      update.mutate({
        ids,
        patch: { status: 'Working', claimIfUnowned: true },
        optimistic: lead => ({ ...lead, status: 'Working', ownerId: lead.ownerId ?? meId }),
      }),
    disqualify: (ids: string[], reason: string) =>
      update.mutate({ ids, patch: { status: 'Disqualified', disqualifyReason: reason }, optimistic: lead => ({ ...lead, status: 'Disqualified', disqualifyReason: reason }) }),
    setField: (id: string, patch: LeadPatch) => update.mutate({ ids: [id], patch, optimistic: lead => ({ ...lead, ...(patch as Partial<Lead>) }) }),
    setTags: (ids: string[], tagIds: string[]) => update.mutate({ ids, patch: { tagIds }, optimistic: lead => ({ ...lead, tagIds }) }),
  };
}

/** Has nobody answered this lead inside the organization's response window? */
export function isNeglected(lead: Pick<Lead, 'firstResponseAt' | 'receivedAt' | 'status'>, responseHours: number) {
  if (lead.firstResponseAt || !lead.receivedAt) return false;
  if (lead.status !== 'New' && lead.status !== 'Working') return false;
  return Date.now() - Date.parse(lead.receivedAt) > responseHours * 3_600_000;
}

export const RATING_TONE = { Hot: 'danger', Warm: 'warning', Cold: 'neutral' } as const;
