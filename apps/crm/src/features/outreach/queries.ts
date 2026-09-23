import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  deleteSequence as deleteSequenceApi,
  deleteTemplate as deleteTemplateApi,
  enrollInSequence as enrollInSequenceApi,
  getSequence,
  listEnrollments,
  listSequences,
  listTemplates,
  saveSequence as saveSequenceApi,
  saveTemplate as saveTemplateApi,
  updateEnrollments as updateEnrollmentsApi,
  type ListEnrollmentsInputType,
} from 'zitejs/api';
import { errorMessage } from '../../lib/errors';
import { invalidate } from '../../lib/queries';

/**
 * Outreach owns the 'outreach' query root. Everything that changes a template,
 * a sequence or an enrollment invalidates the whole root — these lists are
 * small and the counts on one screen depend on writes made from another.
 */
export const outreachKeys = {
  templates: (includeArchived: boolean) => ['outreach', 'templates', includeArchived] as const,
  sequences: () => ['outreach', 'sequences'] as const,
  sequence: (id: string) => ['outreach', 'sequence', id] as const,
  enrollments: (input: ListEnrollmentsInputType) => ['outreach', 'enrollments', input] as const,
};

/** Everything a write to outreach can change, including the tasks and timelines a run creates. */
export function invalidateOutreach(qc: QueryClient) {
  invalidate(qc, 'outreach', 'tasks', 'timeline', 'home', 'contacts');
}

export function useTemplates(includeArchived = false) {
  return useQuery({ queryKey: outreachKeys.templates(includeArchived), queryFn: () => listTemplates({ includeArchived }), staleTime: 30_000 });
}

export function useSequences() {
  return useQuery({ queryKey: outreachKeys.sequences(), queryFn: () => listSequences({ includeArchived: true }) });
}

export function useSequence(id: string | null | undefined) {
  return useQuery({
    queryKey: outreachKeys.sequence(id ?? ''),
    queryFn: () => getSequence({ id: id as string }),
    enabled: Boolean(id),
    retry: (count, error) => count < 2 && !/not exist|NOT_FOUND/i.test(String((error as Error)?.message)),
  });
}

export function useEnrollments(input: ListEnrollmentsInputType, enabled = true) {
  return useQuery({ queryKey: outreachKeys.enrollments(input), queryFn: () => listEnrollments(input), enabled });
}

export function useTemplateActions() {
  const qc = useQueryClient();
  const after = () => invalidateOutreach(qc);

  const save = useMutation({
    mutationFn: (vars: Parameters<typeof saveTemplateApi>[0]) => saveTemplateApi(vars),
    onError: error => toast.error(errorMessage(error, 'Couldn’t save that template')),
    onSettled: after,
  });

  const remove = useMutation({
    mutationFn: (ids: string[]) => deleteTemplateApi({ ids }),
    onSuccess: result => toast.success(result.deleted === 1 ? 'Template deleted' : `${result.deleted} templates deleted`),
    onError: error => toast.error(errorMessage(error, 'Couldn’t delete that template')),
    onSettled: after,
  });

  return { save, remove };
}

export function useSequenceActions() {
  const qc = useQueryClient();
  const after = () => invalidateOutreach(qc);

  const save = useMutation({
    mutationFn: (vars: Parameters<typeof saveSequenceApi>[0]) => saveSequenceApi(vars),
    onError: error => toast.error(errorMessage(error, 'Couldn’t save that sequence')),
    onSettled: after,
  });

  const remove = useMutation({
    mutationFn: (ids: string[]) => deleteSequenceApi({ ids }),
    onError: error => toast.error(errorMessage(error, 'Couldn’t delete that sequence')),
    onSettled: after,
  });

  const enroll = useMutation({
    mutationFn: (vars: Parameters<typeof enrollInSequenceApi>[0]) => enrollInSequenceApi(vars),
    onError: error => toast.error(errorMessage(error, 'Couldn’t enroll those contacts')),
    onSettled: after,
  });

  const updateEnrollments = useMutation({
    mutationFn: (vars: { ids: string[]; action: 'pause' | 'resume' | 'stop' }) => updateEnrollmentsApi(vars),
    onError: error => toast.error(errorMessage(error, 'Couldn’t change those enrollments')),
    onSettled: after,
  });

  return { save, remove, enroll, updateEnrollments };
}
