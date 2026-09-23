import { Archive, ArrowCounterClockwise, DownloadSimple, Package, PencilSimple, Trash } from '@phosphor-icons/react';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { deleteProduct, saveProduct } from 'zitejs/api';
import { Badge } from '../../ui/Chip';
import { Button } from '../../ui/Button';
import { EmptyState } from '../../ui/Layout';
import { Segmented, SearchField, Select } from '../../ui/Form';
import { MenuItem } from '../../ui/Menu';
import { cn } from '../../ui/cn';
import { Money } from '../../glyphs';
import { AddButton, Group, Row, RowList, RowMenu, SectionHead, SectionSkeleton } from '../settings/kit';
import { useAppActions } from '../../lib/app-actions';
import { downloadCsv } from '../../lib/csv';
import { errorMessage } from '../../lib/errors';
import { plural } from '../../lib/format';
import { useWorkspace } from '../../lib/workspace';
import { invalidateProducts, useProducts } from '../quotes/queries';
import ProductDialog from './ProductDialog';
import type { Product } from './ProductPicker';
import type { Billing } from '@project/shared/constants';

/**
 * The price book, as a settings section: what your team sells, what it costs
 * and how it bills. Managers and admins keep it; everyone else reads it,
 * because a rep needs to know what a thing costs even when they can't change it.
 */
export function ProductsSection() {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const actions = useAppActions();
  const [search, setSearch] = useState('');
  const [state, setState] = useState<'active' | 'archived' | 'all'>('active');
  const [category, setCategory] = useState('');
  const [editing, setEditing] = useState<Product | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const canManage = ws.can('products.manage');
  const query = useProducts({ search: search || undefined, state, category: category || undefined });
  const products = query.data?.products ?? [];
  const categories = query.data?.categories ?? [];
  const isFiltered = Boolean(search) || Boolean(category) || state !== 'active';

  const open = (product: Product | null) => {
    setEditing(product);
    setDialogOpen(true);
  };

  const setActive = async (product: Product, active: boolean) => {
    try {
      await saveProduct({
        id: product.id,
        name: product.name,
        sku: product.sku,
        description: product.description,
        unitPrice: product.unitPrice,
        billing: product.billing as Billing,
        category: product.category,
        active,
      });
      invalidateProducts(qc);
      toast.success(active ? `${product.name} is back in the price book` : `${product.name} archived`);
    } catch (e) {
      toast.error(errorMessage(e, 'Couldn’t update that product'));
    }
  };

  const remove = async (product: Product) => {
    const ok = await actions.confirm({
      title: `Delete ${product.name}?`,
      description: product.usageCount
        ? `It is priced on ${plural(product.usageCount, 'line item')}, so it will be archived instead — those deals and quotes keep their prices.`
        : 'It has never been used, so it will be removed from the price book for good.',
      confirmLabel: product.usageCount ? 'Archive' : 'Delete',
      destructive: true,
    });
    if (!ok) return;
    try {
      const result = await deleteProduct({ id: product.id });
      invalidateProducts(qc);
      toast.success(result.deleted ? `${product.name} deleted` : `${product.name} archived instead — it is already in use`);
    } catch (e) {
      toast.error(errorMessage(e, 'Couldn’t remove that product'));
    }
  };

  const exportCsv = () =>
    downloadCsv(
      'products',
      ['Name', 'SKU', 'Category', 'Unit price', 'Billing', 'Description', 'Active', 'On deals'],
      products.map(p => [p.name, p.sku, p.category, p.unitPrice, p.billing, p.description, p.active ? 'Yes' : 'No', p.usageCount]),
    );

  const clearFilters = () => {
    setSearch('');
    setCategory('');
    setState('active');
  };

  return (
    <div className="flex flex-col gap-7">
      <SectionHead
        title="Products"
        description="The price book a rep builds a deal and a quote from. Change a price here and it applies to the next line, never to one already priced."
        actions={
          canManage ? (
            <AddButton onClick={() => open(null)}>New product</AddButton>
          ) : (
            <span className="text-meta text-ink-3">Managers and admins keep this list</span>
          )
        }
      />

      <Group
        action={
          <Button variant="ghost" size="xs" leading={<DownloadSimple size={14} />} onClick={exportCsv} disabled={!products.length}>
            Export CSV
          </Button>
        }
        title={plural(products.length, 'product')}
      >
        <div className="flex flex-wrap items-center gap-2">
          <SearchField value={search} onChange={setSearch} placeholder="Search the price book" className="w-[200px]" />
          {categories.length > 0 && (
            <Select value={category} onChange={e => setCategory(e.target.value)} aria-label="Category" className="h-8 w-auto text-ui">
              <option value="">All categories</option>
              {categories.map(c => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          )}
          <Segmented
            size="sm"
            value={state}
            onChange={value => setState(value as typeof state)}
            options={[
              { value: 'active', label: 'Active' },
              { value: 'archived', label: 'Archived' },
              { value: 'all', label: 'All' },
            ]}
          />
        </div>

        {query.isPending ? (
          <SectionSkeleton rows={6} />
        ) : products.length === 0 ? (
          <EmptyState
            compact
            icon={<Package size={22} weight="duotone" />}
            title={isFiltered ? 'Nothing matches' : 'The price book is empty'}
            actions={
              isFiltered ? (
                <Button variant="secondary" onClick={clearFilters}>
                  Clear filters
                </Button>
              ) : canManage ? (
                <Button variant="primary" onClick={() => open(null)}>
                  New product
                </Button>
              ) : undefined
            }
          >
            {isFiltered
              ? 'Try a different search or category, or look in the archived list.'
              : 'A product is a line a rep can drop onto a deal or a quote: a name, a price and how it bills. Add the handful you sell most and pricing gets a lot faster.'}
          </EmptyState>
        ) : (
          <RowList>
            {products.map(product => (
              <Row key={product.id} onClick={canManage ? () => open(product) : undefined}>
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className={cn('truncate text-ui font-medium', product.active ? 'text-ink' : 'text-ink-2')}>{product.name}</span>
                    {!product.active && <Badge tone="warning">Archived</Badge>}
                  </div>
                  <div className="truncate text-meta text-ink-3">
                    {[product.sku || null, product.category || null, product.usageCount ? `on ${plural(product.usageCount, 'line')}` : null].filter(Boolean).join(' · ') ||
                      product.description ||
                      'No SKU'}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="tabular text-ui text-ink">
                    <Money value={product.unitPrice} />
                  </div>
                  <div className="text-meta text-ink-3">{product.billing}</div>
                </div>
                {canManage && (
                  // The row itself opens the editor, so the menu has to keep its own clicks.
                  <span className="shrink-0" onClick={e => e.stopPropagation()}>
                    <RowMenu label={`Actions for ${product.name}`}>
                      <MenuItem icon={<PencilSimple size={16} />} onSelect={() => open(product)}>
                        Edit
                      </MenuItem>
                      <MenuItem icon={product.active ? <Archive size={16} /> : <ArrowCounterClockwise size={16} />} onSelect={() => void setActive(product, !product.active)}>
                        {product.active ? 'Archive' : 'Make active'}
                      </MenuItem>
                      <MenuItem destructive icon={<Trash size={16} />} onSelect={() => void remove(product)}>
                        Delete
                      </MenuItem>
                    </RowMenu>
                  </span>
                )}
              </Row>
            ))}
          </RowList>
        )}
      </Group>

      <ProductDialog open={dialogOpen} onOpenChange={setDialogOpen} product={editing} categories={categories} />
    </div>
  );
}
