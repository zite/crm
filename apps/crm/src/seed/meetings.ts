import { zite } from 'zitejs/db';
import { chunked, withRetry } from '@project/shared/server/sql';
import { availabilityToJson, describeLocation, parseLocation, serializeLocation, type Availability, type BookingQuestion } from '@project/shared/availability';
import { addDays as addCalendarDays, weekday, zonedToUtc } from '@project/shared/dates';
import type { SeedPhase } from './core';
import { memberMap, ownerFor } from './core';
import { int, pick } from './rng';

/**
 * Demo data for meeting links: the two pages a sales team actually runs — a
 * short intro call shared round-robin between the account executives, and a
 * longer technical session with one named rep — plus a handful of meetings
 * booked through them, some already behind us and some still to come, so both
 * tabs of the editor have something to show.
 *
 * Everything is derived from `today` and the fixed seed, so the demo looks the
 * same tomorrow and never calls Math.random().
 */

const TZ = 'America/Los_Angeles';

const ranges = (...pairs: Array<[string, string]>) => pairs.map(([start, end]) => ({ start, end }));

/** Weekdays only, so availability can list the days it wants. */
function weekdays(days: number[], windows: Array<[string, string]>): Availability {
  return [0, 1, 2, 3, 4, 5, 6].map(d => (days.includes(d) ? ranges(...windows) : []));
}

type SeedPage = {
  key: string;
  name: string;
  slug: string;
  description: string;
  hosts: string[];
  durationMinutes: number;
  bufferMinutes: number;
  minNoticeHours: number;
  windowDays: number;
  availability: Availability;
  location: { kind: 'video' | 'phone' | 'address'; value: string };
  questions: BookingQuestion[];
};

const PAGES: SeedPage[] = [
  {
    key: 'intro',
    name: '30-minute intro',
    slug: 'intro',
    description:
      'A short first conversation: what you are running today, where it hurts, and whether Ashgrove is worth a longer look. No slides — bring a problem and we will talk it through.',
    hosts: ['daniel', 'sofia', 'hannah'],
    durationMinutes: 30,
    bufferMinutes: 10,
    minNoticeHours: 12,
    windowDays: 30,
    availability: weekdays([1, 2, 3, 4, 5], [
      ['09:00', '12:00'],
      ['13:00', '17:00'],
    ]),
    location: { kind: 'video', value: 'https://meet.ashgrove.example/intro' },
    questions: [
      { id: 'qgoal', label: 'What are you hoping to sort out?', required: true, long: true },
      { id: 'qsites', label: 'How many sites or warehouses do you run?', required: false, long: false },
    ],
  },
  {
    key: 'deepdive',
    name: 'Technical deep dive',
    slug: 'technical-deep-dive',
    description:
      'An hour with Daniel for the people who will actually run it: data model, integrations, permissions and the migration path. Bring your systems list and your security questions.',
    hosts: ['daniel'],
    durationMinutes: 60,
    bufferMinutes: 15,
    minNoticeHours: 24,
    windowDays: 45,
    availability: weekdays([2, 3, 4], [
      ['10:00', '12:00'],
      ['13:30', '16:00'],
    ]),
    location: { kind: 'video', value: 'https://meet.ashgrove.example/deep-dive' },
    questions: [
      { id: 'qstack', label: 'Which systems does this have to sit beside?', required: true, long: true },
      { id: 'qwho', label: 'Who else should join?', required: false, long: false },
    ],
  },
];

/** The nth working day from `day`, forwards when n > 0 and backwards when n < 0. */
function workday(day: string, n: number, allowed: number[]) {
  const step = n >= 0 ? 1 : -1;
  let remaining = Math.abs(n);
  let cursor = day;
  // Up to 60 hops is plenty for the two months either side of today the demo uses.
  for (let i = 0; i < 60 && remaining > 0; i++) {
    cursor = addCalendarDays(cursor, step);
    if (allowed.includes(weekday(cursor))) remaining--;
  }
  return cursor;
}

