import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { saveProduct } from 'zitejs/api';
import { FormDialog } from '../../ui/Dialog';
import { Field, FieldRow, Input, Select, SwitchRow, Textarea } from '../../ui/Form';
import { errorMessage } from '../../lib/errors';
import { useWorkspace } from '../../lib/workspace';
import { invalidateProducts } from '../quotes/queries';
import { BILLING, type Billing } from '@project/shared/constants';
import type { Product } from './ProductPicker';

/**
 * Add or change a price-book product. Reads these `defaults`: `name`,
 * `category`, `unitPrice`, `billing`.
 */
export default function ProductDialog({
  open,
  onOpenChange,
  defaults = {},
  product,
  categories = [],
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaults?: Record<string, unknown>;
  product?: Product | null;
  categories?: string[];
}) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [sku, setSku] = useState('');
  const [category, setCategory] = useState('');
  const [description, setDescription] = useState('');
  const [unitPrice, setUnitPrice] = useState('0');
  const [billing, setBilling] = useState<Billing>('One-time');
  const [active, setActive] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const fallback = (key: string) => (typeof defaults[key] === 'string' ? (defaults[key] as string) : '');
    setName(product?.name ?? fallback('name'));
    setSku(product?.sku ?? '');
    setCategory(product?.category ?? fallback('category'));
    setDescription(product?.description ?? '');
    // A new product starts empty rather than at "0" — a rep types the price, they don't correct it.
    setUnitPrice(product ? String(product.unitPrice) : defaults.unitPrice != null ? String(Number(defaults.unitPrice) || 0) : '');
    setBilling((product?.billing as Billing) ?? ((defaults.billing as Billing) || 'One-time'));
    setActive(product ? product.active : true);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, product]);

  const submit = async () => {
    const price = Number(unitPrice.replace(/[^0-9.]/g, ''));
    if (!name.trim()) {
      setError('Give the product a name');
      return;
    }
    if (!Number.isFinite(price) || price < 0) {
      setError('The unit price must be zero or more');
      return;
    }
    try {
      await saveProduct({ id: product?.id, name: name.trim(), sku: sku.trim(), description: description.trim(), unitPrice: price, billing, category: category.trim(), active });
      invalidateProducts(qc);
      onOpenChange(false);
      toast.success(product ? `${name.trim()} updated` : `${name.trim()} added to the price book`);
    } catch (e) {
      setError(errorMessage(e, 'Couldn’t save that product'));
    }
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={product ? 'Edit product' : 'New product'}
      description={product ? 'Changing a price here doesn’t touch deals or quotes already priced with it.' : 'Products are what a rep prices a deal and a quote from.'}
      submitLabel={product ? 'Save product' : 'Add product'}
      onSubmit={submit}
    >
      <div className="flex flex-col gap-4">
        <Field label="Name" required error={error ?? undefined}>
          <Input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="Operations Platform — Growth" invalid={Boolean(error) && !name.trim()} />
        </Field>
        <FieldRow>
          <Field label="SKU" hint="Optional, but it has to be unique.">
            <Input value={sku} onChange={e => setSku(e.target.value)} placeholder="PLAT-GRW" />
          </Field>
          <Field label="Category">
            <Input value={category} onChange={e => setCategory(e.target.value)} placeholder="Platform" list="crm-product-categories" />
            <datalist id="crm-product-categories">
              {categories.map(c => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </Field>
        </FieldRow>
        <FieldRow>
          <Field label="Unit price" required hint={`In ${ws.settings.currency}.`}>
            <Input value={unitPrice} inputMode="decimal" placeholder="0" onChange={e => setUnitPrice(e.target.value)} className="tabular" />
          </Field>
          <Field label="Billing" hint="How a line using it is normally priced.">
            <Select value={billing} onChange={e => setBilling(e.target.value as Billing)}>
              {BILLING.map(b => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </Select>
          </Field>
        </FieldRow>
        <Field label="Description" hint="Shown to a rep in the picker — not on the quote unless they add it to the line.">
          <Textarea value={description} minRows={3} onChange={e => setDescription(e.target.value)} placeholder="Up to six sites, automation rules and advanced reporting." />
        </Field>
        <SwitchRow label="Active" description={active ? 'Reps can pick it when pricing a deal or a quote.' : 'Archived — hidden from the pickers, but kept on everything already priced with it.'} checked={active} onCheckedChange={setActive} />
      </div>
    </FormDialog>
  );
}
