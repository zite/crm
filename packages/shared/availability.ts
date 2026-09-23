/**
 * The slot calculator behind every meeting link.
 *
 * Pure and dependency-free (only ./dates), so the same code runs in the public
 * page to draw the calendar and in `bookMeeting` to prove the slot is still
 * free. Anything that decides whether a time can be booked lives here — never
 * in a page or an endpoint.
 *
 * Three facts shape it:
 *
 *   - Availability is wall-clock in the HOST's timezone ("Mondays 9–5"), so
 *     every window is turned into an instant with `zonedToUtc`, which re-checks
 *     the offset and therefore follows daylight saving. Nothing here does
 *     arithmetic on a local hour.
 *   - Slots are returned as UTC ISO strings and grouped by the VISITOR's
 *     calendar day, because that is the calendar a buyer is looking at. A 5pm
 *     Portland slot belongs to the next day in Sydney, and the calendar has to
 *     agree with the times listed under it.
 *   - Buffers guard both sides of an existing meeting, and "minimum notice" is
 *     measured from now, not from the start of the day.
 */

import { addDays, todayIn, weekday, zonedParts, zonedToUtc } from './dates';

/** A wall-clock window on one weekday, e.g. { start: '09:00', end: '12:00' }. */
export type TimeRange = { start: string; end: string };

/** Seven lists of windows, index 0 = Sunday … 6 = Saturday. */
export type Availability = TimeRange[][];

/** Something already in the host's calendar, as UTC instants. */
export type BusyInterval = { start: string; end: string };

export type SlotOptions = {
  availability: Availability;
  /** Length of the meeting itself, in minutes. */
  durationMinutes: number;
  /** Quiet time kept on both sides of every booked meeting. */
  bufferMinutes: number;
  /** Nothing may be booked sooner than this many hours from now. */
  minNoticeHours: number;
  /** How far ahead the page is bookable, in days from today. */
  windowDays: number;
  /** The zone the availability windows are written in. */
  hostTimezone: string;
  /** The zone the buyer is looking at; days are grouped by it. */
  visitorTimezone: string;
  /** Meetings the host already has. */
  busy?: BusyInterval[];
  /** Defaults to the real clock; pass it to make a test deterministic. */
  now?: string | Date;
  /** How far apart slot starts are. Defaults to the duration (back-to-back). */
  stepMinutes?: number;
  /** Only return these visitor days (a month view asks for one month). */
  fromDay?: string;
  toDay?: string;
};

export type DaySlots = {
  /** A calendar day in the VISITOR's timezone. */
  day: string;
  /** Slot starts as UTC ISO strings, ascending. */
  slots: string[];
};

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
export const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

export const DURATION_OPTIONS = [15, 30, 45, 60] as const;

/** The zones a host or a buyer actually picks from, in longitude order. */
export const COMMON_TIMEZONES = [
  'Pacific/Honolulu',
  'America/Anchorage',
  'America/Los_Angeles',
  'America/Denver',
  'America/Phoenix',
  'America/Chicago',
  'America/Mexico_City',
  'America/New_York',
  'America/Toronto',
  'America/Bogota',
  'America/Sao_Paulo',
  'Europe/London',
  'Europe/Dublin',
  'Europe/Lisbon',
  'Europe/Paris',
  'Europe/Madrid',
  'Europe/Berlin',
  'Europe/Amsterdam',
  'Europe/Stockholm',
  'Europe/Warsaw',
  'Africa/Lagos',
  'Africa/Johannesburg',
  'Europe/Athens',
  'Europe/Istanbul',
  'Asia/Jerusalem',
  'Asia/Dubai',
  'Asia/Karachi',
  'Asia/Kolkata',
  'Asia/Bangkok',
  'Asia/Singapore',
  'Asia/Hong_Kong',
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Asia/Seoul',
  'Australia/Perth',
  'Australia/Brisbane',
  'Australia/Sydney',
  'Pacific/Auckland',
  'UTC',
] as const;

/** 'America/Los_Angeles' → 'Los Angeles'. */
export const zoneCity = (timezone: string) => timezone.split('/').pop()?.replace(/_/g, ' ') ?? timezone;

const MINUTE = 60_000;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export const isTime = (v: unknown): v is string => typeof v === 'string' && TIME_RE.test(v);

/** '09:30' → 570. Returns null for anything that isn't a wall-clock time. */
export function minutesOfDay(time: string): number | null {
  if (!isTime(time)) return null;
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
}

