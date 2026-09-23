/**
 * Calendar days are 'YYYY-MM-DD' strings everywhere. Arithmetic happens on UTC
 * midnights so a day never shifts under daylight saving.
 *
 * "Today" is a person's local day: the browser sends it (`today` inputs) and the
 * server falls back to the organization's timezone (`todayIn(settings.timezone)`).
 * In SQL, never use CURRENT_DATE — bind the day as a parameter (`$1::date`).
 */

export const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
export const isDay = (v: unknown): v is string => typeof v === 'string' && DAY_RE.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));

const pad = (n: number) => String(n).padStart(2, '0');
const toDay = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const fromDay = (day: string) => new Date(`${day.slice(0, 10)}T00:00:00Z`);

/** The calendar day in a timezone, e.g. todayIn('America/New_York'). Falls back to UTC for a bad zone. */
export function todayIn(timezone?: string | null, now = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
    const get = (t: string) => parts.find(p => p.type === t)?.value ?? '';
    return `${get('year')}-${get('month')}-${get('day')}`;
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

export const addDays = (day: string, n: number) => {
  const d = fromDay(day);
  d.setUTCDate(d.getUTCDate() + n);
  return toDay(d);
};

/** Whole days from a to b (b − a). */
export const diffDays = (a: string, b: string) => Math.round((fromDay(b).getTime() - fromDay(a).getTime()) / 86_400_000);

export function addMonths(day: string, n: number) {
  const d = fromDay(day);
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d.getUTCDate(), lastDay));
  return toDay(target);
}

export const weekday = (day: string) => fromDay(day).getUTCDay(); // 0 = Sunday

/** Monday of the week containing `day`. */
export const startOfWeek = (day: string) => addDays(day, -((weekday(day) + 6) % 7));

export const startOfMonth = (day: string) => `${day.slice(0, 7)}-01`;
export const endOfMonth = (day: string) => addDays(addMonths(startOfMonth(day), 1), -1);

export type PeriodKind = 'Month' | 'Quarter' | 'Year';

/**
 * The first day of the month/quarter/year containing `day`. Quarters and years
 * follow the fiscal year, which starts in `fiscalStartMonth` (1 = January).
 */
export function periodStart(day: string, kind: PeriodKind, fiscalStartMonth = 1): string {
  const d = fromDay(day);
  const month = d.getUTCMonth(); // 0-based
  if (kind === 'Month') return toDay(new Date(Date.UTC(d.getUTCFullYear(), month, 1)));
  const fs = (Math.min(12, Math.max(1, fiscalStartMonth)) - 1) % 12;
  const span = kind === 'Quarter' ? 3 : 12;
  const offset = (((month - fs) % 12) + 12) % 12;
  const startMonthIndex = month - (offset % span);
  return toDay(new Date(Date.UTC(d.getUTCFullYear(), startMonthIndex, 1)));
}

export function periodEnd(start: string, kind: PeriodKind): string {
  return addDays(addMonths(start, kind === 'Month' ? 1 : kind === 'Quarter' ? 3 : 12), -1);
}

export function shiftPeriod(start: string, kind: PeriodKind, n: number): string {
  return addMonths(start, (kind === 'Month' ? 1 : kind === 'Quarter' ? 3 : 12) * n);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Sep 2026", "Q3 FY2026", "FY2026". The fiscal year is named for the calendar year it ends in. */
export function periodLabel(start: string, kind: PeriodKind, fiscalStartMonth = 1): string {
  const d = fromDay(start);
  if (kind === 'Month') return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  const fyStart = periodStart(start, 'Year', fiscalStartMonth);
  const fyEndYear = fromDay(periodEnd(fyStart, 'Year')).getUTCFullYear();
  const fy = fiscalStartMonth === 1 ? String(fyEndYear) : `FY${fyEndYear}`;
  if (kind === 'Year') return fiscalStartMonth === 1 ? fy : fy;
  const q = Math.floor(diffMonths(fyStart, start) / 3) + 1;
  return fiscalStartMonth === 1 ? `Q${q} ${fyEndYear}` : `Q${q} ${fy}`;
}

function diffMonths(a: string, b: string) {
  const x = fromDay(a);
  const y = fromDay(b);
  return (y.getUTCFullYear() - x.getUTCFullYear()) * 12 + (y.getUTCMonth() - x.getUTCMonth());
}

/** Whole days since an ISO timestamp, measured on calendar days in UTC. */
export function daysSince(iso: string | null | undefined, today: string): number | null {
  if (!iso) return null;
  return diffDays(String(iso).slice(0, 10), today);
}

/* ---------- Timezones (meeting links, scheduled sends) ---------- */

export type ZonedParts = { day: string; time: string; weekday: number; minutes: number };

/** A UTC instant as wall-clock parts in a timezone. */
export function zonedParts(iso: string | Date, timezone: string): ZonedParts {
  const date = typeof iso === 'string' ? new Date(iso) : iso;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone || 'UTC',
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
  }).formatToParts(date);
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? '';
  const day = `${get('year')}-${get('month')}-${get('day')}`;
  const hour = Number(get('hour')) % 24;
  const minute = Number(get('minute'));
  return { day, time: `${pad(hour)}:${pad(minute)}`, weekday: weekday(day), minutes: hour * 60 + minute };
}

/** The UTC offset of a timezone at an instant, in minutes (e.g. -240 for New York in summer). */
export function offsetMinutes(timezone: string, at: Date): number {
  const p = zonedParts(at, timezone);
  const asUtc = Date.UTC(Number(p.day.slice(0, 4)), Number(p.day.slice(5, 7)) - 1, Number(p.day.slice(8, 10)), Math.floor(p.minutes / 60), p.minutes % 60);
  return Math.round((asUtc - Math.floor(at.getTime() / 60000) * 60000) / 60000);
}

/** Wall-clock day + 'HH:MM' in a timezone → UTC ISO string. Handles DST by re-checking the offset. */
export function zonedToUtc(day: string, time: string, timezone: string): string {
  const [h, m] = time.split(':').map(Number);
  const guess = new Date(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)), h || 0, m || 0));
  let offset = offsetMinutes(timezone, guess);
  let result = new Date(guess.getTime() - offset * 60000);
  const second = offsetMinutes(timezone, result);
  if (second !== offset) {
    offset = second;
    result = new Date(guess.getTime() - offset * 60000);
  }
  return result.toISOString();
}

export function isValidTimezone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || !tz) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
