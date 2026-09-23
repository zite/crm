import { WEEKDAYS_SHORT, formatTime, weeklyMinutes, type Availability, type LocationKind } from '@project/shared/availability';

/**
 * Small, shared bits of wording for the meetings area. Kept here rather than in
 * a component so the list, the editor and the preview say the same thing.
 */

/** 'Mon–Fri' when the days are a run, 'Tue, Thu' when they aren't. */
export function daysLabel(availability: Availability): string {
  const open = availability.map((day, index) => (day.length ? index : -1)).filter(i => i >= 0);
  if (!open.length) return 'No days set';
  // Say it as a week starting on Monday, which is how a work week reads.
  const ordered = [1, 2, 3, 4, 5, 6, 0].filter(d => open.includes(d));
  const runs: number[][] = [];
  const weekIndex = (d: number) => (d === 0 ? 6 : d - 1);
  for (const day of ordered) {
    const last = runs[runs.length - 1];
    if (last && weekIndex(day) === weekIndex(last[last.length - 1]) + 1) last.push(day);
    else runs.push([day]);
  }
  return runs.map(run => (run.length > 1 ? `${WEEKDAYS_SHORT[run[0]]}–${WEEKDAYS_SHORT[run[run.length - 1]]}` : WEEKDAYS_SHORT[run[0]])).join(', ');
}

/** 'Mon–Fri · 9:00 am–12:00 pm, 1:00 pm–5:00 pm' — the one-line summary. */
export function availabilitySummary(availability: Availability): string {
  const open = availability.filter(day => day.length);
  if (!open.length) return 'No availability set';
  const first = JSON.stringify(open[0]);
  const same = open.every(day => JSON.stringify(day) === first);
  const windows = open[0].map(r => `${formatTime(r.start, { compact: true })}–${formatTime(r.end, { compact: true })}`).join(', ');
  return same ? `${daysLabel(availability)} · ${windows}` : `${daysLabel(availability)} · varies by day`;
}

export function hoursPerWeek(availability: Availability): string {
  const minutes = weeklyMinutes(availability);
  if (!minutes) return 'Nothing open';
  const hours = minutes / 60;
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)} hours a week open`;
}

export const LOCATION_LABEL: Record<LocationKind, string> = { video: 'Video call', phone: 'Phone call', address: 'In person' };

/** '30 min', '1 hour', '1h 30m'. */
export function durationLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!m) return h === 1 ? '1 hour' : `${h} hours`;
  return `${h}h ${m}m`;
}

export function noticeLabel(hours: number): string {
  if (!hours) return 'Any time';
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ahead`;
  const days = Math.round(hours / 24);
  return `${days} ${days === 1 ? 'day' : 'days'} ahead`;
}

export function windowLabel(days: number): string {
  if (days % 7 === 0 && days >= 7) return `${days / 7} ${days / 7 === 1 ? 'week' : 'weeks'} out`;
  return `${days} ${days === 1 ? 'day' : 'days'} out`;
}

/** The timezones a sales team actually picks from, plus whatever is already set. */
export const TIMEZONES = [
  'America/Los_Angeles',
  'America/Denver',
  'America/Phoenix',
  'America/Chicago',
  'America/New_York',
  'America/Toronto',
  'America/Sao_Paulo',
  'Europe/London',
  'Europe/Dublin',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Madrid',
  'Europe/Stockholm',
  'Europe/Warsaw',
  'Africa/Lagos',
  'Africa/Johannesburg',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Singapore',
  'Asia/Hong_Kong',
  'Asia/Tokyo',
  'Australia/Sydney',
  'Pacific/Auckland',
  'UTC',
];

export const zoneName = (tz: string) => tz.split('/').pop()?.replace(/_/g, ' ') ?? tz;
