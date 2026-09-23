import { useMemo, type ReactNode } from 'react';
import { OptionPicker, type Option } from '../../pickers/OptionPicker';
import { useProducts } from '../quotes/queries';
import { useWorkspace } from '../../lib/workspace';
import { billingLabel } from '@project/shared/quotes';
import type { Billing } from '@project/shared/constants';
import type { ListProductsOutputType } from 'zitejs/api';

export type Product = ListProductsOutputType['products'][number];

/**
 * Pick a product off the price book. Grouped by category, with the price and
 * how it bills beside each one, so a rep prices a line without leaving the row.
 */
export function ProductPicker({ onPick, trigger, align }: { onPick: (product: Product) => void; trigger: ReactNode; align?: 'start' | 'end' }) {
  const ws = useWorkspace();
  const { data } = useProducts({ state: 'active' });
  const products = data?.products ?? [];

  const options: Option[] = useMemo(
    () =>
      products.map(p => ({
        value: p.id,
        label: p.name,
        hint: `${ws.money(p.unitPrice)} · ${billingLabel(p.billing as Billing, 12)}`,
        group: p.category || 'Other',
        keywords: `${p.sku} ${p.description}`,
      })),
    [products, ws],
  );

  return (
    <OptionPicker
      options={options}
      value={null}
      onSelect={id => {
        const product = products.find(p => p.id === id);
        if (product) onPick(product);
      }}
      align={align}
      width={300}
      placeholder="Search the price book"
      empty={products.length ? 'Nothing matches' : 'The price book is empty'}
      trigger={trigger}
    />
  );
}
