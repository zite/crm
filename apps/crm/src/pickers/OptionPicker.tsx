import { Check, MagnifyingGlass } from '@phosphor-icons/react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { cn } from '../ui/cn';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/Popover';

export type Option = { value: string; label: string; icon?: ReactNode; hint?: ReactNode; group?: string; keywords?: string; disabled?: boolean };

/**
 * One searchable list behind every picker in the app: keyboard-first (↑↓ to
 * move, Enter to choose, Esc to close), typed filtering when there are more
 * than seven options, and a footer slot for "Create …".
 */
export function OptionPicker({
  options,
  value,
  values,
  onSelect,
  onToggle,
  trigger,
  open,
  onOpenChange,
  align = 'start',
  placeholder = 'Search',
  empty = 'Nothing matches',
  footer,
  width = 260,
  multiple,
  className,
}: {
  options: Option[];
  value?: string | null;
  values?: string[];
  onSelect?: (value: string) => void;
  onToggle?: (value: string, selected: boolean) => void;
  trigger: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  align?: 'start' | 'end' | 'center';
  placeholder?: string;
  empty?: string;
  footer?: ReactNode;
  width?: number;
  multiple?: boolean;
  className?: string;
}) {
  const [uncontrolled, setUncontrolled] = useState(false);
  const isOpen = open ?? uncontrolled;
  const setOpen = onOpenChange ?? setUncontrolled;
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const selected = useMemo(() => new Set(values ?? (value ? [value] : [])), [values, value]);

  useEffect(() => {
    if (!isOpen) {
      setQuery('');
      setActive(0);
    }
  }, [isOpen]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(o => `${o.label} ${o.keywords ?? ''} ${o.group ?? ''}`.toLowerCase().includes(q));
  }, [options, query]);

  const groups = useMemo(() => {
    const map = new Map<string, Option[]>();
    for (const o of filtered) {
      const key = o.group ?? '';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(o);
    }
    return [...map.entries()];
  }, [filtered]);

  const flat = groups.flatMap(([, items]) => items);
  const searchable = options.length > 7;

  useEffect(() => {
    const el = listRef.current?.querySelector('[data-active="true"]');
    el?.scrollIntoView({ block: 'nearest' });
  }, [active, filtered.length]);

  const choose = (option: Option) => {
    if (option.disabled) return;
    if (multiple) {
      onToggle?.(option.value, !selected.has(option.value));
    } else {
      onSelect?.(option.value);
      setOpen(false);
    }
  };

  return (
    <Popover open={isOpen} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align={align} className={cn('p-0', className)} style={{ width }} onOpenAutoFocus={e => !searchable && e.preventDefault()}>
        <div
          onKeyDown={e => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive(a => Math.min(flat.length - 1, a + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive(a => Math.max(0, a - 1));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              const option = flat[active];
              if (option) choose(option);
            }
          }}
        >
          {searchable && (
            <div className="flex items-center gap-2 border-b border-line px-2.5">
              <MagnifyingGlass size={14} className="shrink-0 text-ink-3" />
              <input
                autoFocus
                value={query}
                onChange={e => {
                  setQuery(e.target.value);
                  setActive(0);
                }}
                placeholder={placeholder}
                className="h-9 w-full bg-transparent text-ui text-ink outline-none placeholder:text-ink-3"
              />
            </div>
          )}
          <div ref={listRef} className="max-h-[300px] overflow-y-auto p-1" role="listbox">
            {flat.length === 0 && <div className="px-2 py-6 text-center text-ui text-ink-3">{empty}</div>}
            {groups.map(([group, items]) => (
              <div key={group || 'default'}>
                {group && <div className="px-2 pb-1 pt-2 text-micro font-semibold uppercase text-ink-3">{group}</div>}
                {items.map(option => {
                  const index = flat.indexOf(option);
                  const isSelected = selected.has(option.value);
                  return (
                    <button
                      key={option.value}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      data-active={index === active}
                      disabled={option.disabled}
                      onMouseEnter={() => setActive(index)}
                      onClick={() => choose(option)}
                      className={cn(
                        'flex w-full items-center gap-2.5 rounded-sm px-2 py-1.5 text-left text-ui text-ink disabled:opacity-40',
                        index === active && 'bg-hover',
                      )}
                    >
                      {option.icon}
                      <span className="min-w-0 flex-1 truncate">{option.label}</span>
                      {option.hint && <span className="shrink-0 text-meta text-ink-3">{option.hint}</span>}
                      {isSelected && <Check size={14} weight="bold" className="shrink-0 text-accent" />}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
          {footer && <div className="border-t border-line p-1">{footer}</div>}
        </div>
      </PopoverContent>
    </Popover>
  );
}
