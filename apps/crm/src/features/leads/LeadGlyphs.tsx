import { Clock, Fire } from '@phosphor-icons/react';
import { cn } from '../../ui/cn';
import { timeAgo } from '../../lib/format';

/**
 * The leads area's own marks. The fit score reads as a number with a three-bar
 * meter beside it — the same vocabulary as the deal stage meter — so nothing
 * needs a colour per rating.
 */
const FILLED = { Cold: 1, Warm: 2, Hot: 3 } as const;

export function LeadScore({ score, rating, className, showLabel = true, showScore = true }: { score: number; rating: 'Hot' | 'Warm' | 'Cold'; className?: string; showLabel?: boolean; showScore?: boolean }) {
  const filled = FILLED[rating] ?? 1;
  return (
    <span className={cn('inline-flex items-center gap-2', className)} title={`${rating} — scores ${score} out of 100`}>
      {showScore && <span className="tabular text-ui font-medium text-ink">{score}</span>}
      <span className="inline-flex shrink-0 items-end gap-[2px]" aria-hidden>
        {[0, 1, 2].map(i => (
          <span key={i} className={cn('w-[3px] rounded-[1px]', i < filled ? (rating === 'Hot' ? 'bg-accent' : 'bg-ink/70') : 'bg-line-strong')} style={{ height: 6 + i * 3 }} />
        ))}
      </span>
      {showLabel && <span className="text-meta text-ink-3">{rating}</span>}
    </span>
  );
}

/** A big version for the review deck, where the score is the first thing you read. */
export function LeadScoreDial({ score, rating }: { score: number; rating: 'Hot' | 'Warm' | 'Cold' }) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-lg border border-line bg-sunken">
        <span className="tabular font-display text-[22px] leading-6 text-ink">{score}</span>
        <span className="text-[10px] uppercase tracking-[0.08em] text-ink-3">/ 100</span>
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 text-ui font-semibold text-ink">
          {rating === 'Hot' && <Fire size={15} weight="fill" className="text-accent" />}
          {rating} fit
        </div>
        <LeadScore score={score} rating={rating} showLabel={false} showScore={false} className="mt-1" />
      </div>
    </div>
  );
}

/** "First reply in 4h" · "No response yet" once the org's window has passed. */
export function ResponseCell({ receivedAt, firstResponseAt, responseHours, neglected }: { receivedAt: string | null; firstResponseAt: string | null; responseHours: number; neglected: boolean }) {
  if (firstResponseAt) {
    const hours = receivedAt ? Math.max(0, (Date.parse(firstResponseAt) - Date.parse(receivedAt)) / 3_600_000) : null;
    return <span className="text-ink-2">{hours == null ? timeAgo(firstResponseAt) : hours < 1 ? 'Under an hour' : hours < 48 ? `${Math.round(hours)}h` : `${Math.round(hours / 24)}d`}</span>;
  }
  if (neglected) {
    return (
      <span className="inline-flex items-center gap-1 text-warning" title={`Nobody has replied in ${responseHours} hours`}>
        <Clock size={13} /> No response yet
      </span>
    );
  }
  return <span className="text-ink-3">Not yet</span>;
}
