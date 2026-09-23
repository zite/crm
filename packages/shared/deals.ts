import { diffDays } from './dates';
import type { DealStatus, ForecastCategory, StageKind } from './constants';

/**
 * Pure deal rules shared by the server, the board and reports, so a stalled
 * badge, a weighted total and a forecast bucket are computed one way.
 */

export type StageLike = { id: string; kind: StageKind; probability: number | null; rottingDays: number | null; position: number };

/** A deal's effective probability: its own override, else its stage's, else 0 (won 100, lost 0). */
export function effectiveProbability(status: DealStatus, override: number | null | undefined, stage: Pick<StageLike, 'probability'> | null | undefined): number {
  if (status === 'Won') return 100;
  if (status === 'Lost') return 0;
  const p = override ?? stage?.probability ?? 0;
  return Math.max(0, Math.min(100, Number(p) || 0));
}

export function weightedAmount(amount: number | null | undefined, probability: number) {
  return Math.round((Number(amount) || 0) * probability) / 100;
}

/** Days in the current stage, or null when unknown. */
export function daysInStage(stageEnteredAt: string | null | undefined, today: string): number | null {
  if (!stageEnteredAt) return null;
  return Math.max(0, diffDays(String(stageEnteredAt).slice(0, 10), today));
}

/** Stalled = open and in its stage longer than the stage's limit. Returns days over, or 0. */
export function stalledBy(status: DealStatus, stageEnteredAt: string | null | undefined, stage: Pick<StageLike, 'rottingDays'> | null | undefined, today: string): number {
  if (status !== 'Open' || !stage?.rottingDays) return 0;
  const days = daysInStage(stageEnteredAt, today);
  if (days == null) return 0;
  return days > stage.rottingDays ? days - stage.rottingDays : 0;
}

/** The forecast bucket a deal falls in when nobody set one explicitly. */
export function defaultForecastCategory(status: DealStatus, probability: number): ForecastCategory {
  if (status !== 'Open') return 'Closed';
  if (probability >= 80) return 'Commit';
  if (probability >= 50) return 'Best Case';
  return 'Pipeline';
}

/** Status follows the stage kind: moving into a Won stage wins the deal. */
export const statusForStageKind = (kind: StageKind): DealStatus => (kind === 'Won' ? 'Won' : kind === 'Lost' ? 'Lost' : 'Open');

/** Board ordering: a position between two neighbours (fractional indexing, good for thousands of moves). */
export function positionBetween(before: number | null | undefined, after: number | null | undefined): number {
  if (before == null && after == null) return 1000;
  if (before == null) return (after as number) - 1000;
  if (after == null) return before + 1000;
  return (before + after) / 2;
}
