import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { createActivity } from '@project/shared/server/activities';
import { runTrigger } from '@project/shared/server/automations';
import { logEvent } from '@project/shared/server/events';
import { notify } from '@project/shared/server/notify';
import { sendEmail } from '@project/shared/server/email';
import { getSettings, pagesLink, appLink } from '@project/shared/server/settings';
import { num, str, withRetry } from '@project/shared/server/sql';
import { randomToken } from '@project/shared/tokens';
import { scoreLead } from '@project/shared/leads';
import { assignHost, describeLocation, describeSlot, isSlotFree, slotOptionsFor, zoneAbbreviation } from '@project/shared/availability';
import { isValidTimezone } from '@project/shared/dates';
import { EMAIL_RE } from '@project/shared/format';
import { parseInput } from '../server/input';
import { loadBusyByHost, loadPublicPage } from './getAvailability';

/**
 * Book a meeting from a public page. Unauthenticated and it writes, so it is
 * paranoid in a specific order:
 *
 *   1. re-parse the whole body (Zite does not enforce inputSchema);
 *   2. refuse an obvious bot (the honeypot field, an absurd number of bookings
 *      from one address);
 *   3. re-run the slot calculator server-side — the browser's list of times is
 *      a suggestion, never a permission;
 *   4. write, then look again for a second meeting in the same slot and undo
 *      ours if we lost the race, so two people can't both walk away believing
 *      they have 10am.
 *
 * Who the buyer becomes: an email we already know is linked to that Contact.
 * An email we don't know becomes a **Lead**, not a Contact — a stranger who
 * booked a meeting is exactly what this CRM calls a lead, and converting them
 * (which creates the contact and company properly) is a decision a rep makes
 * on the lead page, not one a booking form makes for them.
 */

const inputSchema = z.object({
  slug: z.string().trim().min(1).max(80),
  /** The slot start, as the UTC ISO string the page was given. */
  start: z.string().min(10).max(40).refine(v => !Number.isNaN(Date.parse(v)), 'Pick a time'),
  timezone: z.string().min(1).max(64),
  name: z.string().trim().min(1, 'Add your name').max(120),
  email: z.string().trim().min(3).max(200).refine(v => EMAIL_RE.test(v), 'Check the email address'),
  company: z.string().trim().max(160).default(''),
  notes: z.string().trim().max(4000).default(''),
  answers: z.array(z.object({ id: z.string().max(40), label: z.string().max(200), value: z.string().max(2000) })).max(20).default([]),
  /** Hidden field: a person never fills this in. */
  website: z.string().max(200).default(''),
});

