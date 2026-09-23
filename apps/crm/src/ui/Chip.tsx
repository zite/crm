import type { ReactNode } from 'react';
import { cn } from './cn';
import { PIGMENTS, TAG_COLORS, type TagColor } from '@project/shared/constants';
import { hashIndex } from '@project/shared/format';

export type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info';

const TONES: Record<Tone, string> = {
  neutral: 'bg-sunken text-ink-2',
  accent: 'bg-accent/10 text-accent dark:bg-accent/15',
  success: 'bg-success/10 text-success dark:bg-success/15',
  warning: 'bg-warning/10 text-warning dark:bg-warning/15',
  danger: 'bg-danger/10 text-danger dark:bg-danger/15',
  info: 'bg-info/10 text-info dark:bg-info/15',
};

/** A status or fact. Colour means something — don't use it for decoration. */
export function Badge({ tone = 'neutral', icon, children, className, dot }: { tone?: Tone; icon?: ReactNode; children: ReactNode; className?: string; dot?: boolean }) {
  return (
    <span className={cn('inline-flex h-6 max-w-full items-center gap-1.5 truncate rounded-sm px-2 text-meta font-medium', TONES[tone], className)}>
      {dot && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" />}
      {icon}
      <span className="truncate">{children}</span>
    </span>
  );
}

/** A count beside a label (tabs, sections, lanes). */
export function Count({ children, tone = 'neutral', className }: { children: ReactNode; tone?: Tone; className?: string }) {
  return <span className={cn('tabular inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-meta font-medium', TONES[tone], className)}>{children}</span>;
}

const TAG_STYLES: Record<TagColor, string> = {
  slate: 'text-[#46566b] bg-[#46566b]/10 dark:text-[#a8bdd6] dark:bg-[#a8bdd6]/15',
  clay: 'text-[#8a5136] bg-[#8a5136]/10 dark:text-[#e0a789] dark:bg-[#e0a789]/15',
  moss: 'text-[#4b6b34] bg-[#4b6b34]/10 dark:text-[#b2cf92] dark:bg-[#b2cf92]/15',
  plum: 'text-[#6b4470] bg-[#6b4470]/10 dark:text-[#d0a9d6] dark:bg-[#d0a9d6]/15',
  ochre: 'text-[#7d5c14] bg-[#7d5c14]/10 dark:text-[#dcbc72] dark:bg-[#dcbc72]/15',
  teal: 'text-[#1f5f63] bg-[#1f5f63]/10 dark:text-[#8fc9cc] dark:bg-[#8fc9cc]/15',
  rose: 'text-[#8a3b4e] bg-[#8a3b4e]/10 dark:text-[#e29caa] dark:bg-[#e29caa]/15',
  navy: 'text-[#2c4577] bg-[#2c4577]/10 dark:text-[#a3bae6] dark:bg-[#a3bae6]/15',
};

export function TagChip({ name, color, onRemove, className }: { name: string; color?: string | null; onRemove?: () => void; className?: string }) {
  const key = (TAG_COLORS as readonly string[]).includes(color ?? '') ? (color as TagColor) : 'slate';
  return (
    <span className={cn('inline-flex h-6 max-w-full items-center gap-1 truncate rounded-sm px-2 text-meta font-medium', TAG_STYLES[key], className)}>
      <span className="truncate">{name}</span>
      {onRemove && (
        <button type="button" onClick={onRemove} aria-label={`Remove ${name}`} className="-mr-1 px-0.5 opacity-70 hover:opacity-100">
          ×
        </button>
      )}
    </span>
  );
}

/** A deterministic pigment for a company mark or chart series. */
export const pigmentFor = (seed: string) => PIGMENTS[hashIndex(seed || '?', PIGMENTS.length)];
