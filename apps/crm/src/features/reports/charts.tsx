import { ChartLine } from '@phosphor-icons/react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { cn } from '../../ui/cn';

/**
 * Chart plumbing, so every chart in Reports is drawn the same way: ink for the
 * main series, the pen for "this period", dashed hairline gridlines, an axis a
 * person can actually read, and an ink panel for the tooltip.
 *
 * Recharts writes colours into SVG attributes, which can't resolve a CSS
 * variable — so the tokens are read off the document and re-read whenever the
 * theme changes.
 */

export type ChartInk = {
  ink: string;
  ink2: string;
  ink3: string;
  accent: string;
  line: string;
  lineStrong: string;
  success: string;
  warning: string;
  danger: string;
  info: string;
  card: string;
  sunken: string;
};

const FALLBACK: ChartInk = {
  ink: 'rgb(29, 27, 24)',
  ink2: 'rgb(84, 79, 72)',
  ink3: 'rgb(107, 101, 92)',
  accent: 'rgb(29, 78, 128)',
  line: 'rgb(231, 226, 217)',
  lineStrong: 'rgb(212, 205, 193)',
  success: 'rgb(28, 118, 74)',
  warning: 'rgb(148, 90, 0)',
  danger: 'rgb(184, 50, 42)',
  info: 'rgb(44, 100, 140)',
  card: 'rgb(255, 255, 255)',
  sunken: 'rgb(241, 238, 232)',
};

const VARS: Record<keyof ChartInk, string> = {
  ink: '--ink',
  ink2: '--ink-2',
  ink3: '--ink-3',
  accent: '--accent',
  line: '--line',
  lineStrong: '--line-strong',
  success: '--success',
  warning: '--warning',
  danger: '--danger',
  info: '--info',
  card: '--card',
  sunken: '--sunken',
};

function readInk(): ChartInk {
  if (typeof window === 'undefined') return FALLBACK;
  const styles = getComputedStyle(document.documentElement);
  const out = {} as ChartInk;
  for (const [key, variable] of Object.entries(VARS) as Array<[keyof ChartInk, string]>) {
    const channels = styles.getPropertyValue(variable).trim();
    out[key] = channels ? `rgb(${channels.replace(/\s+/g, ', ')})` : FALLBACK[key];
  }
  return out;
}

