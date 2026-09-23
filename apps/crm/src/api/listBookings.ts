import { z } from 'zod';
import { createEndpoint } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { getActor } from '@project/shared/server/actor';
import { iso, json, num, numOrNull, ref, str, Params } from '@project/shared/server/sql';
import type { Attendee } from '@project/shared/server/activities';
import { id, parseInput } from '../server/input';

/**
 * Meetings booked through a meeting link. A booking is an Activity of kind
 * Meeting carrying a `bookingPageId`, so it already lives on the contact's or
 * lead's timeline — this is the same rows, read from the meeting link's side.
 *
 * Who booked comes from the attendees list first (that is the name the buyer
 * typed) and falls back to the linked contact or lead.
 */

const booking = z.object({
  id: z.string(),
  pageId: z.string().nullable(),
  pageName: z.string().nullable(),
  subject: z.string(),
  occurredAt: z.string(),
  endsAt: z.string().nullable(),
  durationMinutes: z.number().nullable(),
  outcome: z.string().nullable(),
  location: z.string().nullable(),
  body: z.string().nullable(),
  hostId: z.string().nullable(),
  inviteeName: z.string(),
  inviteeEmail: z.string().nullable(),
  contactId: z.string().nullable(),
  contactName: z.string().nullable(),
  leadId: z.string().nullable(),
  leadName: z.string().nullable(),
  companyId: z.string().nullable(),
  companyName: z.string().nullable(),
  bookedAt: z.string().nullable(),
});

const inputSchema = z.object({
  pageId: id.optional(),
  when: z.enum(['upcoming', 'past', 'all']).default('all'),
  limit: z.number().int().min(1).max(500).default(200),
});

export default createEndpoint({
  description: 'List meetings booked through a meeting link, upcoming or past',
  authenticated: true,
  inputSchema,
  outputSchema: z.object({ bookings: z.array(booking), counts: z.object({ upcoming: z.number(), past: z.number(), canceled: z.number() }) }),
  execute: async ({ input, context }) => {
    const { pageId, when, limit } = parseInput(inputSchema, input);
    await getActor(context);
    const now = new Date().toISOString();

    const p = new Params();
    const where = [`a."kind" = 'Meeting'`, `COALESCE(a."bookingPageId", '') <> ''`];
    if (pageId) where.push(`a."bookingPageId" = ${p.add(pageId)}`);
    // Bind `now` only where it is used: a parameter that appears nowhere in the
    // statement makes Postgres refuse it ("could not determine data type of $1").
    if (when === 'upcoming') where.push(`a."occurredAt" >= ${p.add(now)} AND COALESCE(a."outcome", '') <> 'Canceled'`);
    if (when === 'past') where.push(`(a."occurredAt" < ${p.add(now)} OR a."outcome" = 'Canceled')`);

    const { rows } = await zite.sql({
      query: `SELECT a.id, a."bookingPageId", a."subject", a."occurredAt", a."endsAt", a."durationMinutes", a."outcome",
          a."location", a."body", a."ownerId", a."attendees", a."contactId", a."leadId", a."companyId", a.created_at,
          b."name" AS "pageName", c."name" AS "contactName", c."email" AS "contactEmail",
          l."name" AS "leadName", l."email" AS "leadEmail", co."name" AS "companyName"
        FROM "Activities" a
        LEFT JOIN "BookingPages" b ON b.id::text = a."bookingPageId"
        LEFT JOIN "Contacts" c ON c.id::text = a."contactId"
        LEFT JOIN "Leads" l ON l.id::text = a."leadId"
        LEFT JOIN "Companies" co ON co.id::text = a."companyId"
        WHERE ${where.join(' AND ')}
        ORDER BY a."occurredAt" ${when === 'past' ? 'DESC' : 'ASC'}
        LIMIT ${p.add(limit)}`,
      params: p.values,
    });

    const countParams = new Params();
    const pageClause = pageId ? ` AND "bookingPageId" = ${countParams.add(pageId)}` : '';
    const nowCount = countParams.add(now);
    const { rows: countRows } = await zite.sql({
      query: `SELECT
          COUNT(*) FILTER (WHERE "occurredAt" >= ${nowCount} AND COALESCE("outcome", '') <> 'Canceled') AS "upcomingTotal",
          COUNT(*) FILTER (WHERE "occurredAt" < ${nowCount} AND COALESCE("outcome", '') <> 'Canceled') AS "pastTotal",
          COUNT(*) FILTER (WHERE "outcome" = 'Canceled') AS "canceledTotal"
        FROM "Activities" WHERE "kind" = 'Meeting' AND COALESCE("bookingPageId", '') <> ''${pageClause}`,
      params: countParams.values,
    });
    const counts = countRows[0] ?? {};

    return {
      bookings: rows.map(r => {
        const attendees = json<Attendee[]>(r.attendees, []);
        // The host is a member; the invitee is whoever isn't.
        const invitee = attendees.find(a => !a.memberId) ?? attendees[0] ?? null;
        return {
          id: String(r.id),
          pageId: ref(r.bookingPageId),
          pageName: str(r.pageName) || null,
          subject: str(r.subject) ?? '',
          occurredAt: iso(r.occurredAt) ?? '',
          endsAt: iso(r.endsAt),
          durationMinutes: numOrNull(r.durationMinutes),
          outcome: str(r.outcome) || null,
          location: str(r.location) || null,
          body: str(r.body) || null,
          hostId: ref(r.ownerId),
          inviteeName: invitee?.name || str(r.contactName) || str(r.leadName) || 'Someone',
          inviteeEmail: invitee?.email || str(r.contactEmail) || str(r.leadEmail) || null,
          contactId: ref(r.contactId),
          contactName: str(r.contactName) || null,
          leadId: ref(r.leadId),
          leadName: str(r.leadName) || null,
          companyId: ref(r.companyId),
          companyName: str(r.companyName) || null,
          bookedAt: iso(r.created_at),
        };
      }),
      counts: { upcoming: num(counts.upcomingTotal), past: num(counts.pastTotal), canceled: num(counts.canceledTotal) },
    };
  },
});
