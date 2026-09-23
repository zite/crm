import { useQuery, type UseQueryOptions } from '@tanstack/react-query';
import { listActivities, type ListActivitiesInputType, type ListActivitiesOutputType } from 'zitejs/api';
import { daysFromToday, todayString } from '../../lib/format';

/**
 * Activities read across the organization — the meetings agenda and the
 * activity log.
 *
 * The key sits under the `timeline` root on purpose: every write that touches
 * an activity already invalidates `timeline`, so logging a call from a record
 * page refreshes these lists too.
 */

export type Activity = ListActivitiesOutputType['activities'][number];
export type Meeting = Activity;

export const activityKey = (input: ListActivitiesInputType) => ['timeline', 'activities', input] as const;

export function useActivities(input: ListActivitiesInputType, options?: Partial<UseQueryOptions<ListActivitiesOutputType>>) {
  const withToday = { today: todayString(), ...input };
  return useQuery({ queryKey: activityKey(withToday), queryFn: () => listActivities(withToday), ...options });
}

/** A meeting's local calendar day, so a 7pm start never lands on tomorrow. */
export const localDay = (iso: string) => new Date(iso).toLocaleDateString('en-CA');

/** A location is a join link when it is a URL; otherwise it is a room or a note. */
export function joinUrl(location: string | null | undefined) {
  const value = (location ?? '').trim();
  return /^https?:\/\/\S+$/i.test(value) ? value : null;
}

export function meetingMinutes(meeting: Pick<Activity, 'durationMinutes' | 'occurredAt' | 'endsAt'>) {
  if (meeting.durationMinutes) return meeting.durationMinutes;
  if (meeting.endsAt) return Math.max(0, Math.round((Date.parse(meeting.endsAt) - Date.parse(meeting.occurredAt)) / 60_000));
  return null;
}

export const OUTCOME_TONE: Record<string, 'success' | 'danger' | 'info' | 'neutral'> = {
  Completed: 'success',
  Connected: 'success',
  Scheduled: 'info',
  'No Show': 'danger',
  Canceled: 'danger',
};

/**
 * The name of a day band: "Today", "Tomorrow", "Yesterday", or the weekday when it
 * is inside this week. Past a week a weekday is ambiguous — three "Saturday"s down
 * one page — so it returns null and the caller uses the date itself.
 */
export function dayHeading(day: string, today: string) {
  const days = daysFromToday(day, today);
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days === -1) return 'Yesterday';
  if (days != null && Math.abs(days) < 7) return new Date(`${day}T00:00:00`).toLocaleDateString('en-US', { weekday: 'long' });
  return null;
}

/** Group activities into day bands, keeping the order they came in. */
export function groupByDay<T extends { occurredAt: string }>(rows: T[]) {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const day = localDay(row.occurredAt);
    if (!map.has(day)) map.set(day, []);
    map.get(day)!.push(row);
  }
  return [...map.entries()].map(([day, items]) => ({ day, items }));
}
