import { Check } from '@phosphor-icons/react';
import { Link } from 'react-router-dom';
import type { ListTasksOutputType } from 'zitejs/api';
import { cn } from '../../ui/cn';
import { RecordIcon, TaskTypeGlyph } from '../../glyphs';
import { DUE_TONE, dueLabel, dueState, todayString } from '../../lib/format';
import type { Tone } from '../../ui/Chip';

/**
 * The pieces every task surface shares: the record a task hangs off, the
 * round tick that completes it, and how a due date is worded and toned.
 */

export type Task = ListTasksOutputType['tasks'][number];

export type Related = { kind: 'company' | 'contact' | 'deal' | 'lead'; id: string; name: string };

/** The record a task or activity belongs to — the deal first, because that is what a rep is working. */
export function relatedOf(row: {
  companyId?: string | null;
  companyName?: string | null;
  contactId?: string | null;
  contactName?: string | null;
  dealId?: string | null;
  dealName?: string | null;
  leadId?: string | null;
  leadName?: string | null;
}): Related | null {
  if (row.dealId) return { kind: 'deal', id: row.dealId, name: row.dealName || 'Deal' };
  if (row.contactId) return { kind: 'contact', id: row.contactId, name: row.contactName || 'Contact' };
  if (row.companyId) return { kind: 'company', id: row.companyId, name: row.companyName || 'Company' };
  if (row.leadId) return { kind: 'lead', id: row.leadId, name: row.leadName || 'Lead' };
  return null;
}

export const pathFor = (related: Related) => `/${related.kind === 'company' ? 'companies' : `${related.kind}s`}/${related.id}`;

/** The related record as a link with its kind glyph. Stops the click from opening the row behind it. */
export function RelatedLink({ related, className }: { related: Related | null; className?: string }) {
  if (!related) return <span className={cn('text-ink-3', className)}>—</span>;
  return (
    <Link
      to={pathFor(related)}
      onClick={e => e.stopPropagation()}
      className={cn('inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-sm px-1 py-0.5 -mx-1 text-ink-2 hover:bg-hover hover:text-ink', className)}
      title={related.name}
    >
      <RecordIcon kind={related.kind} size={14} />
      <span className="truncate">{related.name}</span>
    </Link>
  );
}

/** The tick. Optimistic everywhere it is used, so it has to feel instant. */
export function TaskCheck({ done, onToggle, disabled, label, className }: { done: boolean; onToggle: () => void; disabled?: boolean; label: string; className?: string }) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={done}
      aria-label={done ? `Reopen ${label}` : `Complete ${label}`}
      onClick={e => {
        e.stopPropagation();
        onToggle();
      }}
      className={cn(
        'flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border transition-colors',
        done ? 'border-success bg-success text-white dark:text-paper' : 'border-control text-transparent hover:border-accent hover:text-accent/40',
        disabled && 'cursor-not-allowed opacity-45',
        className,
      )}
    >
      <Check size={11} weight="bold" />
    </button>
  );
}

export const PRIORITY_TONE: Record<string, Tone> = { High: 'danger', Normal: 'neutral', Low: 'neutral' };

/** The due date as a person says it, in the tone the date deserves. */
export function DueCell({ day, done, today = todayString(), className }: { day: string | null | undefined; done?: boolean; today?: string; className?: string }) {
  if (!day) return <span className={cn('text-ink-3', className)}>No date</span>;
  const state = dueState(day, today);
  const tone = done ? 'neutral' : DUE_TONE[state];
  return (
    <span className={cn('tabular', tone === 'danger' ? 'text-danger' : tone === 'accent' ? 'text-accent' : tone === 'warning' ? 'text-warning' : 'text-ink-2', className)}>
      {dueLabel(day, today)}
    </span>
  );
}

export function TaskTitle({ task, className }: { task: Pick<Task, 'title' | 'type' | 'status'>; className?: string }) {
  return (
    <span className={cn('flex min-w-0 items-center gap-2', className)}>
      <TaskTypeGlyph type={task.type} />
      <span className={cn('truncate', task.status === 'Done' ? 'text-ink-3 line-through' : 'font-medium text-ink')}>{task.title}</span>
    </span>
  );
}
