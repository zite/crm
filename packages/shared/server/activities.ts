import { zite } from 'zitejs/db';
import type { ActivityKind, ActivityOutcome, Direction, EmailDelivery } from '../constants';
import type { Actor } from './actor';
import { runTrigger } from './automations';
import { notify } from './notify';
import { entityPath, resolveLinks, touchRecords, type Links } from './records';
import { exitEnrollments } from './sequences';
import { bool, iso, num, numOrNull, ref, str, withRetry, json } from './sql';

/**
 * Activities are the interactions on a timeline: notes, calls, emails and
 * meetings. `createActivity` is the only writer, so every path — the composer,
 * the email sender, sequences, meeting links — keeps last-activity dates,
 * speed-to-lead and @mentions right.
 *
 * Mentions are written in the body as `@[Maya Brooks](member:<id>)`; the
 * timeline renders them as chips and each mentioned teammate is notified.
 */

export const MENTION_RE = /@\[([^\]]{1,80})\]\(member:([A-Za-z0-9-]{6,64})\)/g;

export type Attendee = { name: string; email?: string | null; contactId?: string | null; memberId?: string | null };

export type ActivityInput = Links & {
  kind: ActivityKind;
  subject?: string | null;
  body?: string | null;
  occurredAt?: string | null;
  endsAt?: string | null;
  durationMinutes?: number | null;
  outcome?: ActivityOutcome | null;
  direction?: Direction | null;
  emailFrom?: string | null;
  emailTo?: string | null;
  emailCc?: string | null;
  delivery?: EmailDelivery | null;
  location?: string | null;
  attendees?: Attendee[] | null;
  ownerId?: string | null;
  enrollmentId?: string | null;
  bookingPageId?: string | null;
  publicToken?: string | null;
};

function defaultSubject(input: ActivityInput) {
  switch (input.kind) {
    case 'Call':
      return input.outcome ? `Call · ${input.outcome}` : 'Call';
    case 'Meeting':
      return 'Meeting';
    case 'Email':
      return '(no subject)';
    default:
      return (input.body ?? '').replace(MENTION_RE, '@$1').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Note';
  }
}

export async function createActivity(actor: Pick<Actor, 'id' | 'name'> | null, input: ActivityInput) {
  const links = await resolveLinks(input);
  const occurredAt = input.occurredAt ?? new Date().toISOString();
  const record = {
    kind: input.kind,
    subject: (input.subject?.trim() || defaultSubject(input)).slice(0, 240),
    body: input.body ?? null,
    occurredAt,
    endsAt: input.endsAt ?? null,
    durationMinutes: input.durationMinutes ?? null,
    outcome: input.outcome ?? null,
    direction: input.direction ?? (input.kind === 'Email' || input.kind === 'Call' ? 'Outbound' : null),
    emailFrom: input.emailFrom ?? null,
    emailTo: input.emailTo ?? null,
    emailCc: input.emailCc ?? null,
    delivery: input.delivery ?? null,
    location: input.location ?? null,
    attendees: input.attendees?.length ? JSON.stringify(input.attendees) : null,
    ownerId: input.ownerId === undefined ? actor?.id ?? null : input.ownerId,
    createdById: actor?.id ?? null,
    enrollmentId: input.enrollmentId ?? null,
    bookingPageId: input.bookingPageId ?? null,
    publicToken: input.publicToken ?? null,
    ...links,
  };
  const created = await withRetry(() => zite.activities.create({ record }));

  // A future meeting isn't activity yet; everything else touches its records.
  const isFuture = Date.parse(occurredAt) > Date.now() + 60_000;
  if (!isFuture) {
    const outbound = record.direction === 'Outbound' && (input.kind === 'Email' ? input.delivery !== 'Not Sent' && input.delivery !== 'Failed' : input.kind === 'Call');
    await touchRecords(links, occurredAt, { outbound: outbound || input.kind === 'Meeting' });
  }

  // Replies and booked meetings end automated outreach for that contact.
  if (links.contactId) {
    if (input.kind === 'Email' && record.direction === 'Inbound') await exitEnrollments({ contactId: links.contactId, reason: 'Replied' });
    if (input.kind === 'Meeting' && !input.enrollmentId) await exitEnrollments({ contactId: links.contactId, reason: 'Meeting booked' });
  }

  const mentioned = [...(input.body ?? '').matchAll(MENTION_RE)].map(m => m[2]);
  if (mentioned.length && actor) {
    const target = links.dealId ? entityPath('deal', links.dealId) : links.contactId ? entityPath('contact', links.contactId) : links.companyId ? entityPath('company', links.companyId) : links.leadId ? entityPath('lead', links.leadId) : '/home';
    await notify({
      recipientIds: mentioned,
      kind: 'mention',
      title: `${actor.name} mentioned you in ${input.kind === 'Note' ? 'a note' : `a ${input.kind.toLowerCase()}`}`,
      body: (input.body ?? '').replace(MENTION_RE, '@$1').slice(0, 280),
      link: target,
      entityType: 'activity',
      entityId: created.id,
      actorId: actor.id,
    });
  }

  await runTrigger('activity.logged', { entityType: 'activity', entityId: created.id, actorId: actor?.id ?? null, data: { kind: input.kind } });
  return created.id;
}

export type ActivityRow = {
  id: string;
  kind: ActivityKind;
  subject: string;
  body: string | null;
  occurredAt: string;
  endsAt: string | null;
  durationMinutes: number | null;
  outcome: string | null;
  direction: string | null;
  emailFrom: string | null;
  emailTo: string | null;
  emailCc: string | null;
  delivery: string | null;
  location: string | null;
  attendees: Attendee[];
  ownerId: string | null;
  createdById: string | null;
  companyId: string | null;
  contactId: string | null;
  dealId: string | null;
  leadId: string | null;
  enrollmentId: string | null;
  bookingPageId: string | null;
  pinned: boolean;
};

export function toActivityRow(r: Record<string, unknown>): ActivityRow {
  return {
    id: String(r.id),
    kind: (str(r.kind) || 'Note') as ActivityKind,
    subject: str(r.subject) ?? '',
    body: str(r.body) || null,
    occurredAt: iso(r.occurredAt) ?? iso(r.created_at) ?? new Date(0).toISOString(),
    endsAt: iso(r.endsAt),
    durationMinutes: numOrNull(r.durationMinutes),
    outcome: str(r.outcome) || null,
    direction: str(r.direction) || null,
    emailFrom: str(r.emailFrom) || null,
    emailTo: str(r.emailTo) || null,
    emailCc: str(r.emailCc) || null,
    delivery: str(r.delivery) || null,
    location: str(r.location) || null,
    attendees: json<Attendee[]>(r.attendees, []),
    ownerId: ref(r.ownerId),
    createdById: ref(r.createdById),
    companyId: ref(r.companyId),
    contactId: ref(r.contactId),
    dealId: ref(r.dealId),
    leadId: ref(r.leadId),
    enrollmentId: ref(r.enrollmentId),
    bookingPageId: ref(r.bookingPageId),
    pinned: bool(r.pinned),
  };
}


