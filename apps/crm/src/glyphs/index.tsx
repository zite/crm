import { Buildings, CalendarBlank, ChatCircleDots, CheckCircle, Clock, EnvelopeSimple, LinkedinLogo, NotePencil, Phone, Prohibit, Trophy, User, XCircle } from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import { cn } from '../ui/cn';
import { Badge, pigmentFor, type Tone } from '../ui/Chip';
import { useWorkspace } from '../lib/workspace';
import { initials } from '@project/shared/format';
import type { ActivityKind, DealStatus, LeadStatus, TaskType } from '@project/shared/constants';

/**
 * The CRM's own marks. Companies are squares with a monogram, people are
 * circles (ui/Avatar), a pipeline is a run of filling bars, and money is
 * always set in tabular figures through <Money>.
 */

const MARK_SIZES = { xs: 'h-5 w-5 rounded-xs text-[9px]', sm: 'h-6 w-6 rounded-sm text-[10px]', md: 'h-8 w-8 rounded-md text-[12px]', lg: 'h-10 w-10 rounded-md text-[14px]', xl: 'h-14 w-14 rounded-lg text-[20px]' };

export function CompanyMark({ name, id, logoUrl, size = 'md', className }: { name?: string | null; id?: string | null; logoUrl?: string | null; size?: keyof typeof MARK_SIZES; className?: string }) {
  if (logoUrl) return <img src={logoUrl} alt="" className={cn('shrink-0 border border-line object-contain', MARK_SIZES[size], className)} />;
  return (
    <span
      className={cn('inline-flex shrink-0 select-none items-center justify-center font-semibold uppercase text-white', MARK_SIZES[size], className)}
      style={{ backgroundColor: pigmentFor(id || name || '?') }}
      aria-hidden
    >
      {initials(name || '?').slice(0, 2)}
    </span>
  );
}

/** Money, always tabular. `muted0` greys a zero so a column of amounts reads as data. */
export function Money({ value, compact, cents, sign, muted0, className }: { value: number | null | undefined; compact?: boolean; cents?: boolean; sign?: boolean; muted0?: boolean; className?: string }) {
  const ws = useWorkspace();
  const zero = !value;
  return (
    <span className={cn('tabular', zero && muted0 && 'text-ink-3', className)}>{ws.money(value ?? 0, { compact, cents, sign })}</span>
  );
}

/**
 * A pipeline as a run of bars, filled up to the current stage — always beside
 * the stage's name, never on its own.
 */
export function StageMeter({ stageId, pipelineId, status, className }: { stageId: string | null; pipelineId: string | null; status?: DealStatus; className?: string }) {
  const ws = useWorkspace();
  const stages = ws.openStagesFor(pipelineId);
  const index = stages.findIndex(s => s.id === stageId);
  const tone = status === 'Won' ? 'bg-success' : status === 'Lost' ? 'bg-danger' : 'bg-accent';
  const filled = status === 'Won' ? stages.length : status === 'Lost' ? 0 : index + 1;
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-[2px]', className)} aria-hidden>
      {stages.map((s, i) => (
        <span key={s.id} className={cn('h-3 w-[3px] rounded-[1px]', i < filled ? tone : 'bg-line-strong')} />
      ))}
    </span>
  );
}

/** The stage path on a deal page. Click a segment to move the deal. */
export function StageTrack({ stageId, pipelineId, status, onPick, className, disabled }: { stageId: string | null; pipelineId: string | null; status: DealStatus; onPick?: (stageId: string) => void; className?: string; disabled?: boolean }) {
  const ws = useWorkspace();
  const stages = ws.openStagesFor(pipelineId);
  const index = stages.findIndex(s => s.id === stageId);
  const closedStage = ws.stageById(stageId);
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div className="flex items-stretch gap-1">
        {stages.map((s, i) => {
          const passed = status === 'Won' ? true : status === 'Lost' ? i < index : i < index;
          const current = status === 'Open' && i === index;
          return (
            <button
              key={s.id}
              type="button"
              disabled={disabled || !onPick}
              onClick={() => onPick?.(s.id)}
              title={s.name}
              className={cn('group min-w-0 flex-1 text-left', onPick && !disabled ? 'cursor-pointer' : 'cursor-default')}
            >
              <span
                className={cn(
                  'block h-1.5 rounded-full transition-colors',
                  current ? 'bg-accent' : passed ? (status === 'Won' ? 'bg-success' : 'bg-ink/70') : 'bg-line-strong',
                  onPick && !disabled && !current && 'group-hover:bg-accent/60',
                )}
              />
              <span className={cn('mt-1.5 block truncate text-meta', current ? 'font-semibold text-ink' : passed ? 'text-ink-2' : 'text-ink-3')}>{s.name}</span>
            </button>
          );
        })}
      </div>
      {status !== 'Open' && (
        <div className="flex items-center gap-1.5 text-meta">
          {status === 'Won' ? <Trophy size={14} className="text-success" weight="fill" /> : <Prohibit size={14} className="text-danger" />}
          <span className={status === 'Won' ? 'text-success' : 'text-danger'}>{status === 'Won' ? `Won in ${closedStage?.name ?? 'the final stage'}` : `Lost — ${closedStage?.name ?? 'closed'}`}</span>
        </div>
      )}
    </div>
  );
}