export const seedMeetingLinks: SeedPhase = {
  key: 'meeting-links',
  label: 'meeting links',
  run: async ({ actor }) => {
    const existing = await zite.bookingPages.findAll({ limit: 5 });
    if (existing.records.length) return;
    const members = await memberMap();

    for (const page of PAGES) {
      const hostIds = [...new Set(page.hosts.map(key => ownerFor(key, members, actor.id)))];
      await withRetry(() =>
        zite.bookingPages.create({
          record: {
            name: page.name,
            slug: page.slug,
            description: page.description,
            hostIds: JSON.stringify(hostIds),
            durationMinutes: page.durationMinutes,
            bufferMinutes: page.bufferMinutes,
            minNoticeHours: page.minNoticeHours,
            windowDays: page.windowDays,
            availability: availabilityToJson(page.availability),
            timezone: TZ,
            location: serializeLocation(page.location),
            questions: JSON.stringify(page.questions),
            active: true,
            ownerId: hostIds[0] ?? actor.id,
            bookingCount: 0,
            rotationCursor: 0,
          },
        }),
      );
    }

    // Leads that arrive through a meeting link get this source, so the list the
    // leads ledger filters by has it too.
    const { rows: sources } = await zite.sql({ query: `SELECT id FROM "Choices" WHERE "list" = 'Lead Source' AND "label" = 'Meeting link' LIMIT 1`, params: [] });
    if (!sources.length) {
      const { rows: last } = await zite.sql({ query: `SELECT COALESCE(MAX("position"), 0) AS "maxPosition" FROM "Choices" WHERE "list" = 'Lead Source'`, params: [] });
      await withRetry(() => zite.choices.create({ record: { label: 'Meeting link', list: 'Lead Source', position: Number(last[0]?.maxPosition ?? 0) + 1, archived: false } })).catch(() => undefined);
    }
  },
};

const NOTES = [
  'We are running three sites off one spreadsheet and it has stopped working. Want to see whether this replaces it or sits beside it.',
  'Renewal is in March and I would like an alternative on the table before then.',
  'Our ops lead has been asking for something like this for a year. I want to understand the migration before I promise anything.',
  'Mostly here for the integration story — we have a warehouse system nobody wants to touch.',
  'Two of us will join. We want the security and permissions part more than the demo.',
];

const SITE_ANSWERS = ['4', '11', '2', '7', '23'];
const STACK_ANSWERS = ['NetSuite, plus a homegrown WMS', 'SAP and a lot of spreadsheets', 'Shopify, ShipStation and Xero', 'Dynamics 365 and an in-house portal'];

