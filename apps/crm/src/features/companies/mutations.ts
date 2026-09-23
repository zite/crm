import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  deleteCompanies as deleteCompaniesApi,
  deleteContacts as deleteContactsApi,
  mergeRecords as mergeRecordsApi,
  updateCompanies as updateCompaniesApi,
  updateContacts as updateContactsApi,
  type ListCompaniesOutputType,
  type ListContactsOutputType,
  type UpdateCompaniesInputType,
  type UpdateContactsInputType,
} from 'zitejs/api';
import { errorMessage } from '../../lib/errors';
import { invalidateCompany, invalidateContact } from './queries';

/**
 * Writes for companies and contacts. The frequent ones — owner, type, tags,
 * do-not-contact, archive — are optimistic: patch every cached list, roll back
 * with a toast if the server refuses, then invalidate so the server wins.
 */

type CompanyRow = ListCompaniesOutputType['companies'][number];
type ContactRow = ListContactsOutputType['contacts'][number];
type CompanyPatch = UpdateCompaniesInputType['patch'];
type ContactPatch = UpdateContactsInputType['patch'];

function patchLists<T extends { id: string }, D extends Record<string, unknown>>(
  qc: ReturnType<typeof useQueryClient>,
  root: string,
  key: 'companies' | 'contacts',
  ids: string[],
  apply: (row: T) => T,
) {
  const set = new Set(ids);
  const snapshots: Array<[readonly unknown[], D]> = [];
  qc.getQueriesData<D>({ queryKey: [root] }).forEach(([queryKey, data]) => {
    if (!data || !Array.isArray((data as Record<string, unknown>)[key])) return;
    snapshots.push([queryKey, data]);
    qc.setQueryData<D>(queryKey, { ...data, [key]: ((data as Record<string, unknown>)[key] as T[]).map(row => (set.has(row.id) ? apply(row) : row)) });
  });
  return () => snapshots.forEach(([queryKey, data]) => qc.setQueryData(queryKey, data));
}

export function useCompanyActions() {
  const qc = useQueryClient();

  const update = useMutation({
    mutationFn: (vars: { ids: string[]; patch: CompanyPatch; optimistic?: (row: CompanyRow) => CompanyRow }) => updateCompaniesApi({ ids: vars.ids, patch: vars.patch }),
    onMutate: async vars => {
      if (!vars.optimistic) return {};
      await qc.cancelQueries({ queryKey: ['companies'] });
      return { rollback: patchLists<CompanyRow, ListCompaniesOutputType>(qc, 'companies', 'companies', vars.ids, vars.optimistic) };
    },
    onError: (error, _vars, context) => {
      (context as { rollback?: () => void })?.rollback?.();
      toast.error(errorMessage(error, 'Couldn’t save that change'));
    },
    onSuccess: (result, vars) => {
      if (result.failed.length) toast.error(`${result.failed.length} of ${vars.ids.length} couldn’t be updated: ${result.failed[0].message}`);
    },
    onSettled: (_r, _e, vars) => invalidateCompany(qc, vars.ids.length === 1 ? vars.ids[0] : undefined),
  });

  const remove = useMutation({
    mutationFn: (vars: { ids: string[]; withRelated?: boolean }) => deleteCompaniesApi({ ids: vars.ids, withRelated: vars.withRelated }),
    onSuccess: result => {
      const extra = [result.deletedContacts ? `${result.deletedContacts} contacts` : '', result.deletedDeals ? `${result.deletedDeals} deals` : ''].filter(Boolean).join(' and ');
      toast.success(result.deleted === 1 ? `Company deleted${extra ? ` with its ${extra}` : ''}` : `${result.deleted} companies deleted`);
    },
    onError: error => toast.error(errorMessage(error, 'Couldn’t delete that company')),
    onSettled: () => invalidateCompany(qc),
  });

  const merge = useMutation({
    mutationFn: (vars: { survivorId: string; duplicateIds: string[]; prefer?: 'survivor' | 'newest' }) => mergeRecordsApi({ type: 'company', ...vars }),
    onSuccess: result => toast.success(result.merged === 1 ? 'Companies merged' : `${result.merged + 1} companies merged`),
    onError: error => toast.error(errorMessage(error, 'Couldn’t merge those companies')),
    onSettled: (_r, _e, vars) => invalidateCompany(qc, vars.survivorId),
  });

  return {
    update,
    remove,
    merge,
    setOwner: (ids: string[], ownerId: string | null) => update.mutate({ ids, patch: { ownerId }, optimistic: row => ({ ...row, ownerId }) }),
    setType: (ids: string[], type: CompanyRow['type']) => update.mutate({ ids, patch: { type: type as 'Customer' }, optimistic: row => ({ ...row, type }) }),
    setTags: (ids: string[], tagIds: string[]) => update.mutate({ ids, patch: { tagIds }, optimistic: row => ({ ...row, tagIds }) }),
    addTags: (ids: string[], tagIds: string[]) => update.mutate({ ids, patch: { addTagIds: tagIds } }),
    archive: (ids: string[], archived: boolean) => update.mutate({ ids, patch: { archived }, optimistic: row => ({ ...row, archived }) }),
  };
}