const ACTIVITY_ICONS: Record<ActivityKind, ReactNode> = {
  Note: <NotePencil size={15} />,
  Call: <Phone size={15} />,
  Email: <EnvelopeSimple size={15} />,
  Meeting: <CalendarBlank size={15} />,
};

export function ActivityGlyph({ kind, className, size = 28 }: { kind: ActivityKind; className?: string; size?: number }) {
  return (
    <span className={cn('inline-flex shrink-0 items-center justify-center rounded-full border border-line bg-card text-ink-2', className)} style={{ width: size, height: size }} aria-hidden>
      {ACTIVITY_ICONS[kind] ?? <ChatCircleDots size={15} />}
    </span>
  );
}

const TASK_ICONS: Record<TaskType, ReactNode> = {
  'To-do': <CheckCircle size={15} />,
  Call: <Phone size={15} />,
  Email: <EnvelopeSimple size={15} />,
  Meeting: <CalendarBlank size={15} />,
  LinkedIn: <LinkedinLogo size={15} />,
};

export function TaskTypeGlyph({ type, className }: { type: string; className?: string }) {
  return <span className={cn('inline-flex text-ink-3', className)}>{TASK_ICONS[type as TaskType] ?? <CheckCircle size={15} />}</span>;
}

export const DEAL_STATUS_TONE: Record<DealStatus, Tone> = { Open: 'neutral', Won: 'success', Lost: 'danger' };

export function DealStatusBadge({ status }: { status: DealStatus }) {
  if (status === 'Open') return null;
  return (
    <Badge tone={DEAL_STATUS_TONE[status]} icon={status === 'Won' ? <Trophy size={13} weight="fill" /> : <XCircle size={13} />}>
      {status}
    </Badge>
  );
}

export const LEAD_STATUS_TONE: Record<LeadStatus, Tone> = { New: 'accent', Working: 'info', Nurturing: 'warning', Qualified: 'success', Disqualified: 'neutral' };

export function LeadStatusBadge({ status }: { status: LeadStatus }) {
  return (
    <Badge tone={LEAD_STATUS_TONE[status] ?? 'neutral'} dot>
      {status}
    </Badge>
  );
}

/** "Stalled 12d" — an open deal sitting in a stage past its limit. */
export function StalledBadge({ days, className }: { days: number; className?: string }) {
  if (days <= 0) return null;
  return (
    <Badge tone="warning" icon={<Clock size={13} />} className={className}>
      Stalled {days}d
    </Badge>
  );
}

export function RecordIcon({ kind, size = 15, className }: { kind: 'company' | 'contact' | 'deal' | 'lead'; size?: number; className?: string }) {
  const icon = { company: <Buildings size={size} />, contact: <User size={size} />, deal: <Trophy size={size} />, lead: <ChatCircleDots size={size} /> }[kind];
  return <span className={cn('inline-flex text-ink-3', className)}>{icon}</span>;
}

/** The organization mark in the top bar: their logo, else a monogram in ink. */
export function OrgMark({ name, logoUrl, className }: { name: string; logoUrl?: string | null; className?: string }) {
  if (logoUrl) return <img src={logoUrl} alt="" className={cn('h-7 w-7 rounded-md border border-line object-contain', className)} />;
  return (
    <span className={cn('inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary text-[12px] font-semibold uppercase text-on-primary', className)} aria-hidden>
      {initials(name).slice(0, 2)}
    </span>
  );
}
