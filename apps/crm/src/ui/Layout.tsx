import type { CSSProperties, ReactNode } from 'react';
import { cn } from './cn';

/**
 * Page chrome. Every page is: an eyebrow (where this belongs), a serif title,
 * a line of description, actions on the right, then an optional tab row.
 */
export function PageHeader({ eyebrow, title, description, actions, tabs, className, adornment, narrow, sticky }: { eyebrow?: ReactNode; title: ReactNode; description?: ReactNode; actions?: ReactNode; tabs?: ReactNode; className?: string; adornment?: ReactNode; narrow?: boolean; sticky?: boolean }) {
  return (
    <header className={cn('bg-paper px-5 pt-6 sm:px-8', sticky && 'sticky top-0 z-20', narrow && 'mx-auto w-full max-w-[1120px]', className)}>
      <div className="flex flex-wrap items-end gap-x-5 gap-y-3">
        <div className="min-w-[min(100%,260px)] flex-1">
          {eyebrow && <div className="mb-1.5 flex min-h-5 items-center gap-1.5 text-meta text-ink-2">{eyebrow}</div>}
          <div className="flex min-w-0 items-center gap-3">
            {adornment}
            <h1 className="min-w-0 truncate font-display text-[28px] leading-9 text-ink sm:text-display">{title}</h1>
          </div>
          {description && <p className="mt-1.5 max-w-3xl text-body text-ink-2 text-pretty">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2 pb-1">{actions}</div>}
      </div>
      {tabs && <div className="mt-5 border-b border-line">{tabs}</div>}
    </header>
  );
}

export function PageBody({ children, className, narrow }: { children: ReactNode; className?: string; narrow?: boolean }) {
  return <div className={cn('px-5 py-6 sm:px-8', narrow && 'mx-auto w-full max-w-[1120px]', className)}>{children}</div>;
}

export function Card({ children, className, as: As = 'div', padded }: { children: ReactNode; className?: string; as?: 'div' | 'section' | 'article'; padded?: boolean }) {
  return <As className={cn('rounded-lg border border-line bg-card shadow-hairline', padded && 'p-5 sm:p-6', className)}>{children}</As>;
}

export function Section({ title, count, action, children, className, description, id }: { title: ReactNode; count?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; description?: ReactNode; id?: string }) {
  return (
    <section id={id} className={cn('flex flex-col gap-3', className)}>
      <div className="flex min-h-8 items-center gap-2">
        <h2 className="text-title font-semibold text-ink">{title}</h2>
        {count != null && <span className="tabular text-ui text-ink-3">{count}</span>}
        {description && <span className="hidden truncate text-ui text-ink-3 sm:inline">· {description}</span>}
        {action && <div className="ml-auto flex items-center gap-1.5">{action}</div>}
      </div>
      {children}
    </section>
  );
}

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('text-micro font-semibold uppercase text-ink-3', className)}>{children}</div>;
}

export function Skeleton({ className, style }: { className?: string; style?: CSSProperties }) {
  return <div className={cn('skeleton', className)} style={style} />;
}

export function ListSkeleton({ rows = 8, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn('flex flex-col', className)}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex h-[46px] items-center gap-3 border-b border-line px-4">
          <Skeleton className="h-4 w-4 rounded-sm" />
          <Skeleton className="h-3.5" style={{ width: `${18 + ((i * 29) % 26)}%` }} />
          <Skeleton className="ml-auto h-3.5 w-16" />
          <Skeleton className="h-3.5 w-20" />
        </div>
      ))}
    </div>
  );
}

/**
 * One hairline-divided strip of figures. Every cell is the same three lines —
 * label, value, hint — so the numbers always sit on the same baseline.
 */
export function StatStrip({ items, className }: { items: Array<{ label: ReactNode; value: ReactNode; hint?: ReactNode; onClick?: () => void }>; className?: string }) {
  return (
    // Flex, not grid: five tiles in a four-column grid left the last one alone
    // beside three empty cells. Here the tiles on the final row simply grow to
    // fill it, at every width, so the strip never reads as a card grid with a
    // hole in it. The -px offsets tuck each cell's own rules under the container's
    // border, which a plain `border-l` can't do once the row wraps.
    <div className={cn('overflow-hidden rounded-lg border border-line bg-card shadow-hairline', className)} data-strip>
      <div className="-ml-px -mt-px flex flex-wrap">
        {items.map((item, i) => {
          const inner = (
            <>
              <div className="text-micro font-semibold uppercase text-ink-3">{item.label}</div>
              <div className="tabular mt-1 font-display text-[26px] leading-8 text-ink">{item.value}</div>
              <div className="mt-0.5 min-h-[18px] text-meta text-ink-2">{item.hint}</div>
            </>
          );
          const cell = 'min-w-[150px] flex-1 border-l border-t border-line px-5 py-4';
          return item.onClick ? (
            <button key={i} type="button" onClick={item.onClick} className={cn(cell, 'text-left transition-colors hover:bg-hover/60')}>
              {inner}
            </button>
          ) : (
            <div key={i} className={cell}>
              {inner}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function EmptyState({ icon, title, children, actions, className, compact }: { icon?: ReactNode; title: ReactNode; children?: ReactNode; actions?: ReactNode; className?: string; compact?: boolean }) {
  return (
    <div className={cn('flex flex-col items-center justify-center text-center animate-rise-in', compact ? 'px-4 py-10' : 'px-6 py-16', className)}>
      {icon && <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-sunken text-ink-2">{icon}</div>}
      <h3 className={cn('font-display text-ink', compact ? 'text-[20px] leading-7' : 'text-display-sm')}>{title}</h3>
      {children && <div className="mt-1.5 max-w-md text-body text-ink-2 text-pretty">{children}</div>}
      {actions && <div className="mt-5 flex flex-wrap items-center justify-center gap-2">{actions}</div>}
    </div>
  );
}

/** Label/value rows in a facts rail. One grid for every row, so values line up. */
export function FactRow({ label, children, className, align = 'center' }: { label: ReactNode; children: ReactNode; className?: string; align?: 'center' | 'start' }) {
  // The slug is what the record shortcuts (A for owner, D for close date) aim at,
  // so a fact gains a keyboard route just by being labelled — no ref threading
  // through every record page's rail.
  const fact = typeof label === 'string' ? label.toLowerCase().replace(/\s+/g, '-') : undefined;
  return (
    <div data-fact={fact} className={cn('grid min-h-8 grid-cols-[104px_minmax(0,1fr)] gap-2', align === 'center' ? 'items-center' : 'items-start pt-1', className)}>
      <div className="truncate text-ui text-ink-3" title={typeof label === 'string' ? label : undefined}>
        {label}
      </div>
      <div className="flex min-w-0 items-center">{children}</div>
    </div>
  );
}

/** A record page: main column plus a 320px facts rail that stacks on small screens. */
export function DetailLayout({ children, rail, className }: { children: ReactNode; rail?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-6 px-5 py-6 sm:px-8 lg:flex-row lg:items-start', className)}>
      <div className="min-w-0 flex-1">{children}</div>
      {rail && <aside className="w-full shrink-0 lg:sticky lg:top-6 lg:w-[320px]">{rail}</aside>}
    </div>
  );
}
