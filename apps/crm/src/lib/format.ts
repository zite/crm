import { periodLabel as sharedPeriodLabel, type PeriodKind } from '@project/shared/dates';

/**
 * Dates, durations and numbers as the CRM writes them. "Today" always comes
 * from the browser's local day so a label never disagrees with a count.
 */

export const todayString = () => new Date().toLocaleDateString('en-CA');

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const parseDay = (day: string) => new Date(`${day.slice(0, 10)}T00:00:00`);

/** 'Oct 30' — with the year when it isn't this one. */
export function shortDate(day: string | null | undefined) {
  if (!day) return '';
  const d = parseDay(String(day));
  const now = new Date();
  return `${MONTHS[d.getMonth()]} ${d.getDate()}${d.getFullYear() === now.getFullYear() ? '' : `, ${d.getFullYear()}`}`;
}

export function fullDate(day: string | null | undefined) {
  if (!day) return '';
  const d = parseDay(String(day));
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

export function dateTime(iso: string | null | undefined) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${time(iso)}`;
}

export function time(iso: string | null | undefined) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase().replace(' ', '');
}

/** '3m', '2h', 'Tue', 'Sep 12' — compact, for timelines and list cells. */
export function timeAgo(iso: string | null | undefined) {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  if (Number.isNaN(then)) return '';
  const minutes = Math.round(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.round(days / 7)}w ago`;
  return shortDate(new Date(then).toLocaleDateString('en-CA'));
}

export function daysFromToday(day: string | null | undefined, today = todayString()) {
  if (!day) return null;
  return Math.round((parseDay(String(day)).getTime() - parseDay(today).getTime()) / 86_400_000);
}

export type DueState = 'overdue' | 'today' | 'soon' | 'later' | 'none';

export function dueState(day: string | null | undefined, today = todayString()): DueState {
  const days = daysFromToday(day, today);
  if (days == null) return 'none';
  if (days < 0) return 'overdue';
  if (days === 0) return 'today';
  if (days <= 3) return 'soon';
  return 'later';
}

/** 'Overdue by 3 days' / 'Today' / 'Tomorrow' / 'Fri' / 'Oct 30'. */
export function dueLabel(day: string | null | undefined, today = todayString()) {
  const days = daysFromToday(day, today);
  if (days == null) return '';
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days === -1) return 'Yesterday';
  if (days < 0) return `${Math.abs(days)} days ago`;
  if (days < 7) return parseDay(String(day)).toLocaleDateString('en-US', { weekday: 'short' });
  return shortDate(day);
}

export const DUE_TONE: Record<DueState, 'danger' | 'warning' | 'neutral' | 'accent'> = { overdue: 'danger', today: 'accent', soon: 'warning', later: 'neutral', none: 'neutral' };

export function plural(n: number, one: string, many = `${one}s`) {
  return `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
}

export function percent(value: number, digits = 0) {
  return `${(value * 100).toFixed(digits)}%`;
}

export function compactNumber(n: number) {
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
}

export function duration(minutes: number | null | undefined) {
  if (!minutes) return '';
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

export function periodLabel(start: string, kind: PeriodKind, fiscalStartMonth = 1) {
  return sharedPeriodLabel(start, kind, fiscalStartMonth);
}

/** '09:30' → '9:30am'. */
export function clockLabel(hhmm: string | null | undefined) {
  if (!hhmm) return '';
  const [h, m] = hhmm.split(':').map(Number);
  const suffix = h >= 12 ? 'pm' : 'am';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, '0')}${suffix}`;
}
