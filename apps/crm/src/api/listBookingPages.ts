import { z } from 'zod';
import { createEndpoint } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { getActor } from '@project/shared/server/actor';
import { getSettings } from '@project/shared/server/settings';
import { num } from '@project/shared/server/sql';
import { toBookingPage } from '@project/shared/availability';

/**
 * Every meeting link, with how many meetings each one has actually produced —
 * the number on the row is the bookings that exist, not a counter someone could
 * have nudged, so an empty page reads as empty.
 */

const bookingPage = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  description: z.string(),
  hostIds: z.array(z.string()),
  durationMinutes: z.number(),
  bufferMinutes: z.number(),
  minNoticeHours: z.number(),
  windowDays: z.number(),
  timezone: z.string(),
  location: z.object({ kind: z.string(), value: z.string() }),
  questionCount: z.number(),
  active: z.boolean(),
  ownerId: z.string().nullable(),
  bookings: z.number(),
  upcoming: z.number(),
  lastBookedAt: z.string().nullable(),
  createdAt: z.string().nullable(),
});

export default createEndpoint({
  description: 'List the organization’s meeting links with their booking counts',
  authenticated: true,
  inputSchema: z.object({}),
  outputSchema: z.object({ pages: z.array(bookingPage), pagesUrl: z.string(), availabilityByPage: z.record(z.array(z.array(z.object({ start: z.string(), end: z.string() })))) }),
  execute: async ({ context }) => {
    await getActor(context);
    const settings = await getSettings();
    const now = new Date().toISOString();
    const { rows } = await zite.sql({
      query: `SELECT b.*,
          (SELECT COUNT(*) FROM "Activities" a WHERE a."bookingPageId" = b.id::text AND COALESCE(a."outcome", '') <> 'Canceled') AS "bookingTotal",
          (SELECT COUNT(*) FROM "Activities" a WHERE a."bookingPageId" = b.id::text AND COALESCE(a."outcome", '') <> 'Canceled' AND a."occurredAt" >= $1) AS "upcomingTotal",
          (SELECT MAX(a.created_at) FROM "Activities" a WHERE a."bookingPageId" = b.id::text) AS "lastBookedAt"
        FROM "BookingPages" b
        ORDER BY COALESCE(b."active", false) DESC, b."name" ASC`,
      params: [now],
    });
    const availabilityByPage: Record<string, Array<Array<{ start: string; end: string }>>> = {};
    return {
      pagesUrl: (settings.pagesUrl ?? '').replace(/\/+$/, ''),
      availabilityByPage,
      pages: rows.map(row => {
        const page = toBookingPage(row);
        availabilityByPage[page.id] = page.availability;
        return {
          id: page.id,
          name: page.name,
          slug: page.slug,
          description: page.description,
          hostIds: page.hostIds,
          durationMinutes: page.durationMinutes,
          bufferMinutes: page.bufferMinutes,
          minNoticeHours: page.minNoticeHours,
          windowDays: page.windowDays,
          timezone: page.timezone,
          location: page.location,
          questionCount: page.questions.length,
          active: page.active,
          ownerId: page.ownerId,
          bookings: num(row.bookingTotal),
          upcoming: num(row.upcomingTotal),
          lastBookedAt: row.lastBookedAt ? new Date(String(row.lastBookedAt)).toISOString() : null,
          createdAt: row.created_at ? new Date(String(row.created_at)).toISOString() : null,
        };
      }),
    };
  },
});
