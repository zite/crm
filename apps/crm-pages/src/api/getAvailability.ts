import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { computeSlots, mergeDays, slotOptionsFor, toBookingPage, type BookingPageRecord, type BusyInterval } from '@project/shared/availability';
import { addDays, isValidTimezone, todayIn } from '@project/shared/dates';
import { parseInput } from '../server/input';

/**
 * The free slots on a meeting link, in the visitor's timezone.
 *
 * The page asks for one month at a time; the calendar dots and the list of
 * times under a day both come from this one answer, so they can never disagree.
 * A round-robin link offers a time when ANY of its hosts is free — the same
 * rule `bookMeeting` uses when it decides who actually takes it.
 *
 * The two helpers below are exported because `bookMeeting` and `manageBooking`
 * must read a page and a host's calendar exactly the way this does. One
 * implementation, three endpoints.
 */

/** A page by slug, refusing a paused or missing one the same way. */
export async function loadPublicPage(slug: string): Promise<BookingPageRecord> {
  const { rows } = await zite.sql({ query: `SELECT * FROM "BookingPages" WHERE LOWER("slug") = $1 LIMIT 1`, params: [slug.toLowerCase()] });
  if (!rows[0]) throw new ZiteError('This meeting link doesn’t exist any more. Check the link you were sent.', 'NOT_FOUND');
  const page = toBookingPage(rows[0]);
  if (!page.active || !page.hostIds.length) throw new ZiteError('This meeting link isn’t taking bookings at the moment.', 'NOT_FOUND');
  return page;
}

/**
 * What each host already has in the window. A meeting that was canceled frees
 * its time again; `ignoreActivityId` lets a reschedule ignore the very meeting
 * it is moving, so a buyer can shift by 30 minutes.
 */
export async function loadBusyByHost(hostIds: string[], fromIso: string, toIso: string, ignoreActivityId?: string | null): Promise<Map<string, BusyInterval[]>> {
  const busy = new Map<string, BusyInterval[]>(hostIds.map(id => [id, [] as BusyInterval[]]));
  if (!hostIds.length) return busy;
  const params: unknown[] = [...hostIds, fromIso, toIso];
  const hostPlaceholders = hostIds.map((_, i) => `$${i + 1}`).join(', ');
  const fromParam = `$${hostIds.length + 1}`;
  const toParam = `$${hostIds.length + 2}`;
  let ignoreClause = '';
  if (ignoreActivityId) {
    params.push(ignoreActivityId);
    ignoreClause = ` AND id::text <> $${params.length}`;
  }
  const { rows } = await zite.sql({
    query: `SELECT "ownerId", "occurredAt", "endsAt", "durationMinutes" FROM "Activities"
      WHERE "kind" = 'Meeting' AND "ownerId" IN (${hostPlaceholders})
        AND COALESCE("outcome", '') <> 'Canceled'
        AND "occurredAt" >= ${fromParam} AND "occurredAt" <= ${toParam}${ignoreClause}`,
    params,
  });
  for (const row of rows) {
    const ownerId = String(row.ownerId ?? '');
    const list = busy.get(ownerId);
    if (!list || !row.occurredAt) continue;
    const start = new Date(String(row.occurredAt));
    if (Number.isNaN(start.getTime())) continue;
    const minutes = Number(row.durationMinutes);
    const end = row.endsAt ? new Date(String(row.endsAt)) : new Date(start.getTime() + (Number.isFinite(minutes) && minutes > 0 ? minutes : 30) * 60_000);
    list.push({ start: start.toISOString(), end: (Number.isNaN(end.getTime()) || end <= start ? new Date(start.getTime() + 30 * 60_000) : end).toISOString() });
  }
  return busy;
}

const inputSchema = z.object({
  slug: z.string().trim().min(1).max(80),
  timezone: z.string().min(1).max(64),
  /** The first day of the month being shown, in the visitor's timezone. */
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  /** Rescheduling: the meeting being moved shouldn't block its own new time. */
  bookingToken: z.string().max(64).optional(),
});

export default createEndpoint({
  description: 'Free slots on a public meeting link, in the visitor’s timezone',
  inputSchema,
  outputSchema: z.object({
    timezone: z.string(),
    hostTimezone: z.string(),
    durationMinutes: z.number(),
    windowDays: z.number(),
    lastBookableDay: z.string(),
    days: z.array(z.object({ day: z.string(), slots: z.array(z.string()) })),
  }),
  execute: async ({ input }) => {
    const parsed = parseInput(inputSchema, input);
    const page = await loadPublicPage(parsed.slug);
    const visitorTimezone = isValidTimezone(parsed.timezone) ? parsed.timezone : page.timezone;

    const now = new Date();
    const today = todayIn(visitorTimezone, now);
    const horizon = addDays(today, page.windowDays);
    // Never generate more than the horizon, whatever month the page asks for.
    const from = parsed.from && parsed.from > today ? parsed.from : today;
    const to = parsed.to && parsed.to < horizon ? parsed.to : horizon;
    if (to < from) return { timezone: visitorTimezone, hostTimezone: page.timezone, durationMinutes: page.durationMinutes, windowDays: page.windowDays, lastBookableDay: horizon, days: [] };

    // Rescheduling frees the meeting being moved — but only ever that one, and
    // only when the token really belongs to this page.
    let ignoreId: string | null = null;
    if (parsed.bookingToken) {
      const { rows } = await zite.sql({ query: `SELECT id FROM "Activities" WHERE "publicToken" = $1 AND "bookingPageId" = $2 LIMIT 1`, params: [parsed.bookingToken, page.id] });
      ignoreId = rows[0] ? String(rows[0].id) : null;
    }

    // A day either side, because a meeting that starts before the window (plus
    // its buffer) can still block the first slot inside it.
    const busy = await loadBusyByHost(page.hostIds, `${addDays(from, -2)}T00:00:00.000Z`, `${addDays(to, 2)}T00:00:00.000Z`, ignoreId);
    const perHost = page.hostIds.map(hostId => computeSlots(slotOptionsFor(page, { visitorTimezone, busy: busy.get(hostId) ?? [], now, fromDay: from, toDay: to })));

    return {
      timezone: visitorTimezone,
      hostTimezone: page.timezone,
      durationMinutes: page.durationMinutes,
      windowDays: page.windowDays,
      lastBookableDay: horizon,
      days: mergeDays(perHost),
    };
  },
});
