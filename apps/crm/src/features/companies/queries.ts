import { useQuery, type QueryClient, type UseQueryOptions } from '@tanstack/react-query';
import {
  findDuplicates,
  getCompany,
  getContact,
  listCompanies,
  listContacts,
  type FindDuplicatesOutputType,
  type GetCompanyOutputType,
  type GetContactOutputType,
  type ListCompaniesInputType,
  type ListCompaniesOutputType,
  type ListContactsInputType,
  type ListContactsOutputType,
} from 'zitejs/api';
import { invalidate } from '../../lib/queries';
import { todayString } from '../../lib/format';

/**
 * Query keys for the Companies & Contacts area. Each root is invalidated by
 * prefix after a write, and every input that changes the result is inside the
 * key — `lib/queries.ts` already invalidates `companies` and `contacts` after
 * an activity is logged, so last-activity columns stay honest.
 *
 *   companies · company · contacts · contact · duplicates
 */
export const ck = {
  companies: (input: ListCompaniesInputType) => ['companies', input] as const,
  company: (id: string) => ['company', id] as const,
  contacts: (input: ListContactsInputType) => ['contacts', input] as const,
  contact: (id: string) => ['contact', id] as const,
  duplicates: (type: string, id?: string | null) => ['duplicates', type, id ?? ''] as const,
};

export function useCompanies(input: ListCompaniesInputType, options?: Partial<UseQueryOptions<ListCompaniesOutputType>>) {
  const withToday = { today: todayString(), ...input };
  return useQuery({ queryKey: ck.companies(withToday), queryFn: () => listCompanies(withToday), ...options });
}

export function useCompany(id: string | null | undefined, options?: Partial<UseQueryOptions<GetCompanyOutputType>>) {
  return useQuery({
    queryKey: ck.company(id ?? ''),
    queryFn: () => getCompany({ id: id as string, today: todayString() }),
    enabled: Boolean(id),
    retry: (count, error) => count < 2 && !/doesn’t exist|NOT_FOUND/i.test(String((error as Error)?.message)),
    ...options,
  });
}

export function useContacts(input: ListContactsInputType, options?: Partial<UseQueryOptions<ListContactsOutputType>>) {
  const withToday = { today: todayString(), ...input };
  return useQuery({ queryKey: ck.contacts(withToday), queryFn: () => listContacts(withToday), ...options });
}

export function useContact(id: string | null | undefined, options?: Partial<UseQueryOptions<GetContactOutputType>>) {
  return useQuery({
    queryKey: ck.contact(id ?? ''),
    queryFn: () => getContact({ id: id as string, today: todayString() }),
    enabled: Boolean(id),
    retry: (count, error) => count < 2 && !/doesn’t exist|NOT_FOUND/i.test(String((error as Error)?.message)),
    ...options,
  });
}

/** Duplicate groups; with an id, only the groups that record is in. */
export function useDuplicates(type: 'company' | 'contact', id?: string | null, enabled = true, options?: Partial<UseQueryOptions<FindDuplicatesOutputType>>) {
  return useQuery({
    queryKey: ck.duplicates(type, id),
    queryFn: () => findDuplicates({ type, id: id ?? undefined }),
    enabled,
    staleTime: 60_000,
    ...options,
  });
}

/** Everything a write to a company can change. */
export function invalidateCompany(qc: QueryClient, companyId?: string) {
  invalidate(qc, 'companies', 'contacts', 'deals', 'home', 'reports', 'timeline', 'duplicates', 'search');
  if (companyId) void qc.invalidateQueries({ queryKey: ck.company(companyId) });
  else invalidate(qc, 'company');
  invalidate(qc, 'contact');
}

/** Everything a write to a contact can change. */
export function invalidateContact(qc: QueryClient, contactId?: string) {
  invalidate(qc, 'contacts', 'companies', 'deals', 'deal', 'home', 'timeline', 'duplicates', 'search');
  if (contactId) void qc.invalidateQueries({ queryKey: ck.contact(contactId) });
  else invalidate(qc, 'contact');
  invalidate(qc, 'company');
}
