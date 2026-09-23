import { DotsThree, Funnel, X } from '@phosphor-icons/react';
import { useEffect, useRef, type ReactNode } from 'react';
import { Button } from '../ui/Button';
import { SearchField } from '../ui/Form';
import { cn } from '../ui/cn';
import { Menu, MenuContent, MenuTrigger } from '../ui/Menu';
import { useHotkeys } from '../lib/hotkeys';

/**
 * The strip above every list: filters on the left, then the count, then
 * search, the layout switch and a ⋯ menu. `/` focuses search.
 */
export function ListToolbar({
  start,
  count,
  countLabel = 'record',
  countLabelPlural,
  search,
  onSearch,
  layout,
  more,
  end,
  className,
}: {
  start?: ReactNode;
  count?: number;
  countLabel?: string;
  /** For nouns English doesn't pluralise with an 's' ("company" → "companies"). */
  countLabelPlural?: string;
  search?: string;
  onSearch?: (value: string) => void;
  layout?: ReactNode;
  more?: ReactNode;
  end?: ReactNode;
  className?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  useHotkeys({ '/': () => (onSearch ? inputRef.current?.focus() : false) });
  return (
    <div className={cn('flex flex-wrap items-center gap-2 border-b border-line bg-paper px-5 py-2.5 sm:px-8', className)}>
      <div className="flex flex-wrap items-center gap-1.5">{start}</div>
      {count != null && (
        <span className="tabular whitespace-nowrap text-meta text-ink-3">
          {count.toLocaleString('en-US')} {count === 1 ? countLabel : countLabelPlural ?? `${countLabel}s`}
        </span>
      )}
      <div className="ml-auto flex items-center gap-2">
        {onSearch && <SearchField inputRef={inputRef} value={search ?? ''} onChange={onSearch} placeholder="Search this list" className="w-[190px]" />}
        {layout}
        {end}
        {more && (
          <Menu>
            <MenuTrigger asChild>
              <Button variant="ghost" size="sm" icon aria-label="More actions">
                <DotsThree size={18} weight="bold" />
              </Button>
            </MenuTrigger>
            <MenuContent align="end">{more}</MenuContent>
          </Menu>
        )}
      </div>
    </div>
  );
}

/** Active filters as removable chips. Shown only when something is set. */
export function FilterChips({ chips, onClear, className }: { chips: Array<{ key: string; label: ReactNode; onRemove: () => void }>; onClear?: () => void; className?: string }) {
  if (!chips.length) return null;
  return (
    <div className={cn('flex flex-wrap items-center gap-1.5 border-b border-line bg-paper px-5 py-2 sm:px-8', className)}>
      <Funnel size={14} className="text-ink-3" />
      {chips.map(chip => (
        <span key={chip.key} className="inline-flex h-7 items-center gap-1.5 rounded-sm border border-line bg-card pl-2 pr-1 text-meta text-ink">
          {chip.label}
          <button type="button" onClick={chip.onRemove} aria-label="Remove filter" className="flex h-5 w-5 items-center justify-center rounded-xs text-ink-3 hover:bg-hover hover:text-ink">
            <X size={11} weight="bold" />
          </button>
        </span>
      ))}
      {onClear && (
        <Button variant="ghost" size="xs" onClick={onClear}>
          Clear all
        </Button>
      )}
    </div>
  );
}

/** Keeps a list's scroll position while the page under it re-renders. */
export function useRestoreScroll(ref: React.RefObject<HTMLElement>, key: string) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const saved = Number(sessionStorage.getItem(`crm.scroll.${key}`) ?? 0);
    if (saved) el.scrollTop = saved;
    const onScroll = () => sessionStorage.setItem(`crm.scroll.${key}`, String(el.scrollTop));
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [key, ref]);
}
