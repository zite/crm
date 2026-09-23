import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  createTask as createTaskApi,
  deleteDeals as deleteDealsApi,
  logActivity as logActivityApi,
  updateDeals as updateDealsApi,
  updateTasks as updateTasksApi,
  type ListDealsOutputType,
  type UpdateDealsInputType,
} from 'zitejs/api';
import { errorMessage } from './errors';
import { qk, invalidate, invalidateDeal } from './queries';
import { todayString } from './format';
import { invalidateWorkspace } from './workspace';

type DealRow = ListDealsOutputType['deals'][number];
type DealPatch = UpdateDealsInputType['patch'];

/**
 * Writes are optimistic where they are frequent — a stage move, an owner
 * change, ticking a task — and plain otherwise. Every optimistic write patches
 * every cached deal list, rolls back on failure with a toast, and invalidates
 * afterwards so the server's version wins.
 */
export function useDealActions() {
  const qc = useQueryClient();

  const patchCaches = (ids: string[], apply: (deal: DealRow) => DealRow) => {
    const set = new Set(ids);
    const snapshots: Array<[readonly unknown[], ListDealsOutputType]> = [];
    qc.getQueriesData<ListDealsOutputType>({ queryKey: ['deals'] }).forEach(([key, data]) => {
      if (!data) return;
      snapshots.push([key, data]);
      qc.setQueryData<ListDealsOutputType>(key, { ...data, deals: data.deals.map(d => (set.has(d.id) ? apply(d) : d)) });
    });
    return () => snapshots.forEach(([key, data]) => qc.setQueryData(key, data));
  };

  const update = useMutation({
    mutationFn: (vars: { ids: string[]; patch: DealPatch; optimistic?: (deal: DealRow) => DealRow; quiet?: boolean }) =>
      updateDealsApi({ ids: vars.ids, patch: vars.patch, today: todayString() }),
    onMutate: async vars => {
      if (!vars.optimistic) return {};
      await qc.cancelQueries({ queryKey: ['deals'] });
      return { rollback: patchCaches(vars.ids, vars.optimistic) };
    },
    onError: (error, vars, context) => {
      (context as { rollback?: () => void })?.rollback?.();
      toast.error(errorMessage(error, 'Couldn’t save that change'));
    },
    onSuccess: (result, vars) => {
      if (result.failed.length) toast.error(`${result.failed.length} of ${vars.ids.length} couldn’t be updated: ${result.failed[0].message}`);
    },
    onSettled: (_r, _e, vars) => invalidateDeal(qc, vars.ids.length === 1 ? vars.ids[0] : undefined),
  });

  const remove = useMutation({
    mutationFn: (ids: string[]) => deleteDealsApi({ ids }),
    onSuccess: result => toast.success(result.deleted === 1 ? 'Deal deleted' : `${result.deleted} deals deleted`),
    onError: error => toast.error(errorMessage(error, 'Couldn’t delete that deal')),
    onSettled: () => invalidateDeal(qc),
  });

  return {
    update,
    remove,
    /** Move to a stage (board drag, stage picker). Optimistic. */
    setStage: (ids: string[], stageId: string, extra?: { stageName?: string; status?: 'Open' | 'Won' | 'Lost'; position?: number; lostReason?: string; closeNote?: string }) =>
      update.mutate({
        ids,
        patch: { stageId, ...(extra?.position != null ? { position: extra.position } : {}), ...(extra?.lostReason ? { lostReason: extra.lostReason } : {}), ...(extra?.closeNote ? { closeNote: extra.closeNote } : {}) },
        optimistic: deal => ({ ...deal, stageId, status: extra?.status ?? deal.status, position: extra?.position ?? deal.position, stageEnteredAt: new Date().toISOString() }),
      }),
    setOwner: (ids: string[], ownerId: string | null) => update.mutate({ ids, patch: { ownerId }, optimistic: deal => ({ ...deal, ownerId }) }),
    setCloseDate: (ids: string[], closeDate: string | null) => update.mutate({ ids, patch: { closeDate }, optimistic: deal => ({ ...deal, closeDate }) }),
    setAmount: (ids: string[], amount: number | null) => update.mutate({ ids, patch: { amount }, optimistic: deal => ({ ...deal, amount }) }),
    setTags: (ids: string[], tagIds: string[]) => update.mutate({ ids, patch: { tagIds }, optimistic: deal => ({ ...deal, tagIds }) }),
    archive: (ids: string[], archived: boolean) => update.mutate({ ids, patch: { archived }, optimistic: deal => ({ ...deal, archived }) }),
  };
}

export function useTaskActions() {
  const qc = useQueryClient();
  const afterWrite = () => {
    invalidate(qc, 'tasks', 'deals', 'deal', 'home', 'timeline');
    void invalidateWorkspace(qc);
  };

  const complete = useMutation({
    mutationFn: (vars: { ids: string[]; done: boolean }) => updateTasksApi({ ids: vars.ids, patch: { status: vars.done ? 'Done' : 'Open' } }),
    onMutate: async vars => {
      await qc.cancelQueries({ queryKey: ['tasks'] });
      const snapshots = qc.getQueriesData<{ tasks: Array<{ id: string; status: string; completedAt: string | null }> }>({ queryKey: ['tasks'] });
      snapshots.forEach(([key, data]) => {
        if (!data) return;
        qc.setQueryData(key, { ...data, tasks: data.tasks.map(t => (vars.ids.includes(t.id) ? { ...t, status: vars.done ? 'Done' : 'Open', completedAt: vars.done ? new Date().toISOString() : null } : t)) });
      });
      return { snapshots };
    },
    onError: (error, _vars, context) => {
      (context as { snapshots?: Array<[readonly unknown[], unknown]> })?.snapshots?.forEach(([key, data]) => qc.setQueryData(key, data));
      toast.error(errorMessage(error, 'Couldn’t update that task'));
    },
    onSettled: afterWrite,
  });

  const update = useMutation({
    mutationFn: (vars: { ids: string[]; patch: Parameters<typeof updateTasksApi>[0]['patch'] }) => updateTasksApi(vars),
    onError: error => toast.error(errorMessage(error, 'Couldn’t update that task')),
    onSettled: afterWrite,
  });

  const create = useMutation({
    mutationFn: (vars: Parameters<typeof createTaskApi>[0]) => createTaskApi(vars),
    onError: error => toast.error(errorMessage(error, 'Couldn’t create that task')),
    onSettled: afterWrite,
  });

  return { complete, update, create };
}

export function useLogActivity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: Parameters<typeof logActivityApi>[0]) => logActivityApi(vars),
    onError: error => toast.error(errorMessage(error, 'Couldn’t save that')),
    onSettled: () => invalidate(qc, 'timeline', 'deals', 'deal', 'tasks', 'home', 'companies', 'contacts', 'leads'),
  });
}
