import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { runTrigger } from '@project/shared/server/automations';
import { logEvent } from '@project/shared/server/events';
import { notify } from '@project/shared/server/notify';
import { sendEmail } from '@project/shared/server/email';
import { getSettings, pagesLink, appLink } from '@project/shared/server/settings';
import { iso, json, num, str, withRetry } from '@project/shared/server/sql';
import type { Attendee } from '@project/shared/server/activities';
import { describeSlot, isSlotFree, slotOptionsFor, toBookingPage, zoneAbbreviation } from '@project/shared/availability';
import { isValidTimezone } from '@project/shared/dates';
import { parseInput } from '../server/input';
import { loadBusyByHost } from './getAvailability';

/**
 * The invitee's own page for a meeting they booked: read it, move it, or call
 * it off. The unguessable token is the only key — a missing token and a token
 * for someone else's meeting get the identical NOT_FOUND, so the endpoint can't
 * be used to discover that a booking exists.
 *
 * Both changes go through the same door: update the Activity, tell the host in
 * the app and by email, tell the invitee by email, and leave the page in a
 * state that says plainly what happened.
 */

const inputSchema = z.object({
  token: z.string().trim().min(8).max(64),
  action: z.enum(['get', 'reschedule', 'cancel']).default('get'),
  start: z.string().max(40).optional(),
  timezone: z.string().max(64).optional(),
  reason: z.string().trim().max(1000).default(''),
});

const bookingShape = z.object({
  status: z.enum(['scheduled', 'canceled', 'past']),
  pageName: z.string(),
  slug: z.string(),
  start: z.string(),
  end: z.string(),
  durationMinutes: z.number(),
  location: z.string(),
  hostName: z.string(),
  hostTitle: z.string().nullable(),
  hostAvatarUrl: z.string().nullable(),
  hostTimezone: z.string(),
  inviteeName: z.string(),
  inviteeEmail: z.string().nullable(),
  canceledReason: z.string().nullable(),
  canReschedule: z.boolean(),
});

const CANCEL_MARK = '— Canceled by the invitee';

