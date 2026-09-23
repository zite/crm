import { useMutation, useQuery, useQueryClient, type QueryClient, type UseQueryOptions } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  deleteForm as deleteFormApi,
  getForm,
  listForms,
  listSubmissions,
  saveForm as saveFormApi,
  type GetFormOutputType,
  type ListFormsOutputType,
  type ListSubmissionsInputType,
  type ListSubmissionsOutputType,
  type SaveFormInputType,
} from 'zitejs/api';
import { errorMessage } from '../../lib/errors';
import { invalidate } from '../../lib/queries';

/**
 * The forms area's data layer. Keys start with `forms` / `form` /
 * `submissions`, so saving a form refreshes the list, the editor and the
 * submissions tab together.
 */
export type FormRow = ListFormsOutputType['forms'][number];
export type FormField = FormRow['fields'][number];
export type FormFieldType = FormField['type'];
export type Submission = ListSubmissionsOutputType['submissions'][number];
export type SaveFormInput = SaveFormInputType;

export const formKeys = {
  list: () => ['forms'] as const,
  one: (id: string) => ['form', id] as const,
  submissions: (input: ListSubmissionsInputType) => ['submissions', input] as const,
};

export function useForms(options?: Partial<UseQueryOptions<ListFormsOutputType>>) {
  return useQuery({ queryKey: formKeys.list(), queryFn: () => listForms({}), ...options });
}

export function useForm(id: string | null | undefined, options?: Partial<UseQueryOptions<GetFormOutputType>>) {
  return useQuery({
    queryKey: formKeys.one(id ?? ''),
    queryFn: () => getForm({ id: id as string }),
    enabled: Boolean(id),
    retry: (count, error) => count < 2 && !/doesn’t exist|NOT_FOUND/i.test(String((error as Error)?.message)),
    ...options,
  });
}

export function useSubmissions(input: ListSubmissionsInputType, options?: Partial<UseQueryOptions<ListSubmissionsOutputType>>) {
  return useQuery({ queryKey: formKeys.submissions(input), queryFn: () => listSubmissions(input), ...options });
}

export function invalidateForms(qc: QueryClient, formId?: string) {
  invalidate(qc, 'forms', 'submissions', 'leads', 'home');
  if (formId) void qc.invalidateQueries({ queryKey: formKeys.one(formId) });
  else invalidate(qc, 'form');
}

export function useFormActions() {
  const qc = useQueryClient();

  const save = useMutation({
    mutationFn: (input: SaveFormInput) => saveFormApi(input),
    onError: error => toast.error(errorMessage(error, 'Couldn’t save that form')),
    onSettled: (result, _e, input) => invalidateForms(qc, result?.form.id ?? input.id),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteFormApi({ id }),
    onSuccess: () => toast.success('Form deleted'),
    onError: error => toast.error(errorMessage(error, 'Couldn’t delete that form')),
    onSettled: () => invalidateForms(qc),
  });

  return { save, remove };
}

export const FIELD_TYPE_LABELS: Record<FormFieldType, string> = {
  short_text: 'Short text',
  long_text: 'Long text',
  email: 'Email',
  phone: 'Phone',
  number: 'Number',
  select: 'Choice',
  checkbox: 'Checkbox',
};

/** Keys that land on a Lead column rather than in the answers blob. */
export const LEAD_KEYS = ['firstName', 'lastName', 'name', 'email', 'phone', 'title', 'companyName', 'website', 'employees', 'industry', 'country', 'message'] as const;

export const OUTCOME_TONE = { 'New Lead': 'accent', 'Existing Lead': 'info', 'Existing Contact': 'success', Spam: 'neutral' } as const;

/** `<iframe …>` for the page a form lives on. */
export function embedSnippet(pagesUrl: string | null, slug: string) {
  const base = (pagesUrl ?? 'https://your-pages-url').replace(/\/+$/, '');
  return `<iframe src="${base}/#/f/${slug}?embed=1" title="Form" width="100%" height="720" style="border:0;max-width:640px" loading="lazy"></iframe>`;
}

export function publicUrl(pagesUrl: string | null, slug: string) {
  const base = (pagesUrl ?? '').replace(/\/+$/, '');
  return base ? `${base}/#/f/${slug}` : '';
}
