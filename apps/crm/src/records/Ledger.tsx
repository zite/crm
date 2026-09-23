import { CaretDown, CaretUp } from '@phosphor-icons/react';
import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react';
import { cn } from '../ui/cn';
import { Checkbox } from '../ui/Form';

/**
 * The ledger: a real table with sortable headers, 46px rows and one grid per
 * kind of row. Columns declare their own width and alignment so every surface
 * lines up; money is always right-aligned.
 */
export type Column<T> = {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  /** Sort key sent to the endpoint; omit for a column that can't be sorted. */
  sort?: string;
  align?: 'left' | 'right';
  width?: string;
  /** Hide below this breakpoint. */
  hide?: 'sm' | 'md' | 'lg' | 'xl';
  /** A cell that shouldn't open the row when clicked (a picker, a link). */
  interactive?: boolean;
};

const BREAKPOINT: Record<string, number> = { sm: 640, md: 768, lg: 1024, xl: 1280 };

/**
 * Which columns are actually on screen.
 *
 * Hiding a column's cells with a class is not enough: its `<col>` keeps its
 * declared width regardless — `display:none` on a `<col>` is ignored — so under
 * `table-fixed` the hidden columns went on reserving their share and the
 * flexible name column got whatever was left. Measured on a phone, the quotes
 * ledger's title column came out at 0px. Dropping hidden columns from the render
 * keeps the colgroup and the cells telling the same story.
 */
function useShownColumns<T>(columns: Array<Column<T>>) {
  const [width, setWidth] = useState(() => (typeof window === 'undefined' ? 1440 : window.innerWidth));
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return useMemo(() => {
    const shown = columns.filter(col => !col.hide || width >= BREAKPOINT[col.hide]);
    // A list whose every column is a percentage has no flexible column to absorb
    // what the hidden ones gave back, and the browser hands the slack to the
    // checkbox and row-menu columns instead — 285px of them on Companies at 768px.
    // Re-spread the percentages over the columns still on screen.
    const percents = shown.map(col => (col.width?.endsWith('%') ? Number.parseFloat(col.width) : 0));
    const total = percents.reduce((sum, p) => sum + p, 0);
    if (percents.some(p => !p) || total >= 99) return shown;
    return shown.map((col, i) => ({ ...col, width: `${((percents[i] * 100) / total).toFixed(3)}%` }));
  }, [columns, width]);
}