/** 570 → '09:30'. Clamped to one day. */
export function timeOfMinutes(minutes: number): string {
  const m = Math.max(0, Math.min(24 * 60, Math.round(minutes)));
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** Mon–Fri, 9–5 with an hour for lunch: what a new meeting link starts as. */
export function defaultAvailability(): Availability {
  return [0, 1, 2, 3, 4, 5, 6].map(day =>
    day >= 1 && day <= 5
      ? [
          { start: '09:00', end: '12:00' },
          { start: '13:00', end: '17:00' },
        ]
      : [],
  );
}

export const emptyAvailability = (): Availability => [[], [], [], [], [], [], []];

/**
 * Anything that came out of the database or a request body, turned into seven
 * sorted, non-overlapping, valid lists. Junk is dropped rather than thrown on:
 * a page with one bad window still has to open.
 */
export function normalizeAvailability(raw: unknown): Availability {
  let value: unknown = raw;
  if (typeof value === 'string') {
    if (!value.trim()) return emptyAvailability();
    try {
      value = JSON.parse(value);
    } catch {
      return emptyAvailability();
    }
  }
  const out = emptyAvailability();
  if (!value || typeof value !== 'object') return out;
  // Accept both an array of seven lists and an object keyed '0'…'6'.
  const at = (day: number): unknown => (Array.isArray(value) ? value[day] : (value as Record<string, unknown>)[String(day)]);
  for (let day = 0; day < 7; day++) {
    const list = at(day);
    if (!Array.isArray(list)) continue;
    const ranges: TimeRange[] = [];
    for (const item of list.slice(0, 12)) {
      if (!item || typeof item !== 'object') continue;
      const start = String((item as TimeRange).start ?? '');
      const end = String((item as TimeRange).end ?? '');
      const s = minutesOfDay(start);
      const e = minutesOfDay(end);
      if (s == null || e == null || e <= s) continue;
      ranges.push({ start, end });
    }
    out[day] = mergeRanges(ranges);
  }
  return out;
}

/** Sorted, with overlapping and touching windows joined, so a slot is never offered twice. */
export function mergeRanges(ranges: TimeRange[]): TimeRange[] {
  const sorted = [...ranges].sort((a, b) => (minutesOfDay(a.start) ?? 0) - (minutesOfDay(b.start) ?? 0));
  const out: TimeRange[] = [];
  for (const range of sorted) {
    const last = out[out.length - 1];
    if (last && (minutesOfDay(range.start) ?? 0) <= (minutesOfDay(last.end) ?? 0)) {
      if ((minutesOfDay(range.end) ?? 0) > (minutesOfDay(last.end) ?? 0)) last.end = range.end;
    } else {
      out.push({ ...range });
    }
  }
  return out;
}

export const availabilityToJson = (availability: Availability) => JSON.stringify(normalizeAvailability(availability));

/** Copy one weekday's windows onto every other day that a host works. */
export function copyToAllDays(availability: Availability, fromDay: number): Availability {
  const source = availability[fromDay] ?? [];
  return availability.map((day, index) => (index === fromDay ? day : source.map(r => ({ ...r }))));
}

/** Minutes a host is open across a week — the line under the availability editor. */
export function weeklyMinutes(availability: Availability): number {
  return availability.reduce((total, day) => total + day.reduce((sum, r) => sum + ((minutesOfDay(r.end) ?? 0) - (minutesOfDay(r.start) ?? 0)), 0), 0);
}

export const hasAnyAvailability = (availability: Availability) => availability.some(day => day.length > 0);

/** '09:00' → '9:00 am'. Used on both apps, so the host and the buyer read the same words. */
export function formatTime(time: string, opts: { compact?: boolean } = {}): string {
  const minutes = minutesOfDay(time);
  if (minutes == null) return time;
  const hour24 = Math.floor(minutes / 60);
  const minute = minutes % 60;
  const suffix = hour24 >= 12 ? 'pm' : 'am';
  const hour = hour24 % 12 === 0 ? 12 : hour24 % 12;
  if (opts.compact && minute === 0) return `${hour}${suffix}`;
  return `${hour}:${String(minute).padStart(2, '0')}${opts.compact ? '' : ' '}${suffix}`;
}

/** A UTC instant as 'Thursday, October 2 at 9:00 am' in a timezone. */
export function describeSlot(iso: string, timezone: string): string {
  const parts = zonedParts(iso, timezone);
  const date = new Date(`${parts.day}T00:00:00Z`);
  const weekdayName = WEEKDAYS[date.getUTCDay()];
  const month = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][date.getUTCMonth()];
  return `${weekdayName}, ${month} ${date.getUTCDate()} at ${formatTime(parts.time)}`;
}

