import { cn } from './cn';

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
export const MOD = isMac ? '⌘' : 'Ctrl';

const LABELS: Record<string, string> = { mod: MOD, shift: '⇧', alt: isMac ? '⌥' : 'Alt', enter: '↵', esc: 'Esc', space: 'Space', up: '↑', down: '↓', left: '←', right: '→' };

/** <Kbd keys="mod+k" /> or <Kbd>C</Kbd>. Shortcuts live in menus sparingly — the palette and ? sheet are their home. */
export function Kbd({ keys, children, className, tone = 'default' }: { keys?: string; children?: string; className?: string; tone?: 'default' | 'inverse' }) {
  const parts = keys ? keys.split('+').map(k => LABELS[k.toLowerCase()] ?? k.toUpperCase()) : [children ?? ''];
  return (
    <span className={cn('inline-flex items-center gap-0.5', className)}>
      {parts.map((p, i) => (
        <kbd
          key={i}
          className={cn(
            'inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-xs px-1 font-sans text-[11px] font-medium',
            tone === 'inverse' ? 'bg-on-accent/20 text-on-accent' : 'bg-sunken text-ink-3 shadow-key',
          )}
        >
          {p}
        </kbd>
      ))}
    </span>
  );
}
