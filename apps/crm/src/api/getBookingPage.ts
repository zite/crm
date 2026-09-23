import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { getActor } from '@project/shared/server/actor';
import { getSettings, pagesLink } from '@project/shared/server/settings';
import { num } from '@project/shared/server/sql';
import { toBookingPage } from '@project/shared/availability';
import { id, parseInput } from '../server/input';

/**
 * One meeting link, everything the editor needs: its settings, its availability
 * and the public URL to hand out. The URL is empty until CRM Pages has been
 * opened once — the editor says so rather than showing a broken link.
 */

const inputSchema = z.object({ id });

export default createEndpoint({
  description: 'Load one meeting link with its availability, questions and public URL',
  authenticated: true,
  inputSchema,
  outputSchema: z.object({
    page: z.object({
      id: z.string(),
      name: z.string(),
      slug: z.string(),
      description: z.string(),
      hostIds: z.array(z.string()),
      durationMinutes: z.number(),
      bufferMinutes: z.number(),
      minNoticeHours: z.number(),
      windowDays: z.number(),
      availability: z.array(z.array(z.object({ start: z.string(), end: z.string() }))),
      timezone: z.string(),
      location: z.object({ kind: z.string(), value: z.string() }),
      questions: z.array(z.object({ id: z.string(), label: z.string(), required: z.boolean(), long: z.boolean() })),
      active: z.boolean(),
      ownerId: z.string().nullable(),
      bookingCount: z.number(),
      rotationCursor: z.number(),
      createdAt: z.string().nullable(),
    }),
    url: z.string(),
    counts: z.object({ bookings: z.number(), upcoming: z.number(), canceled: z.number() }),
    canEdit: z.boolean(),
  }),
  execute: async ({ input, context }) => {
    const parsed = parseInput(inputSchema, input);
    const actor = await getActor(context);
    const { rows } = await zite.sql({ query: `SELECT * FROM "BookingPages" WHERE id::text = $1`, params: [parsed.id] });
    if (!rows[0]) throw new ZiteError('That meeting link doesn’t exist or was deleted', 'NOT_FOUND');
    const page = toBookingPage(rows[0]);
    const settings = await getSettings();
    const now = new Date().toISOString();
    const { rows: countRows } = await zite.sql({
      query: `SELECT
          COUNT(*) FILTER (WHERE COALESCE("outcome", '') <> 'Canceled') AS "bookingTotal",
          COUNT(*) FILTER (WHERE COALESCE("outcome", '') <> 'Canceled' AND "occurredAt" >= $2) AS "upcomingTotal",
          COUNT(*) FILTER (WHERE "outcome" = 'Canceled') AS "canceledTotal"
        FROM "Activities" WHERE "bookingPageId" = $1`,
      params: [parsed.id, now],
    });
    const counts = countRows[0] ?? {};
    // Managers own every shared asset; a rep owns the ones they made.
    const canEdit = actor.role === 'Admin' || actor.role === 'Manager' || (actor.role === 'Rep' && (!page.ownerId || page.ownerId === actor.id));
    return {
      page: { ...page, createdAt: rows[0].created_at ? new Date(String(rows[0].created_at)).toISOString() : null },
      url: pagesLink(settings, `/m/${page.slug}`),
      counts: { bookings: num(counts.bookingTotal), upcoming: num(counts.upcomingTotal), canceled: num(counts.canceledTotal) },
      canEdit,
    };
  },
});
