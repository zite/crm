import { cn } from '../../ui/cn';
import { preview, stepKind, cumulativeDays, type Step } from './model';
import type { MergeContext } from '@project/shared/merge';

/**
 * A cadence, drawn twice over.
 *
 * `CadenceBar` is the compact version for a row: one tick per step, spaced by
 * the days between them, so you can see the shape of a sequence without
 * reading it.
 *
 * `CadenceTimeline` is the whole thing on one rail, rendered against a sample
 * contact — what someone actually receives, in the order they receive it.
 */

export function CadenceBar({ days, className }: { days: number[]; className?: string }) {
  if (!days.length) return <span className={cn('text-meta text-ink-3', className)}>No steps</span>;
  const span = Math.max(1, days[days.length - 1]);
  return (
    <span className={cn('relative inline-block h-3 w-16 shrink-0 align-middle', className)} aria-hidden>
      <span className="absolute left-0 right-0 top-1/2 h-px -translate-y-1/2 bg-line-strong" />
      {days.map((day, i) => (
        <span key={i} className="absolute top-1/2 h-2 w-[3px] -translate-y-1/2 rounded-[1px] bg-accent" style={{ left: `calc(${(day / span) * 100}% - ${(day / span) * 3}px)` }} />
      ))}
    </span>
  );
}

export function CadenceTimeline({ steps, ctx, className }: { steps: Step[]; ctx: MergeContext; className?: string }) {
  const days = cumulativeDays(steps);
  if (!steps.length) return null;
  return (
    <ol className={cn('flex flex-col', className)}>
      {steps.map((step, i) => {
        const meta = stepKind(step.kind);
        const subject = preview(step.subject, ctx);
        const body = preview(step.body, ctx);
        const note = preview(step.note, ctx);
        return (
          <li key={step.id} className="relative flex gap-4 pb-6 last:pb-0">
            <div className="flex w-14 shrink-0 flex-col items-end pt-0.5">
              <span className="text-micro font-semibold uppercase text-ink-3">Day {days[i]}</span>
            </div>
            <div className="relative flex flex-col items-center">
              <span className="z-10 flex h-7 w-7 items-center justify-center rounded-full border border-line bg-card text-ink-2">{meta.icon}</span>
              {i < steps.length - 1 && <span className="absolute top-7 h-[calc(100%+1.5rem-1.75rem)] w-px bg-line" />}
            </div>
            <div className="min-w-0 flex-1 pb-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-ui font-medium text-ink">{subject || `${meta.label} — no subject yet`}</span>
                <span className="text-meta text-ink-3">{meta.automatic ? 'Sent for you' : 'Task for the owner'}</span>
              </div>
              {body && <p className="mt-1.5 whitespace-pre-wrap text-body leading-6 text-ink-2">{body}</p>}
              {note && <p className="mt-1.5 rounded-sm border-l-2 border-line-strong bg-sunken px-3 py-2 text-meta text-ink-2">{note}</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
