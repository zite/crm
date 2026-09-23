import { ArrowDown, ArrowUp, Copy, DotsThree, Package, Plus, Trash } from '@phosphor-icons/react';
import { useEffect, useId, useState, type ReactNode } from 'react';
import { Button } from '../../ui/Button';
import { Input, Select } from '../../ui/Form';
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '../../ui/Menu';
import { Tooltip } from '../../ui/Tooltip';
import { cn } from '../../ui/cn';
import { Money } from '../../glyphs';
import { useWorkspace } from '../../lib/workspace';
import { ProductPicker, type Product } from '../products/ProductPicker';
import { blankLine, lineFromProduct, newLineId, totalOf, totalsOf, type EditableLine } from './lineItems';
import { BILLING, type Billing } from '@project/shared/constants';
import { billingLabel } from '@project/shared/quotes';

/**
 * The editable price grid, used on a deal and inside a quote. One row is one
 * line: what it is, how many, at what price, less what discount, billed how.
 * The amount column is never typed into — it is worked out, so the rep can see
 * the arithmetic rather than reproduce it.
 *
 * At md and up it is a table with a sticky column header; below that each line
 * stacks into a labelled block, so it stays usable at 390px.
 */

const GRID = 'grid grid-cols-1 gap-x-3 gap-y-2 md:grid-cols-[minmax(0,1fr)_60px_104px_70px_178px_112px_32px] md:items-start md:gap-y-0';

function toText(value: number) {
  return Number.isFinite(value) ? String(Math.round(value * 100) / 100) : '';
}

