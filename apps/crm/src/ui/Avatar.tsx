import { cn } from './cn';
import { initials } from '@project/shared/format';
import { pigmentFor } from './Chip';

export type Person = { id?: string; name?: string | null; email?: string | null; avatarUrl?: string | null; color?: string | null };

const SIZES = { xs: 'h-5 w-5 text-[9px]', sm: 'h-6 w-6 text-[10px]', md: 'h-7 w-7 text-[11px]', lg: 'h-9 w-9 text-[13px]', xl: 'h-14 w-14 text-[18px]' };

/** People are round and carry their own colour; companies are square (see glyphs/CompanyMark). */
export function Avatar({ person, size = 'md', className }: { person?: Person | null; size?: keyof typeof SIZES; className?: string }) {
  const name = person?.name || person?.email || '';
  const color = person?.color || pigmentFor(person?.id || name || '?');
  if (person?.avatarUrl) {
    return <img src={person.avatarUrl} alt={name} className={cn('shrink-0 rounded-full object-cover', SIZES[size], className)} />;
  }
  return (
    <span
      className={cn('inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold uppercase tracking-tight text-white', SIZES[size], className)}
      style={{ backgroundColor: color }}
      aria-hidden
    >
      {initials(name)}
    </span>
  );
}

export function Unassigned({ size = 'md', className }: { size?: keyof typeof SIZES; className?: string }) {
  return (
    <span className={cn('inline-flex shrink-0 items-center justify-center rounded-full border border-dashed border-control text-ink-3', SIZES[size], className)} aria-hidden>
      ?
    </span>
  );
}

export function AvatarStack({ people, max = 3, size = 'sm' }: { people: Person[]; max?: number; size?: keyof typeof SIZES }) {
  const shown = people.slice(0, max);
  const rest = people.length - shown.length;
  return (
    <span className="flex items-center -space-x-1.5">
      {shown.map((p, i) => (
        <Avatar key={p.id ?? i} person={p} size={size} className="ring-2 ring-card" />
      ))}
      {rest > 0 && <span className={cn('inline-flex items-center justify-center rounded-full bg-sunken font-medium text-ink-2 ring-2 ring-card', SIZES[size])}>+{rest}</span>}
    </span>
  );
}
