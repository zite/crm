import { useQuery, useQueryClient, type QueryClient, type UseQueryOptions } from '@tanstack/react-query';
import {
  getQuote,
  listLineItems,
  listProducts,
  listQuotes,
  type GetQuoteOutputType,
  type ListLineItemsOutputType,
  type ListProductsInputType,
  type ListProductsOutputType,
  type ListQuotesInputType,
  type ListQuotesOutputType,
} from 'zitejs/api';
import { invalidate, invalidateDeal } from '../../lib/queries';
import { todayString } from '../../lib/format';

/**
 * Query keys for the quotes area. Four first segments are ours — `quotes`,
 * `quote`, `lineItems` and `products` — and every input that changes a result
 * is inside the key.
 */
export const quoteKeys = {
  quotes: (input: ListQuotesInputType) => ['quotes', input] as const,
  quote: (id: string) => ['quote', id] as const,
  lineItems: (dealId: string) => ['lineItems', dealId] as const,
  products: (input: ListProductsInputType) => ['products', input] as const,
};

export function useQuotes(input: ListQuotesInputType, options?: Partial<UseQueryOptions<ListQuotesOutputType>>) {
  const withToday = { today: todayString(), ...input };
  return useQuery({ queryKey: quoteKeys.quotes(withToday), queryFn: () => listQuotes(withToday), ...options });
}

export function useQuote(id: string | null | undefined, options?: Partial<UseQueryOptions<GetQuoteOutputType>>) {
  return useQuery({
    queryKey: quoteKeys.quote(id ?? ''),
    queryFn: () => getQuote({ id: id as string, today: todayString() }),
    enabled: Boolean(id) && id !== 'new',
    retry: (count, error) => count < 2 && !/doesn’t exist|NOT_FOUND/i.test(String((error as Error)?.message)),
    ...options,
  });
}

export function useLineItems(dealId: string | null | undefined, options?: Partial<UseQueryOptions<ListLineItemsOutputType>>) {
  return useQuery({
    queryKey: quoteKeys.lineItems(dealId ?? ''),
    queryFn: () => listLineItems({ dealId: dealId as string }),
    enabled: Boolean(dealId),
    ...options,
  });
}

export function useProducts(input: ListProductsInputType = {}, options?: Partial<UseQueryOptions<ListProductsOutputType>>) {
  return useQuery({ queryKey: quoteKeys.products(input), queryFn: () => listProducts(input), staleTime: 60_000, ...options });
}

/** Everything a write to a quote can change: the ledger, the quote, and the deal it hangs off. */
export function invalidateQuotes(qc: QueryClient, opts: { quoteId?: string; dealId?: string | null } = {}) {
  invalidate(qc, 'quotes');
  if (opts.quoteId) void qc.invalidateQueries({ queryKey: quoteKeys.quote(opts.quoteId) });
  else invalidate(qc, 'quote');
  if (opts.dealId) {
    void qc.invalidateQueries({ queryKey: quoteKeys.lineItems(opts.dealId) });
    invalidateDeal(qc, opts.dealId);
  }
  invalidate(qc, 'notifications');
}

/** The price book changed: every picker and the ledger read from the same key. */
export function invalidateProducts(qc: QueryClient) {
  invalidate(qc, 'products');
}