/** The token palette as concrete colours, following the light/dark switch. */
export function useChartInk(): ChartInk {
  const [ink, setInk] = useState<ChartInk>(FALLBACK);
  useEffect(() => {
    const sync = () => setInk(readInk());
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);
  return ink;
}

/** Shared axis and grid props, so no chart invents its own tick size. */
export function useAxes(ink: ChartInk) {
  return useMemo(
    () => ({
      grid: <CartesianGrid strokeDasharray="3 3" stroke={ink.lineStrong} vertical={false} />,
      // `preserveStartEnd` + a real `minTickGap` is what keeps a twelve-month axis
      // readable at 390px: every tick shows when there is room, and recharts thins
      // them (keeping the first and last) when there isn't. `interval={0}` would
      // draw all twelve on top of each other.
      xAxis: { tick: { fill: ink.ink3, fontSize: 11 }, tickLine: false, axisLine: { stroke: ink.line }, interval: 'preserveStartEnd', minTickGap: 14 } as const,
      yAxis: { tick: { fill: ink.ink3, fontSize: 11 }, tickLine: false, axisLine: false, width: 56 } as const,
    }),
    [ink],
  );
}

export { CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis };

/** An ink panel, the way tooltips look everywhere else in the app. */
export function ChartTooltip({ title, rows }: { title: ReactNode; rows: Array<{ label: ReactNode; value: ReactNode; tone?: 'ink' | 'success' | 'danger' | 'accent' }> }) {
  return (
    <div className="pointer-events-none min-w-[140px] rounded-lg bg-primary px-3 py-2 text-on-primary shadow-pop">
      <div className="text-meta font-medium">{title}</div>
      <div className="mt-1 flex flex-col gap-0.5">
        {rows.map((row, i) => (
          <div key={i} className="flex items-center justify-between gap-4 text-meta">
            <span className="opacity-75">{row.label}</span>
            <span className="tabular font-medium">{row.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * A titled chart box with a fixed height, so a chart that has no data yet
 * leaves the same shaped hole as one that does.
 */
export function ChartFrame({ title, hint, action, height = 240, empty, emptyLabel, children, className }: { title: ReactNode; hint?: ReactNode; action?: ReactNode; height?: number; empty?: boolean; emptyLabel?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn('rounded-lg border border-line bg-card p-5 shadow-hairline sm:p-6', className)}>
      <div className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="text-title font-semibold text-ink">{title}</h3>
        {hint && <p className="min-w-0 flex-1 text-meta text-ink-2">{hint}</p>}
        {action && <div className="ml-auto">{action}</div>}
      </div>
      {empty ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-md bg-sunken text-center" style={{ height }}>
          <ChartLine size={22} weight="duotone" className="text-ink-3" />
          <p className="max-w-xs text-meta text-ink-2">{emptyLabel ?? 'Nothing closed in this period yet. Pick a wider period, or clear the filters.'}</p>
        </div>
      ) : (
        <div style={{ height }}>{children}</div>
      )}
    </section>
  );
}

/**
 * A bar list: the shape DESIGN prefers over a pie. Every row is a label, a
 * proportional bar and its figures, and colour is only ever meaning.
 */
export function BarList({
  rows,
  total,
  tone = 'ink',
  onSelect,
  emptyLabel = 'Nothing here yet.',
  className,
}: {
  rows: Array<{ key: string; label: ReactNode; value: number; figure: ReactNode; meta?: ReactNode; tone?: 'ink' | 'accent' | 'success' | 'danger' | 'warning' }>;
  total?: number;
  tone?: 'ink' | 'accent' | 'success' | 'danger' | 'warning';
  onSelect?: (key: string) => void;
  emptyLabel?: ReactNode;
  className?: string;
}) {
  const max = Math.max(total ?? 0, ...rows.map(row => row.value), 1);
  const fill: Record<string, string> = { ink: 'bg-primary/70', accent: 'bg-accent', success: 'bg-success', danger: 'bg-danger', warning: 'bg-warning' };
  if (!rows.length) return <p className="py-6 text-center text-meta text-ink-2">{emptyLabel}</p>;
  return (
    <ul className={cn('flex flex-col', className)}>
      {rows.map(row => {
        const body = (
          <>
            <div className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate text-ui text-ink">{row.label}</span>
              <span className="tabular shrink-0 text-ui font-medium text-ink">{row.figure}</span>
            </div>
            <div className="mt-1.5 flex items-center gap-2.5">
              <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-sunken">
                <span className={cn('block h-full rounded-full animate-bar-in', fill[row.tone ?? tone])} style={{ width: `${Math.max(row.value > 0 ? 2 : 0, (row.value / max) * 100)}%` }} />
              </span>
              {row.meta != null && <span className="tabular shrink-0 text-meta text-ink-3">{row.meta}</span>}
            </div>
          </>
        );
        return (
          <li key={row.key} className="border-b border-line last:border-b-0">
            {onSelect ? (
              <button type="button" onClick={() => onSelect(row.key)} className="w-full rounded-sm px-1 py-2.5 text-left transition-colors hover:bg-hover/60">
                {body}
              </button>
            ) : (
              <div className="px-1 py-2.5">{body}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** A number that drills through to the list behind it. */
export function DrillValue({ onClick, children, className, muted, title }: { onClick?: () => void; children: ReactNode; className?: string; muted?: boolean; title?: string }) {
  if (!onClick) return <span className={cn('tabular', muted && 'text-ink-3', className)}>{children}</span>;
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn('tabular rounded-xs px-0.5 underline decoration-transparent underline-offset-[3px] transition-colors hover:text-accent hover:decoration-accent/50', muted && 'text-ink-3', className)}
    >
      {children}
    </button>
  );
}