/** A number you can type in: keeps your keystrokes while focused, reformats when you leave. */
function NumField({
  value,
  onChange,
  label,
  suffix,
  disabled,
  className,
}: {
  value: number;
  onChange: (n: number) => void;
  label: string;
  suffix?: string;
  disabled?: boolean;
  className?: string;
}) {
  const [text, setText] = useState(() => toText(value));
  const [live, setLive] = useState(false);
  useEffect(() => {
    if (!live) setText(toText(value));
  }, [value, live]);
  return (
    <span className="relative flex">
      <Input
        value={text}
        disabled={disabled}
        inputMode="decimal"
        aria-label={label}
        onFocus={() => setLive(true)}
        onBlur={() => {
          setLive(false);
          setText(toText(value));
        }}
        onChange={e => {
          const raw = e.target.value;
          setText(raw);
          const n = Number(raw.replace(/[^0-9.]/g, ''));
          onChange(Number.isFinite(n) ? n : 0);
        }}
        className={cn('tabular h-9 px-2 text-right text-ui', suffix && 'pr-6', className)}
      />
      {suffix && <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-meta text-ink-3">{suffix}</span>}
    </span>
  );
}

function CellLabel({ children }: { children: ReactNode }) {
  return <span className="mb-1 block text-micro font-semibold uppercase text-ink-3 md:hidden">{children}</span>;
}

function LineRow({
  line,
  index,
  count,
  onPatch,
  onMove,
  onDuplicate,
  onRemove,
  invalid,
}: {
  line: EditableLine;
  index: number;
  count: number;
  onPatch: (patch: Partial<EditableLine>) => void;
  onMove: (delta: number) => void;
  onDuplicate: () => void;
  onRemove: () => void;
  invalid: boolean;
}) {
  const id = useId();
  const recurring = line.billing !== 'One-time';
  return (
    <div className={cn(GRID, 'border-b border-line px-3 py-3 last:border-b-0 md:py-2.5')}>
      <div className="min-w-0">
        <CellLabel>Item</CellLabel>
        <div className="flex items-center gap-1">
          <Input
            id={id}
            value={line.name}
            invalid={invalid}
            aria-label={`Line ${index + 1} description`}
            placeholder="What are you selling?"
            onChange={e => onPatch({ name: e.target.value, productId: null })}
            className="h-9 text-ui"
          />
          {/* The tooltip wraps the picker rather than the button: the popover's
              trigger props have to reach the button itself. */}
          <Tooltip content="Fill from the price book">
            <span className="flex shrink-0">
              <ProductPicker
                onPick={(product: Product) => onPatch({ ...lineFromProduct(product), id: line.id, quantity: line.quantity || 1 })}
                trigger={
                  <Button variant="ghost" size="sm" icon aria-label="Fill this line from the price book">
                    <Package size={16} />
                  </Button>
                }
              />
            </span>
          </Tooltip>
        </div>
        {line.description && <p className="mt-1 line-clamp-2 text-meta text-ink-3">{line.description}</p>}
      </div>

      <div className="grid grid-cols-3 gap-2 md:contents">
        <div>
          <CellLabel>Qty</CellLabel>
          <NumField value={line.quantity} onChange={quantity => onPatch({ quantity })} label={`Quantity for line ${index + 1}`} />
        </div>
        <div>
          <CellLabel>Unit price</CellLabel>
          <NumField value={line.unitPrice} onChange={unitPrice => onPatch({ unitPrice })} label={`Unit price for line ${index + 1}`} />
        </div>
        <div>
          <CellLabel>Disc.</CellLabel>
          <NumField value={line.discount} onChange={discount => onPatch({ discount: Math.min(100, Math.max(0, discount)) })} label={`Discount percent for line ${index + 1}`} suffix="%" />
        </div>
      </div>

      <div className="flex items-center gap-1.5 md:block">
        <div className="min-w-0 flex-1">
          <CellLabel>Billing</CellLabel>
          <div className="flex items-center gap-1.5">
            <Select
              value={line.billing}
              aria-label={`Billing for line ${index + 1}`}
              onChange={e => {
                const billing = e.target.value as Billing;
                onPatch({ billing, termMonths: billing === 'One-time' ? null : line.termMonths ?? 12 });
              }}
              className="h-9 min-w-0 flex-1 pl-2 pr-7 text-ui"
            >
              {BILLING.map(b => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </Select>
            {/* The term slot keeps its width when a line is one-time, so the billing
                select is the same size on every row instead of stretching. */}
            {recurring ? (
              <span className="flex w-[76px] shrink-0 items-center gap-1">
                <NumField value={line.termMonths ?? 12} onChange={termMonths => onPatch({ termMonths: Math.max(1, Math.round(termMonths)) })} label={`Term in months for line ${index + 1}`} className="w-[52px]" />
                <span className="text-meta text-ink-3">mo</span>
              </span>
            ) : (
              <span aria-hidden className="hidden w-[76px] shrink-0 md:block" />
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 md:contents">
        <div className="md:flex md:h-9 md:items-center md:justify-end">
          <CellLabel>Amount</CellLabel>
          <span className="text-ui font-medium text-ink md:text-right">
            <Money value={totalOf(line)} cents muted0 />
          </span>
        </div>
        <div className="md:flex md:h-9 md:items-center">
          <Menu>
            <MenuTrigger asChild>
              <Button variant="ghost" size="sm" icon aria-label={`Actions for line ${index + 1}`}>
                <DotsThree size={18} weight="bold" />
              </Button>
            </MenuTrigger>
            <MenuContent align="end">
              <MenuItem icon={<ArrowUp size={16} />} disabled={index === 0} onSelect={() => onMove(-1)}>
                Move up
              </MenuItem>
              <MenuItem icon={<ArrowDown size={16} />} disabled={index === count - 1} onSelect={() => onMove(1)}>
                Move down
              </MenuItem>
              <MenuItem icon={<Copy size={16} />} onSelect={onDuplicate}>
                Duplicate line
              </MenuItem>
              <MenuSeparator />
              <MenuItem destructive icon={<Trash size={16} />} onSelect={onRemove}>
                Remove line
              </MenuItem>
            </MenuContent>
          </Menu>
        </div>
      </div>
    </div>
  );
}

export function LineItemsEditor({
  lines,
  onChange,
  showErrors,
  className,
}: {
  lines: EditableLine[];
  onChange: (lines: EditableLine[]) => void;
  /** Mark blank descriptions once the rep has tried to save. */
  showErrors?: boolean;
  className?: string;
}) {
  const patch = (index: number, next: Partial<EditableLine>) => onChange(lines.map((l, i) => (i === index ? { ...l, ...next } : l)));
  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= lines.length) return;
    const next = [...lines];
    const [row] = next.splice(index, 1);
    next.splice(target, 0, row);
    onChange(next);
  };

  return (
    <div className={cn('overflow-hidden rounded-lg border border-line bg-card', className)}>
      <div className="overflow-x-auto">
        <div className="md:min-w-[680px]">
          <div className={cn(GRID, 'hidden border-b border-line bg-sunken px-3 py-2 text-micro font-semibold uppercase text-ink-3 md:grid')}>
            <span>Item</span>
            {/* The numeric headers carry the inputs' own inset so the label sits over the figure, not over the field's border. */}
            <span className="pr-2 text-right">Qty</span>
            <span className="pr-2 text-right">Unit price</span>
            <span className="pr-2 text-right">Disc.</span>
            <span>Billing</span>
            <span className="text-right">Amount</span>
            <span />
          </div>
          {lines.map((line, index) => (
            <LineRow
              key={line.id}
              line={line}
              index={index}
              count={lines.length}
              invalid={Boolean(showErrors) && !line.name.trim()}
              onPatch={next => patch(index, next)}
              onMove={delta => move(index, delta)}
              onDuplicate={() => onChange([...lines.slice(0, index + 1), { ...line, id: newLineId() }, ...lines.slice(index + 1)])}
              onRemove={() => onChange(lines.filter((_, i) => i !== index))}
            />
          ))}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 border-t border-line bg-sunken/50 px-2 py-1.5">
        <ProductPicker
          onPick={product => onChange([...lines, lineFromProduct(product)])}
          trigger={
            <Button variant="ghost" size="sm" leading={<Package size={16} />}>
              Add from the price book
            </Button>
          }
        />
        <Button variant="ghost" size="sm" leading={<Plus size={16} weight="bold" />} onClick={() => onChange([...lines, blankLine()])}>
          Add a blank line
        </Button>
      </div>
    </div>
  );
}

/**
 * The right margin that lines the totals up with the amount column above them.
 * `row` clears a bordered card whose rows are `px-3`; `grid` also clears the
 * editor's trailing action column and its gap, which only exists at `md`.
 */
const TOTALS_INSET = { none: '', row: 'pr-[13px]', grid: 'pr-[13px] md:pr-[57px]' } as const;

/** Subtotal, discount, tax and total — the same block on the deal, the quote and the preview. */
export function TotalsBlock({
  lines,
  taxRate,
  onTaxRateChange,
  className,
  inset = 'none',
}: {
  lines: EditableLine[];
  taxRate?: number;
  onTaxRateChange?: (rate: number) => void;
  className?: string;
  /** Which list sits above: a read-only card (`row`) or the editable grid (`grid`). */
  inset?: keyof typeof TOTALS_INSET;
}) {
  const totals = totalsOf(lines, taxRate ?? 0);
  const rows: Array<{ label: ReactNode; value: ReactNode; strong?: boolean }> = [{ label: 'Subtotal', value: <Money value={totals.subtotal} cents /> }];
  if (totals.discountTotal > 0) rows.push({ label: 'Discount', value: <span className="text-ink-2">−<Money value={totals.discountTotal} cents /></span> });
  if (onTaxRateChange) {
    rows.push({
      label: (
        <span className="flex items-center gap-1.5">
          Tax
          <NumField value={taxRate ?? 0} onChange={onTaxRateChange} label="Tax rate percent" suffix="%" className="w-[74px]" />
        </span>
      ),
      value: <Money value={totals.tax} cents />,
    });
  } else if ((taxRate ?? 0) > 0) {
    rows.push({ label: `Tax (${taxRate}%)`, value: <Money value={totals.tax} cents /> });
  }

  return (
    <div className={cn('ml-auto w-full max-w-[340px]', TOTALS_INSET[inset], className)}>
      <dl className="flex flex-col gap-1.5">
        {rows.map((row, i) => (
          <div key={i} className="flex min-h-7 items-center justify-between gap-4">
            <dt className="text-ui text-ink-2">{row.label}</dt>
            <dd className="tabular text-ui text-ink">{row.value}</dd>
          </div>
        ))}
        <div className="mt-1 flex items-baseline justify-between gap-4 border-t border-line-strong pt-2.5">
          <dt className="text-ui font-medium text-ink">Total</dt>
          <dd className="tabular font-display text-[24px] leading-8 text-ink">
            <Money value={totals.total} cents />
          </dd>
        </div>
      </dl>
    </div>
  );
}

/** One line, read-only — the buyer's view of a row. */
export function ReadOnlyLine({ line }: { line: EditableLine }) {
  const ws = useWorkspace();
  return (
    <div className="flex items-start justify-between gap-4 border-b border-line px-3 py-3 last:border-b-0">
      <div className="min-w-0">
        <div className="text-ui font-medium text-ink">{line.name || 'Untitled line'}</div>
        {line.description && <p className="mt-0.5 text-meta text-ink-2">{line.description}</p>}
        <div className="mt-0.5 text-meta text-ink-3">
          {line.quantity} × {ws.money(line.unitPrice, { cents: true })} · {billingLabel(line.billing, line.termMonths)}
          {line.discount > 0 && ` · ${line.discount}% off`}
        </div>
      </div>
      <div className="tabular shrink-0 text-ui text-ink">
        <Money value={totalOf(line)} cents />
      </div>
    </div>
  );
}