export default createEndpoint({
  description: 'Book a meeting on a public meeting link',
  inputSchema,
  outputSchema: z.object({
    token: z.string(),
    manageUrl: z.string(),
    start: z.string(),
    end: z.string(),
    durationMinutes: z.number(),
    hostName: z.string(),
    hostTimezone: z.string(),
    visitorTimezone: z.string(),
    location: z.string(),
    pageName: z.string(),
  }),
  execute: async ({ input }) => {
    const data = parseInput(inputSchema, input);
    if (data.website.trim()) throw new ZiteError('That didn’t look like a real booking. Try again from the link you were sent.', 'BAD_REQUEST');

    const page = await loadPublicPage(data.slug);
    const visitorTimezone = isValidTimezone(data.timezone) ? data.timezone : page.timezone;
    const email = data.email.toLowerCase();
    const start = new Date(data.start);
    const startIso = start.toISOString();
    const endIso = new Date(start.getTime() + page.durationMinutes * 60_000).toISOString();

    for (const question of page.questions) {
      if (!question.required) continue;
      const answer = data.answers.find(a => a.id === question.id);
      if (!answer || !answer.value.trim()) throw new ZiteError(`Please answer “${question.label}”`, 'BAD_REQUEST');
    }

    // Someone hammering the form: five meetings still to come from one address
    // is not a buyer.
    const { rows: abuse } = await zite.sql({
      query: `SELECT COUNT(*) AS "recentTotal" FROM "Activities"
        WHERE "bookingPageId" = $1 AND "kind" = 'Meeting' AND COALESCE("outcome", '') <> 'Canceled'
          AND "occurredAt" >= $2 AND LOWER(COALESCE("emailTo", '')) = $3`,
      params: [page.id, new Date().toISOString(), email],
    });
    if (num(abuse[0]?.recentTotal) >= 5) throw new ZiteError('You already have several meetings booked on this link. Reschedule one of those instead.', 'CONFLICT');

    /* ---- Who is this, and who takes the meeting ---- */

    const { rows: contactRows } = await zite.sql({ query: `SELECT id, "name", "companyId", "ownerId" FROM "Contacts" WHERE LOWER("email") = $1 ORDER BY created_at ASC LIMIT 1`, params: [email] });
    const contact = contactRows[0] ?? null;
    let contactId = contact ? String(contact.id) : null;
    let companyId = contact ? str(contact.companyId) || null : null;
    let leadId: string | null = null;

    const busy = await loadBusyByHost(page.hostIds, new Date(start.getTime() - 3 * 86_400_000).toISOString(), new Date(start.getTime() + 3 * 86_400_000).toISOString());
    // A customer we already know keeps their own rep, when that rep is a host
    // on this page. Everyone else takes their turn in the rotation.
    const ownerId = contact ? str(contact.ownerId) || '' : '';
    const preferred = ownerId && page.hostIds.includes(ownerId) ? { ...page, hostIds: [ownerId, ...page.hostIds.filter(h => h !== ownerId)], rotationCursor: 0 } : page;
    const assigned = assignHost(startIso, preferred, busy, { visitorTimezone });
    if (!assigned.hostId) {
      // Taken, or never offered at all? The second is a stale tab or a hand-made
      // request, and deserves different words.
      const everOffered = isSlotFree(startIso, slotOptionsFor(page, { visitorTimezone, busy: [] }));
      throw everOffered
        ? new ZiteError('That time has just been taken. Pick another one — the page has the latest times.', 'CONFLICT')
        : new ZiteError('That isn’t a time this page offers. Pick one from the list.', 'BAD_REQUEST');
    }
    const hostId = assigned.hostId;
    // The cursor only advances when the rotation actually chose; a returning
    // customer routed to their own rep must not skip someone's turn.
    const nextCursor = preferred === page ? assigned.nextCursor : page.rotationCursor;

    const { rows: hostRows } = await zite.sql({ query: `SELECT id, "name", "email", "title", "timezone" FROM "Members" WHERE id::text = $1`, params: [hostId] });
    const host = hostRows[0];
    if (!host) throw new ZiteError('This meeting link isn’t taking bookings at the moment.', 'NOT_FOUND');
    const hostName = String(host.name ?? '');

    if (!contactId) {
      const { rows: leadRows } = await zite.sql({ query: `SELECT id, "status", "ownerId" FROM "Leads" WHERE LOWER("email") = $1 AND "convertedAt" IS NULL ORDER BY created_at DESC LIMIT 1`, params: [email] });
      if (leadRows[0]) {
        leadId = String(leadRows[0].id);
        // A lead who books is being worked — but never take them off the person
        // who already owns them.
        const patch: Record<string, unknown> = {};
        if (str(leadRows[0].status) === 'New') patch.status = 'Working';
        if (!str(leadRows[0].ownerId)) patch.ownerId = hostId;
        if (Object.keys(patch).length) await withRetry(() => zite.leads.update({ id: leadId as string, record: patch as never })).catch(() => undefined);
      } else {
        const parts = data.name.split(/\s+/);
        const scored = scoreLead({ title: null, email, companyName: data.company || null, source: 'Meeting link', message: data.notes || null });
        const created = await withRetry(() =>
          zite.leads.create({
            record: {
              name: data.name,
              firstName: parts[0] ?? data.name,
              lastName: parts.slice(1).join(' ') || null,
              email,
              companyName: data.company || null,
              source: 'Meeting link',
              sourceDetail: page.name,
              status: 'Working',
              score: scored.score,
              ownerId: hostId,
              message: data.notes || null,
              receivedAt: new Date().toISOString(),
            },
          }),
        );
        leadId = created.id;
      }
    }

    /* ---- Write the meeting ---- */

    const token = randomToken(28);
    const locationLine = describeLocation(page.location);
    const answerLines = data.answers.filter(a => a.value.trim()).map(a => `${a.label}: ${a.value.trim()}`);
    const bodyParts = [data.notes.trim(), answerLines.join('\n'), data.company.trim() ? `Company: ${data.company.trim()}` : ''].filter(Boolean);
    const activityId = await createActivity(null, {
      kind: 'Meeting',
      subject: `${page.name} — ${data.name}`,
      body: bodyParts.join('\n\n') || null,
      occurredAt: startIso,
      endsAt: endIso,
      durationMinutes: page.durationMinutes,
      outcome: 'Scheduled',
      location: locationLine,
      emailTo: email,
      attendees: [
        { name: hostName, email: str(host.email), memberId: hostId },
        { name: data.name, email, contactId },
      ],
      ownerId: hostId,
      contactId,
      leadId,
      companyId,
      bookingPageId: page.id,
      publicToken: token,
    });

    // Did someone else take the same slot while we were writing? The earlier
    // row wins; ours is removed so nobody is told they have a time they don't.
    const { rows: clash } = await zite.sql({
      query: `SELECT id FROM "Activities"
        WHERE "kind" = 'Meeting' AND "ownerId" = $1 AND COALESCE("outcome", '') <> 'Canceled'
          AND "occurredAt" < $3 AND COALESCE("endsAt", "occurredAt") > $2 AND id::text <> $4
        ORDER BY created_at ASC LIMIT 1`,
      params: [hostId, startIso, endIso, activityId],
    });
    if (clash.length) {
      await zite.activities.delete({ id: activityId }).catch(() => undefined);
      throw new ZiteError('That time has just been taken. Pick another one — the page has the latest times.', 'CONFLICT');
    }

    await withRetry(() => zite.bookingPages.update({ id: page.id, record: { bookingCount: page.bookingCount + 1, rotationCursor: nextCursor } })).catch(() => undefined);

    /* ---- Tell everyone ---- */

    const settings = await getSettings();
    const manageUrl = pagesLink(settings, `/m/booking/${token}`);
    const recordLink = contactId ? `/contacts/${contactId}` : leadId ? `/leads/${leadId}` : '/tasks/meetings';
    const whenHost = `${describeSlot(startIso, page.timezone)} (${zoneAbbreviation(page.timezone, start)})`;
    const whenGuest = `${describeSlot(startIso, visitorTimezone)} (${zoneAbbreviation(visitorTimezone, start)})`;

    await notify({
      recipientIds: [hostId],
      kind: 'meeting_booked',
      title: `${data.name} booked ${page.name}`,
      body: `${whenHost}${data.company ? ` · ${data.company}` : ''}${data.notes ? `\n${data.notes.slice(0, 200)}` : ''}`,
      link: recordLink,
      entityType: 'activity',
      entityId: activityId,
      actorId: null,
    });

    if (contactId || leadId) {
      await logEvent({
        kind: 'meeting.booked',
        entity: contactId ? { type: 'contact', id: contactId } : { type: 'lead', id: leadId as string },
        actorId: null,
        summary: `booked ${page.name} with ${hostName} for ${whenHost}`,
        contactId,
        leadId,
        companyId,
        data: { bookingPageId: page.id, activityId },
      }).catch(() => undefined);
    }

    await sendEmail({
      to: email,
      subject: `Confirmed: ${page.name} with ${hostName}`,
      text: [
        `Hi ${data.name.split(/\s+/)[0]},`,
        `Your ${page.durationMinutes}-minute ${page.name.toLowerCase()} with ${hostName} is confirmed for ${whenGuest}.`,
        `That's ${whenHost} for ${hostName}.`,
        `Where: ${locationLine}`,
        'Need a different time, or can’t make it? Use the link below.',
      ].join('\n\n'),
      button: manageUrl ? { label: 'Reschedule or cancel', href: manageUrl } : null,
      replyTo: str(host.email),
      settings,
    });

    await sendEmail({
      to: str(host.email) ?? '',
      subject: `New meeting: ${data.name} — ${whenHost}`,
      text: [
        `${data.name} booked ${page.name}.`,
        `When: ${whenHost}\nTheir time: ${whenGuest}\nWhere: ${locationLine}`,
        `Email: ${email}${data.company ? `\nCompany: ${data.company}` : ''}`,
        bodyParts.length ? bodyParts.join('\n') : 'They didn’t leave a note.',
      ].join('\n\n'),
      button: appLink(recordLink) ? { label: contactId ? 'Open the contact' : 'Open the lead', href: appLink(recordLink) } : null,
      replyTo: email,
      settings,
    });

    await runTrigger('meeting.booked', { entityType: 'activity', entityId: activityId, actorId: null, data: { bookingPageId: page.id, contactId, leadId, hostId } });

    return {
      token,
      manageUrl,
      start: startIso,
      end: endIso,
      durationMinutes: page.durationMinutes,
      hostName,
      hostTimezone: page.timezone,
      visitorTimezone,
      location: locationLine,
      pageName: page.name,
    };
  },
});