export const seedBookings: SeedPhase = {
  key: 'meeting-bookings',
  label: 'booked meetings',
  run: async ({ today, rng }) => {
    const { rows: existing } = await zite.sql({ query: `SELECT 1 FROM "Activities" WHERE COALESCE("bookingPageId", '') <> '' LIMIT 1`, params: [] });
    if (existing.length) return;

    const { rows: pageRows } = await zite.sql({ query: `SELECT id, "name", "slug", "hostIds", "durationMinutes", "location" FROM "BookingPages" ORDER BY created_at ASC`, params: [] });
    if (!pageRows.length) return;
    const bySlug = new Map(pageRows.map(r => [String(r.slug), r]));
    const intro = bySlug.get('intro');
    const deep = bySlug.get('technical-deep-dive');
    if (!intro || !deep) return;

    // By name, not created_at: a bulk insert gives every row the same
    // timestamp, so ordering by it picks different people on every install and
    // the demo stops being the same demo twice.
    const { rows: contacts } = await zite.sql({
      query: `SELECT c.id, c."name", c."email", c."companyId", co."name" AS "companyName" FROM "Contacts" c LEFT JOIN "Companies" co ON co.id::text = c."companyId" ORDER BY c."name" ASC, c.id ASC LIMIT 40`,
      params: [],
    });
    if (contacts.length < 6) return;

    const hostsOf = (row: Record<string, unknown>): string[] => {
      try {
        const parsed = JSON.parse(String(row.hostIds || '[]'));
        return Array.isArray(parsed) ? parsed.map(String) : [];
      } catch {
        return [];
      }
    };
    const introHosts = hostsOf(intro);
    const deepHosts = hostsOf(deep);
    if (!introHosts.length || !deepHosts.length) return;

    const { rows: memberRows } = await zite.sql({ query: `SELECT id, "name", "email" FROM "Members"`, params: [] });
    const memberById = new Map(memberRows.map(r => [String(r.id), { name: String(r.name ?? ''), email: String(r.email ?? '') }]));

    type Plan = { page: Record<string, unknown>; hostId: string; contactIndex: number; day: string; time: string; outcome: string; note: string; answers: Array<[string, string]> };
    const introDays = [1, 2, 3, 4, 5];
    const deepDays = [2, 3, 4];

    const plans: Plan[] = [
      // Behind us: what the page has already produced.
      { page: intro, hostId: introHosts[0], contactIndex: 0, day: workday(today, -9, introDays), time: '09:30', outcome: 'Completed', note: NOTES[0], answers: [['qgoal', NOTES[0]], ['qsites', SITE_ANSWERS[0]]] },
      { page: intro, hostId: introHosts[1 % introHosts.length], contactIndex: 3, day: workday(today, -6, introDays), time: '14:00', outcome: 'Completed', note: NOTES[1], answers: [['qgoal', NOTES[1]], ['qsites', SITE_ANSWERS[1]]] },
      { page: deep, hostId: deepHosts[0], contactIndex: 5, day: workday(today, -4, deepDays), time: '10:00', outcome: 'Completed', note: NOTES[4], answers: [['qstack', STACK_ANSWERS[0]], ['qwho', 'Our head of IT']] },
      { page: intro, hostId: introHosts[2 % introHosts.length], contactIndex: 8, day: workday(today, -3, introDays), time: '11:00', outcome: 'No Show', note: NOTES[2], answers: [['qgoal', NOTES[2]]] },
      { page: intro, hostId: introHosts[0], contactIndex: 11, day: workday(today, -2, introDays), time: '15:30', outcome: 'Canceled', note: NOTES[3], answers: [['qgoal', NOTES[3]], ['qsites', SITE_ANSWERS[2]]] },
      // Still to come: what the team is walking into.
      { page: intro, hostId: introHosts[1 % introHosts.length], contactIndex: 14, day: workday(today, 1, introDays), time: '10:00', outcome: 'Scheduled', note: NOTES[0], answers: [['qgoal', NOTES[0]], ['qsites', SITE_ANSWERS[3]]] },
      { page: intro, hostId: introHosts[2 % introHosts.length], contactIndex: 17, day: workday(today, 2, introDays), time: '13:30', outcome: 'Scheduled', note: NOTES[1], answers: [['qgoal', NOTES[1]]] },
      { page: deep, hostId: deepHosts[0], contactIndex: 20, day: workday(today, 3, deepDays), time: '13:30', outcome: 'Scheduled', note: NOTES[4], answers: [['qstack', STACK_ANSWERS[1]], ['qwho', 'Two of us']] },
      { page: intro, hostId: introHosts[0], contactIndex: 23, day: workday(today, 5, introDays), time: '16:00', outcome: 'Scheduled', note: NOTES[2], answers: [['qgoal', NOTES[2]], ['qsites', SITE_ANSWERS[4]]] },
    ];

    const questionLabels: Record<string, string> = {
      qgoal: 'What are you hoping to sort out?',
      qsites: 'How many sites or warehouses do you run?',
      qstack: 'Which systems does this have to sit beside?',
      qwho: 'Who else should join?',
    };

    const hostCount = new Map<string, number>([
      [String(intro.id), introHosts.length],
      [String(deep.id), deepHosts.length],
    ]);
    const counts = new Map<string, number>();
    const records = plans
      .map(plan => {
        const contact = contacts[plan.contactIndex % contacts.length];
        if (!contact) return null;
        const duration = Number(plan.page.durationMinutes) || 30;
        const startIso = zonedToUtc(plan.day, plan.time, TZ);
        const endIso = new Date(Date.parse(startIso) + duration * 60_000).toISOString();
        const host = memberById.get(plan.hostId);
        const pageId = String(plan.page.id);
        counts.set(pageId, (counts.get(pageId) ?? 0) + (plan.outcome === 'Canceled' ? 0 : 1));
        const answerText = plan.answers.map(([id, value]) => `${questionLabels[id] ?? id}: ${value}`).join('\n');
        const companyName = contact.companyName ? String(contact.companyName) : '';
        const body = [plan.note, answerText, companyName ? `Company: ${companyName}` : ''].filter(Boolean).join('\n\n');
        return {
          kind: 'Meeting',
          subject: `${String(plan.page.name)} — ${String(contact.name)}`,
          body: plan.outcome === 'Canceled' ? `${body}\n\n— Canceled by the invitee\nSomething came up on our side — I'll rebook next month.` : body,
          occurredAt: startIso,
          endsAt: endIso,
          durationMinutes: duration,
          outcome: plan.outcome,
          location: describeLocation(parseLocation(plan.page.location)),
          emailTo: String(contact.email ?? ''),
          attendees: JSON.stringify([
            { name: host?.name ?? 'Host', email: host?.email ?? null, memberId: plan.hostId },
            { name: String(contact.name ?? ''), email: String(contact.email ?? ''), contactId: String(contact.id) },
          ]),
          ownerId: plan.hostId,
          createdById: null,
          contactId: String(contact.id),
          companyId: contact.companyId ? String(contact.companyId) : null,
          bookingPageId: pageId,
          publicToken: `demo${String(pageId).replace(/[^a-z0-9]/gi, '').slice(0, 10)}${int(rng, 100000, 999999)}${pick(rng, ['a', 'b', 'c', 'd', 'e'])}`,
          pinned: false,
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);

    await chunked(records, async batch => void (await zite.activities.bulkCreate({ records: batch as never })));

    for (const [pageId, count] of counts) {
      const hosts = Math.max(1, hostCount.get(pageId) ?? 1);
      await withRetry(() => zite.bookingPages.update({ id: pageId, record: { bookingCount: count, rotationCursor: count % hosts } })).catch(() => undefined);
    }
  },
};

export const MEETINGS_PHASES: SeedPhase[] = [seedMeetingLinks, seedBookings];