/** 'PDT', 'GMT+11' — what a buyer needs to see beside a time. */
export function zoneAbbreviation(timezone: string, at: Date = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, timeZoneName: 'short' }).formatToParts(at);
    return parts.find(p => p.type === 'timeZoneName')?.value ?? timezone;
  } catch {
    return timezone;
  }
}

function toMillis(value: string | Date | undefined, fallback: number): number {
  if (!value) return fallback;
  const ms = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(ms) ? ms : fallback;
}

/** Busy intervals widened by the buffer, dropped if unusable, sorted. */
function expandBusy(busy: BusyInterval[], bufferMinutes: number): Array<{ start: number; end: number }> {
  const pad = Math.max(0, bufferMinutes) * MINUTE;
  return busy
    .map(b => ({ start: Date.parse(b.start), end: Date.parse(b.end) }))
    .filter(b => Number.isFinite(b.start) && Number.isFinite(b.end) && b.end > b.start)
    .map(b => ({ start: b.start - pad, end: b.end + pad }))
    .sort((a, b) => a.start - b.start);
}

/**
 * Every free slot, grouped by the visitor's calendar day.
 *
 * Days are walked in the HOST's calendar (that is where "Mondays 9–5" means
 * something) with a day of slack on each side, because a host day can land on
 * two visitor days.
 */
export function computeSlots(options: SlotOptions): DaySlots[] {
  const availability = normalizeAvailability(options.availability);
  const duration = Math.max(5, Math.round(options.durationMinutes || 30));
  const step = Math.max(5, Math.round(options.stepMinutes || duration));
  const buffer = Math.max(0, Math.round(options.bufferMinutes || 0));
  const windowDays = Math.max(1, Math.min(365, Math.round(options.windowDays || 30)));
  const hostTimezone = options.hostTimezone || 'UTC';
  const visitorTimezone = options.visitorTimezone || hostTimezone;
  if (!hasAnyAvailability(availability)) return [];

  const nowMs = toMillis(options.now, Date.now());
  const earliest = nowMs + Math.max(0, options.minNoticeHours || 0) * 60 * MINUTE;
  const latest = nowMs + windowDays * 24 * 60 * MINUTE;
  const busy = expandBusy(options.busy ?? [], buffer);

  // The visitor days the caller is willing to render.
  const visitorToday = todayIn(visitorTimezone, new Date(nowMs));
  const firstDay = options.fromDay && options.fromDay > visitorToday ? options.fromDay : visitorToday;
  const lastDay = options.toDay ?? addDays(visitorToday, windowDays);

  const byDay = new Map<string, string[]>();
  const hostStart = addDays(todayIn(hostTimezone, new Date(nowMs)), -1);

  for (let offset = 0; offset <= windowDays + 1; offset++) {
    const hostDay = addDays(hostStart, offset);
    const ranges = availability[weekday(hostDay)] ?? [];
    for (const range of ranges) {
      const windowStart = Date.parse(zonedToUtc(hostDay, range.start, hostTimezone));
      const windowEnd = Date.parse(zonedToUtc(hostDay, range.end, hostTimezone));
      if (!Number.isFinite(windowStart) || !Number.isFinite(windowEnd) || windowEnd <= windowStart) continue;
      // Stepping in real minutes (not wall-clock minutes) is what makes a
      // window that spans a daylight-saving change come out right: the hour
      // that does not exist simply never produces a slot.
      for (let start = windowStart; start + duration * MINUTE <= windowEnd; start += step * MINUTE) {
        const end = start + duration * MINUTE;
        if (start < earliest || start > latest) continue;
        if (busy.some(b => start < b.end && end > b.start)) continue;
        const day = zonedParts(new Date(start).toISOString(), visitorTimezone).day;
        if (day < firstDay || day > lastDay) continue;
        const list = byDay.get(day);
        if (list) list.push(new Date(start).toISOString());
        else byDay.set(day, [new Date(start).toISOString()]);
      }
    }
  }

  return [...byDay.entries()]
    .map(([day, slots]) => ({ day, slots: [...new Set(slots)].sort() }))
    .filter(d => d.slots.length > 0)
    .sort((a, b) => (a.day < b.day ? -1 : 1));
}

/** Flat list of every free slot — for a server-side re-check. */
export function allSlots(options: SlotOptions): string[] {
  return computeSlots(options).flatMap(d => d.slots);
}

