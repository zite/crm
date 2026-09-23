import { useQuery, type UseQueryOptions } from '@tanstack/react-query';
import { getHome, type GetHomeOutputType } from 'zitejs/api';
import { todayString } from '../../lib/format';

/**
 * Home's one query. It lives under the `home` root, which every task, deal and
 * activity write already invalidates.
 */
export type HomeData = GetHomeOutputType;
export type HomeDeal = HomeData['attention']['stalled'][number];

export function useHome(options?: Partial<UseQueryOptions<HomeData>>) {
  const today = todayString();
  return useQuery({ queryKey: ['home', today], queryFn: () => getHome({ today }), ...options });
}

export function greeting(now = new Date()) {
  const hour = now.getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

/** "4 tasks due, 2 meetings and 19 new leads waiting." */
export function stateSentence(counts: { dueToday: number; overdue: number; newLeads: number }, meetingsToday: number) {
  const parts = [
    counts.dueToday ? `${counts.dueToday} ${counts.dueToday === 1 ? 'task' : 'tasks'} due` : null,
    counts.overdue ? `${counts.overdue} overdue` : null,
    meetingsToday ? `${meetingsToday} ${meetingsToday === 1 ? 'meeting' : 'meetings'}` : null,
    counts.newLeads ? `${counts.newLeads} new ${counts.newLeads === 1 ? 'lead' : 'leads'} waiting` : null,
  ].filter(Boolean) as string[];
  // Never name a time of day here: the greeting above already did, and it was wrong by evening.
  if (!parts.length) return 'Nothing is due and nothing is booked — a good moment to open a new conversation.';
  if (parts.length === 1) return `${parts[0]}.`;
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}.`;
}