export function useContactActions() {
  const qc = useQueryClient();

  const update = useMutation({
    mutationFn: (vars: { ids: string[]; patch: ContactPatch; optimistic?: (row: ContactRow) => ContactRow }) => updateContactsApi({ ids: vars.ids, patch: vars.patch }),
    onMutate: async vars => {
      if (!vars.optimistic) return {};
      await qc.cancelQueries({ queryKey: ['contacts'] });
      return { rollback: patchLists<ContactRow, ListContactsOutputType>(qc, 'contacts', 'contacts', vars.ids, vars.optimistic) };
    },
    onError: (error, _vars, context) => {
      (context as { rollback?: () => void })?.rollback?.();
      toast.error(errorMessage(error, 'Couldn’t save that change'));
    },
    onSuccess: (result, vars) => {
      if (result.failed.length) toast.error(`${result.failed.length} of ${vars.ids.length} couldn’t be updated: ${result.failed[0].message}`);
    },
    onSettled: (_r, _e, vars) => invalidateContact(qc, vars.ids.length === 1 ? vars.ids[0] : undefined),
  });

  const remove = useMutation({
    mutationFn: (ids: string[]) => deleteContactsApi({ ids }),
    onSuccess: result => toast.success(result.deleted === 1 ? 'Contact deleted' : `${result.deleted} contacts deleted`),
    onError: error => toast.error(errorMessage(error, 'Couldn’t delete that contact')),
    onSettled: () => invalidateContact(qc),
  });

  const merge = useMutation({
    mutationFn: (vars: { survivorId: string; duplicateIds: string[]; prefer?: 'survivor' | 'newest' }) => mergeRecordsApi({ type: 'contact', ...vars }),
    onSuccess: result => toast.success(result.merged === 1 ? 'Contacts merged' : `${result.merged + 1} contacts merged`),
    onError: error => toast.error(errorMessage(error, 'Couldn’t merge those contacts')),
    onSettled: (_r, _e, vars) => invalidateContact(qc, vars.survivorId),
  });

  return {
    update,
    remove,
    merge,
    setOwner: (ids: string[], ownerId: string | null) => update.mutate({ ids, patch: { ownerId }, optimistic: row => ({ ...row, ownerId }) }),
    setCompany: (ids: string[], companyId: string | null, companyName?: string | null) =>
      update.mutate({ ids, patch: { companyId }, optimistic: row => ({ ...row, companyId, companyName: companyName ?? null }) }),
    setTags: (ids: string[], tagIds: string[]) => update.mutate({ ids, patch: { tagIds }, optimistic: row => ({ ...row, tagIds }) }),
    addTags: (ids: string[], tagIds: string[]) => update.mutate({ ids, patch: { addTagIds: tagIds } }),
    setDoNotContact: (ids: string[], doNotContact: boolean) => update.mutate({ ids, patch: { doNotContact }, optimistic: row => ({ ...row, doNotContact }) }),
    archive: (ids: string[], archived: boolean) => update.mutate({ ids, patch: { archived }, optimistic: row => ({ ...row, archived }) }),
  };
}