export default createEndpoint({
  description: 'Read, reschedule or cancel a booking from its manage link',
  inputSchema,
  outputSchema: bookingShape,
  execute: async ({ input }) => {
    const data = parseInput(inputSchema, input);
    const missing = () => new ZiteError('We couldn’t find that booking. The link may have expired, or the meeting may already have been canceled.', 'NOT_FOUND');

    const { rows } = await zite.sql({
      query: `SELECT a.*, b."name" AS "pageName", b."slug", b."timezone" AS "pageTimezone", b."hostIds", b."durationMinutes" AS "pageDuration",
          b."bufferMinutes", b."minNoticeHours", b."windowDays", b."availability", b."active", b."location" AS "pageLocation",
          m."name" AS "hostName", m."title" AS "hostTitle", m."avatarUrl" AS "hostAvatarUrl", m."email" AS "hostEmail"
        FROM "Activities" a
        LEFT JOIN "BookingPages" b ON b.id::text = a."bookingPageId"
        LEFT JOIN "Members" m ON m.id::text = a."ownerId"
        WHERE a."publicToken" = $1 AND a."kind" = 'Meeting' LIMIT 1`,
      params: [data.token],
    });
    const row = rows[0];
    if (!row) throw missing();

    const startIso = iso(row.occurredAt) ?? '';
    const duration = num(row.durationMinutes, num(row.pageDuration, 30));
    const endIso = iso(row.endsAt) ?? new Date(Date.parse(startIso) + duration * 60_000).toISOString();
    const attendees = json<Attendee[]>(row.attendees, []);
    const invitee = attendees.find(a => !a.memberId) ?? attendees[0] ?? null;
    const hostId = str(row.ownerId) || '';
    const hostEmail = str(row.hostEmail) || '';
    const hostName = str(row.hostName) || 'your host';
    const pageTimezone = str(row.pageTimezone) || 'America/New_York';
    const slug = str(row.slug) || '';
    const pageName = str(row.pageName) || str(row.subject) || 'Meeting';
    const body = str(row.body) || '';

    const describe = (over: { start: string; end: string; outcome: string | null; body: string }) => {
      const canceled = over.outcome === 'Canceled';
      const past = Date.parse(over.start) < Date.now();
      const reasonMatch = over.body.split(CANCEL_MARK)[1]?.trim() ?? '';
      return {
        status: (canceled ? 'canceled' : past ? 'past' : 'scheduled') as 'scheduled' | 'canceled' | 'past',
        pageName,
        slug,
        start: over.start,
        end: over.end,
        durationMinutes: duration,
        location: str(row.location) || '',
        hostName,
        hostTitle: str(row.hostTitle) || null,
        hostAvatarUrl: str(row.hostAvatarUrl) || null,
        hostTimezone: pageTimezone,
        inviteeName: invitee?.name || 'You',
        inviteeEmail: invitee?.email || str(row.emailTo) || null,
        canceledReason: canceled ? reasonMatch || null : null,
        // A meeting that has already happened, or whose link was retired, can be
        // read but not moved.
        canReschedule: !canceled && !past && Boolean(slug) && row.active === true,
      };
    };

    const current = describe({ start: startIso, end: endIso, outcome: str(row.outcome), body });
    if (data.action === 'get') return current;
    if (current.status === 'canceled') throw new ZiteError('This meeting was already canceled.', 'CONFLICT');
    if (current.status === 'past') throw new ZiteError('This meeting has already happened.', 'CONFLICT');

    const settings = await getSettings();
    const manageUrl = pagesLink(settings, `/m/booking/${data.token}`);
    const visitorTimezone = data.timezone && isValidTimezone(data.timezone) ? data.timezone : pageTimezone;
    const recordLink = str(row.contactId) ? `/contacts/${str(row.contactId)}` : str(row.leadId) ? `/leads/${str(row.leadId)}` : '/tasks/meetings';
    const inviteeEmail = current.inviteeEmail ?? '';

    /* ---- Move it ---- */
    if (data.action === 'reschedule') {
      if (!current.canReschedule) throw new ZiteError('This meeting can’t be moved any more. Reply to your confirmation email and someone will sort it out.', 'CONFLICT');
      if (!data.start || Number.isNaN(Date.parse(data.start))) throw new ZiteError('Pick a new time first', 'BAD_REQUEST');
      const newStart = new Date(data.start).toISOString();
      if (newStart === startIso) throw new ZiteError('That’s the time you already have', 'BAD_REQUEST');
      const newEnd = new Date(Date.parse(newStart) + duration * 60_000).toISOString();

      const page = toBookingPage({
        availability: row.availability,
        durationMinutes: duration,
        bufferMinutes: row.bufferMinutes,
        minNoticeHours: row.minNoticeHours,
        windowDays: row.windowDays,
        timezone: pageTimezone,
      });
      const busy = await loadBusyByHost([hostId], new Date(Date.parse(newStart) - 3 * 86_400_000).toISOString(), new Date(Date.parse(newStart) + 3 * 86_400_000).toISOString(), String(row.id));
      const free = isSlotFree(newStart, slotOptionsFor(page, { visitorTimezone, busy: busy.get(hostId) ?? [] }));
      if (!free) {
        const everOffered = isSlotFree(newStart, slotOptionsFor(page, { visitorTimezone, busy: [] }));
        throw everOffered
          ? new ZiteError('That time isn’t free any more. Pick another one — the times below are current.', 'CONFLICT')
          : new ZiteError('That isn’t a time this page offers. Pick one from the list.', 'BAD_REQUEST');
      }

      await withRetry(() => zite.activities.update({ id: String(row.id), record: { occurredAt: newStart, endsAt: newEnd, outcome: 'Scheduled' } }));

      const whenOld = `${describeSlot(startIso, pageTimezone)} (${zoneAbbreviation(pageTimezone, new Date(startIso))})`;
      const whenNewHost = `${describeSlot(newStart, pageTimezone)} (${zoneAbbreviation(pageTimezone, new Date(newStart))})`;
      const whenNewGuest = `${describeSlot(newStart, visitorTimezone)} (${zoneAbbreviation(visitorTimezone, new Date(newStart))})`;

      await notify({
        recipientIds: [hostId],
        kind: 'meeting_booked',
        title: `${current.inviteeName} moved ${pageName}`,
        body: `Was ${whenOld}. Now ${whenNewHost}.`,
        link: recordLink,
        entityType: 'activity',
        entityId: String(row.id),
        actorId: null,
      });
      if (str(row.contactId) || str(row.leadId)) {
        await logEvent({
          kind: 'meeting.rescheduled',
          entity: str(row.contactId) ? { type: 'contact', id: String(row.contactId) } : { type: 'lead', id: String(row.leadId) },
          actorId: null,
          summary: `moved ${pageName} from ${whenOld} to ${whenNewHost}`,
          contactId: str(row.contactId) || null,
          leadId: str(row.leadId) || null,
          companyId: str(row.companyId) || null,
        }).catch(() => undefined);
      }
      await sendEmail({
        to: inviteeEmail,
        subject: `Moved: ${pageName} with ${hostName}`,
        text: [`Hi ${current.inviteeName.split(/\s+/)[0]},`, `Your meeting with ${hostName} is now ${whenNewGuest}.`, `That's ${whenNewHost} for ${hostName}.`, `Where: ${current.location}`].join('\n\n'),
        button: manageUrl ? { label: 'Reschedule or cancel', href: manageUrl } : null,
        replyTo: hostEmail || null,
        settings,
      });
      await sendEmail({
        to: hostEmail,
        subject: `Moved: ${current.inviteeName} — ${whenNewHost}`,
        text: [`${current.inviteeName} moved ${pageName}.`, `Was: ${whenOld}\nNow: ${whenNewHost}\nTheir time: ${whenNewGuest}`].join('\n\n'),
        button: appLink(recordLink) ? { label: 'Open the record', href: appLink(recordLink) } : null,
        replyTo: inviteeEmail || null,
        settings,
      });
      await runTrigger('meeting.booked', { entityType: 'activity', entityId: String(row.id), actorId: null, data: { rescheduled: true, from: startIso, to: newStart } });
      return describe({ start: newStart, end: newEnd, outcome: 'Scheduled', body });
    }

    /* ---- Call it off ---- */
    const reason = data.reason.trim();
    const newBody = [body, `${CANCEL_MARK}${reason ? `\n${reason}` : ''}`].filter(Boolean).join('\n\n');
    await withRetry(() => zite.activities.update({ id: String(row.id), record: { outcome: 'Canceled', body: newBody.slice(0, 20_000) } }));

    const whenHost = `${describeSlot(startIso, pageTimezone)} (${zoneAbbreviation(pageTimezone, new Date(startIso))})`;
    await notify({
      recipientIds: [hostId],
      kind: 'meeting_booked',
      title: `${current.inviteeName} canceled ${pageName}`,
      body: `${whenHost}${reason ? `\n“${reason}”` : ''}`,
      link: recordLink,
      entityType: 'activity',
      entityId: String(row.id),
      actorId: null,
    });
    if (str(row.contactId) || str(row.leadId)) {
      await logEvent({
        kind: 'meeting.canceled',
        entity: str(row.contactId) ? { type: 'contact', id: String(row.contactId) } : { type: 'lead', id: String(row.leadId) },
        actorId: null,
        summary: `canceled ${pageName}, which was ${whenHost}${reason ? ` — “${reason}”` : ''}`,
        contactId: str(row.contactId) || null,
        leadId: str(row.leadId) || null,
        companyId: str(row.companyId) || null,
      }).catch(() => undefined);
    }
    await sendEmail({
      to: inviteeEmail,
      subject: `Canceled: ${pageName} with ${hostName}`,
      text: [`Hi ${current.inviteeName.split(/\s+/)[0]},`, `Your meeting on ${describeSlot(startIso, visitorTimezone)} is canceled. Nothing else to do.`, slug ? 'If you’d like another time, book one whenever suits.' : ''].filter(Boolean).join('\n\n'),
      button: slug && pagesLink(settings, `/m/${slug}`) ? { label: 'Book another time', href: pagesLink(settings, `/m/${slug}`) } : null,
      replyTo: hostEmail || null,
      settings,
    });
    await sendEmail({
      to: hostEmail,
      subject: `Canceled: ${current.inviteeName} — ${whenHost}`,
      text: [`${current.inviteeName} canceled ${pageName}.`, `Was: ${whenHost}`, reason ? `Their reason: “${reason}”` : 'They didn’t give a reason.'].join('\n\n'),
      button: appLink(recordLink) ? { label: 'Open the record', href: appLink(recordLink) } : null,
      replyTo: inviteeEmail || null,
      settings,
    });
    return describe({ start: startIso, end: endIso, outcome: 'Canceled', body: newBody });
  },
});
