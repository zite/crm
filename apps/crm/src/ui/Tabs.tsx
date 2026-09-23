import { NavLink } from 'react-router-dom';
import type { ReactNode } from 'react';
import { cn } from './cn';
import { Count } from './Chip';

export type TabItem = { value: string; label: ReactNode; count?: number | null; to?: string; end?: boolean };

/**
 * Underline tabs. With `to` they are router links (the URL decides the tab);
 * otherwise they call onChange. A tab row never changes the header above it.
 */
export function Tabs({ items, value, onChange, end, className }: { items: TabItem[]; value?: string; onChange?: (v: string) => void; end?: ReactNode; className?: string }) {
  const base = 'relative -mb-px flex h-10 items-center gap-2 border-b-2 px-0.5 text-ui font-medium transition-colors whitespace-nowrap';
  const inactive = 'border-transparent text-ink-2 hover:text-ink';
  const active = 'border-accent text-ink';
  return (
    <div className={cn('flex items-end gap-5 overflow-x-auto no-scrollbar', className)}>
      {items.map(item =>
        item.to ? (
          <NavLink key={item.value} to={item.to} end={item.end} className={({ isActive }) => cn(base, isActive ? active : inactive)}>
            {({ isActive }) => (
              <>
                {item.label}
                {item.count != null && <Count tone={isActive ? 'accent' : 'neutral'}>{item.count}</Count>}
              </>
            )}
          </NavLink>
        ) : (
          <button key={item.value} type="button" onClick={() => onChange?.(item.value)} className={cn(base, value === item.value ? active : inactive)}>
            {item.label}
            {item.count != null && <Count tone={value === item.value ? 'accent' : 'neutral'}>{item.count}</Count>}
          </button>
        ),
      )}
      {end && <div className="ml-auto flex items-center gap-2 pb-1.5">{end}</div>}
    </div>
  );
}
