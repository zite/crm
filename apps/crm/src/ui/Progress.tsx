import { cn } from './cn';

/** A flat bar. Segments let a pipeline or quota show two tones in one track. */
export function ProgressBar({ value, max = 100, tone = 'accent', height = 6, className, segments }: { value?: number; max?: number; tone?: 'accent' | 'ink' | 'success' | 'warning' | 'danger'; height?: number; className?: string; segments?: Array<{ value: number; tone: 'accent' | 'ink' | 'success' | 'warning' | 'danger' }> }) {
  const bg: Record<string, string> = { accent: 'bg-accent', ink: 'bg-primary', success: 'bg-success', warning: 'bg-warning', danger: 'bg-danger' };
  const total = Math.max(1, max);
  return (
    <div className={cn('flex w-full overflow-hidden rounded-full bg-sunken', className)} style={{ height }}>
      {segments
        ? segments.map((s, i) => <div key={i} className={cn(bg[s.tone])} style={{ width: `${Math.max(0, Math.min(100, (s.value / total) * 100))}%` }} />)
        : <div className={cn('transition-[width] duration-300', bg[tone])} style={{ width: `${Math.max(0, Math.min(100, ((value ?? 0) / total) * 100))}%` }} />}
    </div>
  );
}

/** Small ring for probability and completion. */
export function ProgressRing({ value, size = 16, strokeWidth = 2.5, className, tone = 'accent' }: { value: number; size?: number; strokeWidth?: number; className?: string; tone?: 'accent' | 'ink' | 'success' }) {
  const r = (size - strokeWidth) / 2;
  const c = 2 * Math.PI * r;
  const stroke: Record<string, string> = { accent: 'stroke-accent', ink: 'stroke-ink', success: 'stroke-success' };
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className={cn('shrink-0 -rotate-90', className)} aria-hidden>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={strokeWidth} className="stroke-line-strong" />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={strokeWidth} strokeLinecap="round" className={stroke[tone]} strokeDasharray={c} strokeDashoffset={c * (1 - Math.max(0, Math.min(100, value)) / 100)} />
    </svg>
  );
}