export function Ledger<T>({
  rows,
  columns,
  getId,
  sort,
  onSort,
  onRowClick,
  onRowDoubleClick,
  focusId,
  selected,
  onToggleSelect,
  onToggleAll,
  groups,
  rowMenu,
  empty,
  minWidth = 720,
  className,
}: {
  rows: T[];
  columns: Array<Column<T>>;
  getId: (row: T) => string;
  sort?: { key: string; dir: 'asc' | 'desc' };
  onSort?: (key: string) => void;
  onRowClick?: (row: T) => void;
  onRowDoubleClick?: (row: T) => void;
  focusId?: string | null;
  selected?: Set<string>;
  onToggleSelect?: (id: string) => void;
  onToggleAll?: () => void;
  /** Group bands: rows must already be ordered to match. */
  groups?: Array<{ key: string; label: ReactNode; count: number; meta?: ReactNode; rows: T[] }>;
  rowMenu?: (row: T) => ReactNode;
  empty?: ReactNode;
  /** Table min width in px. Lower it on a list that collapses to one column below `sm`,
      or the phone gets hundreds of pixels of empty horizontal scroll. */
  minWidth?: number;
  className?: string;
}) {
  const selectable = Boolean(onToggleSelect);
  const allSelected = Boolean(selected && rows.length > 0 && selected.size === rows.length);
  const someSelected = Boolean(selected && selected.size > 0 && !allSelected);
  const shown = useShownColumns(columns);

  const header = (
    <thead className="sticky top-0 z-10">
      <tr className="bg-sunken text-micro font-semibold uppercase text-ink-3">
        {selectable && (
          <th className="px-3 py-0">
            <Checkbox checked={allSelected} indeterminate={someSelected} onCheckedChange={() => onToggleAll?.()} label="Select all rows" />
          </th>
        )}
        {shown.map(col => (
          <th key={col.key} className={cn('h-9 whitespace-nowrap px-3 text-left font-semibold', col.align === 'right' && 'text-right')} style={{ width: col.width }}>
            {col.sort && onSort ? (
              <button type="button" onClick={() => onSort(col.sort!)} className="inline-flex items-center gap-1 uppercase tracking-[0.05em] hover:text-ink">
                {col.header}
                {sort?.key === col.sort && (sort.dir === 'asc' ? <CaretUp size={10} weight="bold" /> : <CaretDown size={10} weight="bold" />)}
              </button>
            ) : (
              col.header
            )}
          </th>
        ))}
        {rowMenu && <th className="px-2" />}
      </tr>
    </thead>
  );

  const renderRow = (row: T) => {
    const id = getId(row);
    const isSelected = selected?.has(id);
    return (
      <tr
        key={id}
        data-row-id={id}
        onClick={() => onRowClick?.(row)}
        onDoubleClick={() => onRowDoubleClick?.(row)}
        className={cn(
          'group h-[46px] border-b border-line text-ui transition-colors',
          onRowClick && 'cursor-pointer',
          isSelected ? 'bg-accent/[0.07] dark:bg-accent/10' : 'hover:bg-hover/60',
          focusId === id && 'relative shadow-[inset_2px_0_0_0_rgb(var(--accent))]',
        )}
      >
        {selectable && (
          <td className="px-3" onClick={e => e.stopPropagation()}>
            <Checkbox
              checked={Boolean(isSelected)}
              onCheckedChange={() => onToggleSelect?.(id)}
              label="Select row"
              className={cn(!isSelected && 'opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100')}
            />
          </td>
        )}
        {shown.map(col => (
          <td
            key={col.key}
            className={cn('truncate px-3 text-ink', col.align === 'right' && 'text-right')}
            onClick={col.interactive ? e => e.stopPropagation() : undefined}
          >
            {col.cell(row)}
          </td>
        ))}
        {rowMenu && (
          <td className="px-2" onClick={e => e.stopPropagation()}>
            <div className="opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">{rowMenu(row)}</div>
          </td>
        )}
      </tr>
    );
  };

  if (!rows.length) return <div className={className}>{empty}</div>;

  return (
    <div className={cn('overflow-x-auto', className)}>
      {/* table-fixed makes each column's declared width real, so a long email can't push
          the columns after it off screen. The colgroup is what carries those widths —
          a width class on a <th> is ignored under fixed layout, and the leftover space
          lands on the first column instead. Columns without a width share the rest. */}
      <table className="w-full table-fixed border-collapse" style={{ minWidth }}>
        <colgroup>
          {selectable && <col style={{ width: 36 }} />}
          {shown.map(col => (
            <col key={col.key} style={col.width ? { width: col.width } : undefined} />
          ))}
          {rowMenu && <col style={{ width: 40 }} />}
        </colgroup>
        {header}
        <tbody>
          {groups
            ? groups.map(group => (
                <Fragment key={group.key}>
                  <tr className="border-b border-line bg-card">
                    <td colSpan={shown.length + (selectable ? 1 : 0) + (rowMenu ? 1 : 0)} className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span className="text-ui font-semibold text-ink">{group.label}</span>
                        <span className="tabular text-meta text-ink-3">{group.count}</span>
                        {group.meta && <span className="ml-auto text-meta text-ink-2">{group.meta}</span>}
                      </div>
                    </td>
                  </tr>
                  {group.rows.map(renderRow)}
                </Fragment>
              ))
            : rows.map(renderRow)}
        </tbody>
      </table>
    </div>
  );
}
