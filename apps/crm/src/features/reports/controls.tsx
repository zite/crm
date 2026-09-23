import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { periodEnd, periodLabel, periodStart, shiftPeriod, type PeriodKind } from '@project/shared/dates';
import { useWorkspace } from '../../lib/workspace';

/**
 * The one control bar behind all six reports: which period, which pipeline,
 * whose numbers. It lives above the tab row, so moving between reports keeps
 * the question you were asking.
 *
 * The period is stored as an offset from the current one ("this quarter",
 * "last quarter") rather than a fixed date, so a report bookmarked today still
 * means the same thing tomorrow.
 */

export type WhoScope = { kind: 'everyone' } | { kind: 'me' } | { kind: 'team'; id: string } | { kind: 'member'; id: string };

export type ReportControlState = {
  period: PeriodKind;
  offset: number;
  pipelineId: string | null;
  who: WhoScope;
};

export type ReportControls = ReportControlState & {
  set: (patch: Partial<ReportControlState>) => void;
  /** The first and last day of the chosen period, and how to name it. */
  from: string;
  to: string;
  label: string;
  /** What the endpoints take: only the keys that are actually narrowed. */
  query: { period: PeriodKind; periodStart: string; pipelineId?: string; teamId?: string; ownerIds?: string[]; today: string };
  whoLabel: string;
  isNarrowed: boolean;
  reset: () => void;
};

const STORAGE_KEY = 'crm.reports.controls';
const Ctx = createContext<ReportControls | null>(null);

function readStored(): Partial<ReportControlState> | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Partial<ReportControlState>) : null;
  } catch {
    return null;
  }
}

export function ReportControlsProvider({ children }: { children: ReactNode }) {
  const ws = useWorkspace();
  const canSeeTeamByDefault = ws.can('quotas.manage');

  const [state, setState] = useState<ReportControlState>(() => {
    const stored = readStored();
    return {
      period: stored?.period === 'Month' || stored?.period === 'Year' ? stored.period : 'Quarter',
      offset: typeof stored?.offset === 'number' ? Math.max(-24, Math.min(8, stored.offset)) : 0,
      pipelineId: typeof stored?.pipelineId === 'string' ? stored.pipelineId : null,
      who: stored?.who ?? (canSeeTeamByDefault ? { kind: 'everyone' } : { kind: 'me' }),
    };
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* private window */
    }
  }, [state]);

  const set = useCallback((patch: Partial<ReportControlState>) => setState(current => ({ ...current, ...patch })), []);
  const reset = useCallback(() => setState({ period: 'Quarter', offset: 0, pipelineId: null, who: canSeeTeamByDefault ? { kind: 'everyone' } : { kind: 'me' } }), [canSeeTeamByDefault]);

  const value = useMemo<ReportControls>(() => {
    const fiscal = ws.settings.fiscalYearStartMonth;
    const from = shiftPeriod(periodStart(ws.today, state.period, fiscal), state.period, state.offset);
    const to = periodEnd(from, state.period);
    const who = state.who;
    const ownerIds = who.kind === 'me' ? [ws.me.id] : who.kind === 'member' ? [who.id] : undefined;
    const teamId = who.kind === 'team' ? who.id : undefined;
    const whoLabel =
      who.kind === 'everyone'
        ? 'Everyone'
        : who.kind === 'me'
          ? 'Just me'
          : who.kind === 'team'
            ? ws.teams.find(team => team.id === who.id)?.name ?? 'Team'
            : ws.memberName(who.id);
    return {
      ...state,
      set,
      reset,
      from,
      to,
      label: periodLabel(from, state.period, fiscal),
      query: {
        period: state.period,
        periodStart: from,
        ...(state.pipelineId ? { pipelineId: state.pipelineId } : {}),
        ...(teamId ? { teamId } : {}),
        ...(ownerIds ? { ownerIds } : {}),
        today: ws.today,
      },
      whoLabel,
      isNarrowed: who.kind !== 'everyone' || Boolean(state.pipelineId),
    };
  }, [state, set, reset, ws]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useReportControls() {
  const value = useContext(Ctx);
  if (!value) throw new Error('useReportControls must be used inside ReportControlsProvider');
  return value;
}

/** The pipeline a report needs when it can only describe one at a time. */
export function useRequiredPipeline() {
  const controls = useReportControls();
  const ws = useWorkspace();
  return controls.pipelineId ?? ws.defaultPipeline?.id ?? '';
}
