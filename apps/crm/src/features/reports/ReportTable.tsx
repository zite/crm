import type { ReactNode } from 'react';
import { cn } from '../../ui/cn';

/**
 * A figures table: the ledger's look (sunken header, 46px rows, hairlines,
 * money right-aligned) with a total row underneath, which the record ledger
 * has no need for.
 *
 * It scrolls inside its own container so the page never does — a forecast has
 * seven columns and a phone has none of the room.
 */
export type ReportColumn<T> = {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  total?: ReactNode;
  align?: 'left' | 'right';
  width?: string;
  /** Keeps the first column readable while the rest scrolls sideways. */
  sticky?: boolean;
};

export function ReportTable<T>({
  rows,
  columns,
  getId,
  totalLabel,
  showTotal,
  empty,
  highlightId,
  className,
}: {
  rows: T[];
  columns: Array<ReportColumn<T>>;
  getId: (row: T) => string;
  totalLabel?: ReactNode;
  showTotal?: boolean;
  empty?: ReactNode;
  highlightId?: string | null;
  className?: string;
}) {
  if (!rows.length && empty) return <>{empty}</>;
  return (
    <div className={cn('overflow-x-auto', className)}>
      <table className="w-full min-w-[720px] border-collapse text-ui">
        <thead>
          <tr className="bg-sunken text-micro font-semibold uppercase text-ink-3">
            {columns.map(column => (
              <th
                key={column.key}
                scope="col"
                style={{ width: column.width }}
                className={cn('h-9 whitespace-nowrap px-3 font-semibold', column.align === 'right' ? 'text-right' : 'text-left', column.sticky && 'sticky left-0 z-10 bg-sunken')}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(row => {
            const id = getId(row);
            const mine = highlightId != null && id === highlightId;
            return (
              <tr key={id} className={cn('h-[46px] border-b border-line transition-colors hover:bg-hover/60', mine && 'bg-accent/[0.07] dark:bg-accent/10')}>
                {columns.map(column => (
                  <td
                    key={column.key}
                    className={cn(
                      'px-3',
                      column.align === 'right' ? 'text-right tabular' : 'text-left',
                      // The sticky cell needs an opaque background or the scrolled
                      // columns show through it — so the row's tint is painted on
                      // top of the card colour with an inset wash instead.
                      column.sticky && 'sticky left-0 z-10 bg-card',
                      column.sticky && mine && 'shadow-[inset_0_0_0_999px_rgb(var(--accent)/0.07)] dark:shadow-[inset_0_0_0_999px_rgb(var(--accent)/0.10)]',
                    )}
                  >
                    {column.cell(row)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
        {showTotal && (
          <tfoot>
            <tr className="h-[46px] border-t-2 border-line-strong bg-sunken font-semibold text-ink">
              {columns.map((column, index) => (
                <td key={column.key} className={cn('px-3', column.align === 'right' ? 'text-right tabular' : 'text-left', column.sticky && 'sticky left-0 z-10 bg-sunken')}>
                  {index === 0 ? totalLabel ?? 'Total' : column.total}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
