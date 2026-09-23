import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { describeLocation, toBookingPage } from '@project/shared/availability';
import { parseInput } from '../server/input';

/**
 * A meeting link as a buyer sees it. Public and unauthenticated, so it returns
 * only what belongs on the page: the page's own words, how long the meeting is,
 * where it happens, and the people they would be meeting — name, title and
 * avatar, never an email address, a member id or anything about the pipeline.
 *
 * A paused link answers with a sentence rather than a blank page; a slug that
 * doesn't exist answers the same way it would for any bad link.
 */

const inputSchema = z.object({ slug: z.string().trim().min(1).max(80) });

export default createEndpoint({
  description: 'Load a public meeting link by its slug',
  inputSchema,
  outputSchema: z.object({
    name: z.string(),
    slug: z.string(),
    description: z.string(),
    durationMinutes: z.number(),
    timezone: z.string(),
    location: z.object({ kind: z.string(), value: z.string(), label: z.string() }),
    questions: z.array(z.object({ id: z.string(), label: z.string(), required: z.boolean(), long: z.boolean() })),
    hosts: z.array(z.object({ name: z.string(), title: z.string().nullable(), avatarUrl: z.string().nullable(), color: z.string().nullable() })),
    roundRobin: z.boolean(),
    windowDays: z.number(),
    minNoticeHours: z.number(),
  }),
  execute: async ({ input }) => {
    const { slug } = parseInput(inputSchema, input);
    const { rows } = await zite.sql({ query: `SELECT * FROM "BookingPages" WHERE LOWER("slug") = $1 LIMIT 1`, params: [slug.toLowerCase()] });
    if (!rows[0]) throw new ZiteError('This meeting link doesn’t exist any more. Check the link you were sent.', 'NOT_FOUND');
    const page = toBookingPage(rows[0]);
    if (!page.active) throw new ZiteError('This meeting link isn’t taking bookings at the moment. Reply to the email that brought you here and someone will help.', 'NOT_FOUND');

    const hosts: Array<{ name: string; title: string | null; avatarUrl: string | null; color: string | null }> = [];
    if (page.hostIds.length) {
      const placeholders = page.hostIds.map((_, i) => `$${i + 1}`).join(', ');
      const { rows: memberRows } = await zite.sql({
        query: `SELECT id, "name", "title", "avatarUrl", "color" FROM "Members" WHERE id::text IN (${placeholders}) AND "status" <> 'Deactivated'`,
        params: page.hostIds,
      });
      // Keep the page's own order, so "your host" is stable between visits.
      const byId = new Map(memberRows.map(r => [String(r.id), r]));
      for (const hostId of page.hostIds) {
        const row = byId.get(hostId);
        if (!row) continue;
        hosts.push({ name: String(row.name ?? ''), title: row.title ? String(row.title) : null, avatarUrl: row.avatarUrl ? String(row.avatarUrl) : null, color: row.color ? String(row.color) : null });
      }
    }
    if (!hosts.length) throw new ZiteError('This meeting link isn’t taking bookings at the moment. Reply to the email that brought you here and someone will help.', 'NOT_FOUND');

    return {
      name: page.name,
      slug: page.slug,
      description: page.description,
      durationMinutes: page.durationMinutes,
      timezone: page.timezone,
      location: { kind: page.location.kind, value: page.location.kind === 'video' ? '' : page.location.value, label: page.location.kind === 'video' ? 'Video call — the link is in your confirmation' : describeLocation(page.location) },
      questions: page.questions,
      hosts,
      roundRobin: hosts.length > 1,
      windowDays: page.windowDays,
      minNoticeHours: page.minNoticeHours,
    };
  },
});