/**
 * Is this exact instant still bookable? `bookMeeting` and `manageBooking` ask
 * this again after the buyer has filled in the form, so two people can't take
 * the same time.
 */
export function isSlotFree(slotIso: string, options: SlotOptions): boolean {
  const target = Date.parse(slotIso);
  if (!Number.isFinite(target)) return false;
  const day = zonedParts(new Date(target).toISOString(), options.visitorTimezone || options.hostTimezone || 'UTC').day;
  // Only the slot's own day has to be generated to answer this.
  return allSlots({ ...options, fromDay: day, toDay: day }).some(slot => Date.parse(slot) === target);
}

/** The days a month view should offer, for the calendar's dots. */
export function daysWithSlots(days: DaySlots[]): Set<string> {
  return new Set(days.filter(d => d.slots.length > 0).map(d => d.day));
}

/* ---------- Custom questions on a booking page ---------- */

export type BookingQuestion = { id: string; label: string; required: boolean; long: boolean };

export function normalizeQuestions(raw: unknown): BookingQuestion[] {
  let value: unknown = raw;
  if (typeof value === 'string') {
    if (!value.trim()) return [];
    try {
      value = JSON.parse(value);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, 20)
    .map((item, index) => {
      const q = (item ?? {}) as Partial<BookingQuestion>;
      const label = String(q.label ?? '').trim().slice(0, 200);
      if (!label) return null;
      return { id: String(q.id ?? `q${index + 1}`).slice(0, 40), label, required: q.required === true, long: q.long === true };
    })
    .filter((q): q is BookingQuestion => q !== null);
}

/* ---------- Where the meeting happens ---------- */

export type LocationKind = 'video' | 'phone' | 'address';
export type MeetingLocation = { kind: LocationKind; value: string };

export const LOCATION_KINDS: Array<{ value: LocationKind; label: string; hint: string }> = [
  { value: 'video', label: 'Video call', hint: 'A link you send, e.g. https://meet.google.com/abc-defg-hij' },
  { value: 'phone', label: 'Phone call', hint: 'What should happen — e.g. “We’ll call the number you give us.”' },
  { value: 'address', label: 'In person', hint: 'The address, on one line' },
];

/** Stored as 'kind|value' in a single-line column; older or hand-written values still read. */
export function parseLocation(raw: unknown): MeetingLocation {
  const text = String(raw ?? '').trim();
  if (!text) return { kind: 'video', value: '' };
  const split = text.indexOf('|');
  const head = split > 0 ? text.slice(0, split) : '';
  if (head === 'video' || head === 'phone' || head === 'address') return { kind: head, value: text.slice(split + 1).trim() };
  return { kind: /^https?:\/\//i.test(text) ? 'video' : 'address', value: text };
}

export const serializeLocation = (location: MeetingLocation) => `${location.kind}|${location.value.trim()}`;

/** One line a person can read, for the page, the email and the calendar file. */
export function describeLocation(location: MeetingLocation): string {
  const value = location.value.trim();
  if (location.kind === 'video') return value || 'Video call — link to follow';
  if (location.kind === 'phone') return value || 'Phone call';
  return value || 'In person';
}

/* ---------- A booking page, as both apps read it ---------- */

/**
 * The CRM editor and the public page must agree on every number, or a buyer is
 * offered a slot the host never opened. Both turn a "Booking Pages" row into
 * this, and both build their SlotOptions with `slotOptionsFor`.
 */
export type BookingPageRecord = {
  id: string;
  name: string;
  slug: string;
  description: string;
  hostIds: string[];
  durationMinutes: number;
  bufferMinutes: number;
  minNoticeHours: number;
  windowDays: number;
  availability: Availability;
  timezone: string;
  location: MeetingLocation;
  questions: BookingQuestion[];
  active: boolean;
  ownerId: string | null;
  bookingCount: number;
  rotationCursor: number;
};

const text = (v: unknown) => (v == null ? '' : String(v));
const count = (v: unknown, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : fallback;
};

/** Parse a JSON id array column ('["a","b"]'), tolerating '' and junk. */
export function idList(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String);
  if (raw == null || raw === '') return [];
  try {
    const parsed = JSON.parse(String(raw));
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

export function toBookingPage(row: Record<string, unknown>): BookingPageRecord {
  return {
    id: String(row.id ?? ''),
    name: text(row.name),
    slug: text(row.slug),
    description: text(row.description),
    hostIds: idList(row.hostIds),
    durationMinutes: count(row.durationMinutes, 30),
    bufferMinutes: Math.max(0, Math.round(Number(row.bufferMinutes) || 0)),
    minNoticeHours: Math.max(0, Math.round(Number(row.minNoticeHours) || 0)),
    windowDays: count(row.windowDays, 30),
    availability: normalizeAvailability(row.availability),
    timezone: text(row.timezone) || 'America/New_York',
    location: parseLocation(row.location),
    questions: normalizeQuestions(row.questions),
    active: row.active === true || row.active === 'true',
    ownerId: row.ownerId ? String(row.ownerId) : null,
    bookingCount: Math.max(0, Math.round(Number(row.bookingCount) || 0)),
    rotationCursor: Math.max(0, Math.round(Number(row.rotationCursor) || 0)),
  };
}

/** The one place a page's numbers become slot rules. */
export function slotOptionsFor(
  page: Pick<BookingPageRecord, 'availability' | 'durationMinutes' | 'bufferMinutes' | 'minNoticeHours' | 'windowDays' | 'timezone'>,
  extra: { visitorTimezone: string; busy?: BusyInterval[]; now?: string | Date; fromDay?: string; toDay?: string; stepMinutes?: number },
): SlotOptions {
  return {
    availability: page.availability,
    durationMinutes: page.durationMinutes,
    bufferMinutes: page.bufferMinutes,
    minNoticeHours: page.minNoticeHours,
    windowDays: page.windowDays,
    hostTimezone: page.timezone,
    visitorTimezone: extra.visitorTimezone || page.timezone,
    busy: extra.busy ?? [],
    now: extra.now,
    fromDay: extra.fromDay,
    toDay: extra.toDay,
    // Slot starts land on a tidy grid (:00, :15, :30, :45) rather than drifting
    // by the meeting length, which is what a buyer expects to see.
    stepMinutes: extra.stepMinutes ?? Math.min(page.durationMinutes, 30),
  };
}

/** The round-robin host for the next booking, and the cursor to store after it. */
export function nextHost(page: Pick<BookingPageRecord, 'hostIds' | 'rotationCursor'>): { hostId: string | null; nextCursor: number } {
  const hosts = page.hostIds.filter(Boolean);
  if (!hosts.length) return { hostId: null, nextCursor: 0 };
  const index = page.rotationCursor % hosts.length;
  return { hostId: hosts[index], nextCursor: (index + 1) % hosts.length };
}

/**
 * One calendar out of several. A round-robin page offers a time when ANY host
 * is free, so the days are the union of every host's days.
 */
export function mergeDays(lists: DaySlots[][]): DaySlots[] {
  const byDay = new Map<string, Set<string>>();
  for (const list of lists) {
    for (const entry of list) {
      const set = byDay.get(entry.day) ?? new Set<string>();
      for (const slot of entry.slots) set.add(slot);
      byDay.set(entry.day, set);
    }
  }
  return [...byDay.entries()]
    .map(([day, slots]) => ({ day, slots: [...slots].sort() }))
    .filter(d => d.slots.length > 0)
    .sort((a, b) => (a.day < b.day ? -1 : 1));
}

/**
 * Who takes this meeting. The rotation decides the order; whoever is actually
 * free at that time takes it, so a round robin never books someone who is busy
 * just because it was their turn.
 *
 * `excludeBusyOf` lets a reschedule ignore the meeting being moved.
 */
export function assignHost(
  slotIso: string,
  page: Pick<BookingPageRecord, 'hostIds' | 'rotationCursor' | 'availability' | 'durationMinutes' | 'bufferMinutes' | 'minNoticeHours' | 'windowDays' | 'timezone'>,
  busyByHost: Map<string, BusyInterval[]>,
  extra: { visitorTimezone: string; now?: string | Date },
): { hostId: string | null; nextCursor: number } {
  const hosts = page.hostIds.filter(Boolean);
  if (!hosts.length) return { hostId: null, nextCursor: 0 };
  const start = page.rotationCursor % hosts.length;
  for (let step = 0; step < hosts.length; step++) {
    const index = (start + step) % hosts.length;
    const hostId = hosts[index];
    const free = isSlotFree(slotIso, slotOptionsFor(page, { visitorTimezone: extra.visitorTimezone, busy: busyByHost.get(hostId) ?? [], now: extra.now }));
    if (free) return { hostId, nextCursor: (index + 1) % hosts.length };
  }
  return { hostId: null, nextCursor: start };
}
