import { CaretDown, DotsThree, Plus } from '@phosphor-icons/react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from '../../ui/Button';
import { cn } from '../../ui/cn';
import { Menu, MenuContent, MenuTrigger } from '../../ui/Menu';
import { Skeleton } from '../../ui/Layout';

/**
 * The shapes every settings section is made of. Settings is a reading surface,
 * not a ledger: one column at reading width, hairline-separated rows, a title
 * and a sentence of explanation above each group. Nothing here is a card grid.
 */

export function SectionHead({ title, description, actions }: { title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end gap-x-5 gap-y-3 border-b border-line pb-5">
      <div className="min-w-[min(100%,240px)] flex-1">
        <h1 className="font-display text-[26px] leading-8 text-ink sm:text-[30px] sm:leading-9">{title}</h1>
        {description && <p className="mt-1.5 max-w-2xl text-body text-ink-2 text-pretty">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/** A titled group inside a section. `note` is the sentence that explains why it is here. */
export function Group({ title, note, action, children, className }: { title?: ReactNode; note?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn('flex flex-col gap-3', className)}>
      {(title || action) && (
        <div className="flex min-h-8 items-baseline gap-3">
          {title && <h2 className="text-title font-semibold text-ink">{title}</h2>}
          {action && <div className="ml-auto flex items-center gap-1.5 self-center">{action}</div>}
        </div>
      )}
      {note && <p className="-mt-1 max-w-2xl text-meta text-ink-2 text-pretty">{note}</p>}
      {children}
    </section>
  );
}

/** A label/description on the left, the control on the right; stacks under 640px. */
export function SettingRow({ label, hint, htmlFor, children, className, align = 'center' }: { label: ReactNode; hint?: ReactNode; htmlFor?: string; children: ReactNode; className?: string; align?: 'center' | 'start' }) {
  return (
    <div className={cn('grid gap-2 border-b border-line py-3.5 last:border-b-0 sm:grid-cols-[minmax(0,220px)_minmax(0,1fr)] sm:gap-6', align === 'start' ? 'sm:items-start' : 'sm:items-center', className)}>
      <div className="min-w-0">
        <label htmlFor={htmlFor} className="block text-ui font-medium text-ink">
          {label}
        </label>
        {hint && <p className="mt-0.5 text-meta text-ink-2 text-pretty">{hint}</p>}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** Hairline-separated rows on paper — the editorial list settings uses instead of cards. */
export function RowList({ children, className, empty }: { children: ReactNode; className?: string; empty?: ReactNode }) {
  const items = Array.isArray(children) ? children.filter(Boolean) : children;
  const isEmpty = Array.isArray(items) ? items.length === 0 : !items;
  if (isEmpty && empty) return <div className="rounded-lg border border-dashed border-line px-5 py-8 text-center text-ui text-ink-2">{empty}</div>;
  return <div className={cn('overflow-hidden rounded-lg border border-line bg-card shadow-hairline', className)}>{items}</div>;
}

export function Row({ children, className, onClick }: { children: ReactNode; className?: string; onClick?: () => void }) {
  const inner = <div className={cn('flex min-h-[54px] items-center gap-3 border-b border-line px-4 py-2.5 last:border-b-0', onClick && 'cursor-pointer transition-colors hover:bg-hover/60', className)}>{children}</div>;
  return onClick ? (
    <div role="button" tabIndex={0} onClick={onClick} onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onClick())} className="outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
      {inner}
    </div>
  ) : (
    inner
  );
}

/** The ⋯ menu a row uses for its secondary actions, always visible on touch. */
export function RowMenu({ children, label = 'More' }: { children: ReactNode; label?: string }) {
  return (
    <Menu>
      <MenuTrigger asChild>
        <Button variant="ghost" size="sm" icon aria-label={label}>
          <DotsThree size={18} weight="bold" />
        </Button>
      </MenuTrigger>
      <MenuContent align="end">{children}</MenuContent>
    </Menu>
  );
}

/**
 * The bar that appears once something has changed. It sits above the fold of
 * the page rather than at the bottom of a long form, so the person never has
 * to hunt for the button that saves what they just typed.
 */
export function SaveBar({ dirty, saving, onSave, onReset, label = 'Save changes' }: { dirty: boolean; saving?: boolean; onSave: () => void; onReset?: () => void; label?: string }) {
  if (!dirty) return null;
  return (
    <div className="sticky bottom-4 z-10 mt-2 flex items-center gap-3 rounded-lg border border-line-strong bg-card px-4 py-3 shadow-pop animate-rise-in">
      <span className="min-w-0 flex-1 truncate text-ui text-ink-2">You have unsaved changes</span>
      {onReset && (
        <Button variant="ghost" size="sm" onClick={onReset} disabled={saving}>
          Discard
        </Button>
      )}
      <Button variant="primary" size="sm" onClick={onSave} loading={saving}>
        {label}
      </Button>
    </div>
  );
}

export function AddButton({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <Button variant="secondary" size="sm" leading={<Plus size={15} weight="bold" />} onClick={onClick}>
      {children}
    </Button>
  );
}

/** A skeleton shaped like a settings section, not a spinner. */
export function SectionSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-6">
      <div className="border-b border-line pb-5">
        <Skeleton className="h-7 w-52" />
        <Skeleton className="mt-3 h-4 w-[min(100%,420px)]" />
      </div>
      <div className="flex flex-col gap-4">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="grid gap-2 sm:grid-cols-[minmax(0,220px)_minmax(0,1fr)] sm:gap-6">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-9 w-full max-w-sm" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** A read-only value with a copy button — for things recorded automatically. */
export function ReadOnlyValue({ value, empty, onCopy }: { value: string | null; empty: string; onCopy?: () => void }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  if (!value) return <p className="text-ui text-ink-3">{empty}</p>;
  return (
    <div className="flex items-center gap-2">
      <span className="min-w-0 flex-1 truncate rounded-md border border-line bg-sunken px-2.5 py-2 text-ui text-ink-2">{value}</span>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => {
          onCopy?.();
          setCopied(true);
          timer.current = window.setTimeout(() => setCopied(false), 1600);
        }}
      >
        {copied ? 'Copied' : 'Copy'}
      </Button>
    </div>
  );
}

/** A disclosure for the long explanation a setting sometimes needs. */
export function Explainer({ summary, children }: { summary: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-line bg-sunken/60">
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} className="flex w-full items-center gap-2 px-4 py-3 text-left text-ui font-medium text-ink">
        <span className="flex-1">{summary}</span>
        <CaretDown size={14} className={cn('shrink-0 text-ink-3 transition-transform', open && 'rotate-180')} />
      </button>
      {open && <div className="border-t border-line px-4 py-3 text-meta text-ink-2 [&_p+p]:mt-2">{children}</div>}
    </div>
  );
}
