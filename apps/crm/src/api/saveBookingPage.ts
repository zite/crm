import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { assertCan, assertCanManageAsset, assertMember, getActor } from '@project/shared/server/actor';
import { getSettings, pagesLink } from '@project/shared/server/settings';
import { withRetry } from '@project/shared/server/sql';
import { isValidTimezone } from '@project/shared/dates';
import { slugify } from '@project/shared/tokens';
import {
  availabilityToJson,
  defaultAvailability,
  hasAnyAvailability,
  minutesOfDay,
  normalizeAvailability,
  normalizeQuestions,
  serializeLocation,
  toBookingPage,
  type BookingPageRecord,
} from '@project/shared/availability';
import { id, parseInput } from '../server/input';

/**
 * Create or change a meeting link.
 *
 * Every field is optional and merged onto what is already stored, so the editor
 * can send the whole page and the list's active switch can send one field. What
 * is never optional is the check afterwards: whatever the merge produces has to
 * be a page that could actually be booked — hosts, a timezone, and at least one
 * window long enough to hold the meeting. A page that fails that is refused
 * here rather than discovered by a buyer.
 *
 * The slug is what a buyer sees in the URL, so it is slugified on the server and
 * checked for collisions — never trusted from the client.
 */

const timeRange = z.object({
  start: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'Times look like 09:00'),
  end: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'Times look like 09:00'),
});

const inputSchema = z.object({
  id: id.optional(),
  name: z.string().trim().min(1, 'Give the meeting link a name').max(120).optional(),
  slug: z.string().trim().max(60).optional(),
  description: z.string().max(4000).optional(),
  hostIds: z.array(id).min(1, 'Choose at least one host').max(20).optional(),
  durationMinutes: z.number().int().min(5, 'Meetings are at least 5 minutes').max(480, 'Meetings cap at 8 hours').optional(),
  bufferMinutes: z.number().int().min(0).max(240).optional(),
  minNoticeHours: z.number().int().min(0).max(720).optional(),
  windowDays: z.number().int().min(1, 'Allow at least one day').max(365).optional(),
  availability: z.array(z.array(timeRange)).length(7, 'Availability needs one list per weekday').optional(),
  timezone: z.string().min(1).max(64).optional(),
  location: z.object({ kind: z.enum(['video', 'phone', 'address']), value: z.string().max(400).default('') }).optional(),
  questions: z.array(z.object({ id: z.string().max(40).optional(), label: z.string().trim().max(200), required: z.boolean().default(false), long: z.boolean().default(false) })).max(20).optional(),
  active: z.boolean().optional(),
  ownerId: id.nullable().optional(),
});

export default createEndpoint({
  description: 'Create or update a meeting link, its availability and its questions',
  authenticated: true,
  inputSchema,
  outputSchema: z.object({ id: z.string(), slug: z.string(), url: z.string(), created: z.boolean() }),
  execute: async ({ input, context }) => {
    const data = parseInput(inputSchema, input);
    const actor = await getActor(context);
    assertCan(actor, 'outreach.send');

    const existingRow = data.id ? await zite.bookingPages.findOne({ id: data.id }) : null;
    if (data.id && !existingRow) throw new ZiteError('That meeting link doesn’t exist or was deleted', 'NOT_FOUND');
    if (existingRow) assertCanManageAsset(actor, existingRow.ownerId || null, 'meeting link');
    const settings = await getSettings();
    const current: BookingPageRecord | null = existingRow ? toBookingPage(existingRow as unknown as Record<string, unknown>) : null;

    // What the page looks like once this change lands.
    const next = {
      name: (data.name ?? current?.name ?? '').trim(),
      description: (data.description ?? current?.description ?? '').trim(),
      hostIds: data.hostIds ?? current?.hostIds ?? [actor.id],
      durationMinutes: data.durationMinutes ?? current?.durationMinutes ?? 30,
      bufferMinutes: data.bufferMinutes ?? current?.bufferMinutes ?? 0,
      minNoticeHours: data.minNoticeHours ?? current?.minNoticeHours ?? 12,
      windowDays: data.windowDays ?? current?.windowDays ?? 30,
      availability: normalizeAvailability(data.availability ?? current?.availability ?? defaultAvailability()),
      timezone: data.timezone ?? current?.timezone ?? settings.timezone,
      location: data.location ?? current?.location ?? { kind: 'video' as const, value: '' },
      questions: normalizeQuestions((data.questions ?? current?.questions ?? []).map((q, i) => ({ ...q, id: ('id' in q && q.id) || `q${i + 1}${Date.now().toString(36).slice(-4)}` }))),
      active: data.active ?? current?.active ?? true,
      ownerId: data.ownerId === undefined ? current?.ownerId ?? actor.id : data.ownerId,
    };

    if (!next.name) throw new ZiteError('Give the meeting link a name', 'BAD_REQUEST');
    if (!isValidTimezone(next.timezone)) throw new ZiteError('That isn’t a timezone we recognise', 'BAD_REQUEST');
    if (!next.hostIds.length) throw new ZiteError('Choose at least one host', 'BAD_REQUEST');
    if (!hasAnyAvailability(next.availability)) throw new ZiteError('Add at least one time range so people have something to book', 'BAD_REQUEST');
    // A window shorter than the meeting can never produce a slot, and the page
    // would simply look broken to whoever opened it.
    const longest = Math.max(0, ...next.availability.flatMap(day => day.map(r => (minutesOfDay(r.end) ?? 0) - (minutesOfDay(r.start) ?? 0))));
    if (longest < next.durationMinutes) throw new ZiteError(`Every time range is shorter than ${next.durationMinutes} minutes, so nothing could be booked`, 'BAD_REQUEST');
    for (const hostId of next.hostIds) await assertMember(hostId, 'host');

    const slug = slugify(data.slug ?? current?.slug ?? next.name) || 'meet';
    const { rows: clashes } = await zite.sql({ query: `SELECT id FROM "BookingPages" WHERE LOWER("slug") = $1 AND id::text <> $2 LIMIT 1`, params: [slug, data.id ?? ''] });
    if (clashes.length) throw new ZiteError(`The link /m/${slug} is already taken — try a different one`, 'CONFLICT');

    const record = {
      name: next.name,
      slug,
      description: next.description,
      hostIds: JSON.stringify(next.hostIds),
      durationMinutes: next.durationMinutes,
      bufferMinutes: next.bufferMinutes,
      minNoticeHours: next.minNoticeHours,
      windowDays: next.windowDays,
      availability: availabilityToJson(next.availability),
      timezone: next.timezone,
      location: serializeLocation(next.location),
      questions: JSON.stringify(next.questions),
      active: next.active,
      ownerId: next.ownerId,
    };

    const url = pagesLink(settings, `/m/${slug}`);
    if (existingRow) {
      await withRetry(() => zite.bookingPages.update({ id: existingRow.id, record }));
      return { id: existingRow.id, slug, url, created: false };
    }
    const created = await withRetry(() => zite.bookingPages.create({ record: { ...record, bookingCount: 0, rotationCursor: 0 } }));
    return { id: created.id, slug, url, created: true };
  },
});
