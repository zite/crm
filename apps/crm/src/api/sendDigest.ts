import { z } from 'zod';
import { createEndpoint } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { assertCan, getActor } from '@project/shared/server/actor';
import { emailMember } from '@project/shared/server/email';
import { appLink, getSettings } from '@project/shared/server/settings';
import { json, num, ref, str } from '@project/shared/server/sql';
import { addDays, todayIn, zonedToUtc } from '@project/shared/dates';
import { longDay, plural } from '@project/shared/format';
import { parseInput } from '../server/input';

/**
 * The 6:30am digest: what each teammate has to do today, what slipped, who
 * they are meeting and which of their deals need a push.
 *
 * `context.user` is null on a scheduled run, so members are resolved here
 * rather than from a session. The organization's "daily digest" preference
 * (Settings → General) gates the whole run, and a teammate can opt out of
 * their own with `preferences.dailyDigest = false`. Nobody gets an empty
 * digest, and sends are sequential — the platform rate-limits bursts.
 */

const inputSchema = z.object({
  today: z.string().optional(),
  /** Build every digest and report what would go out, without sending. */
  dryRun: z.boolean().optional(),
  /** Send only to these member ids (used when testing from Settings). */
  memberIds: z.array(z.string().min(1).max(64)).max(200).optional(),
});

type Task = { ownerId: string; title: string; dueDate: string | null; dueTime: string | null; related: string | null };
type Meeting = { ownerId: string; subject: string; occurredAt: string; location: string | null; durationMinutes: number | null; related: string | null };

const clock = (iso: string, timezone: string) =>
  new Date(iso).toLocaleTimeString('en-US', { timeZone: timezone, hour: 'numeric', minute: '2-digit' }).toLowerCase().replace(' ', '');

const weekday = (day: string, timezone: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: timezone, weekday: 'long' });

export default createEndpoint({
  description: 'Email every teammate their morning digest of tasks, meetings and deals needing attention',
  // No `authenticated` flag: the scheduled fire has no session and would be refused.
  // A hand call still has to be an Admin — checked inside execute.
  schedule: {
    scheduleType: 'recurring',
    schedule: { frequency: 'daily', interval: 1, times: ['06:30'] },
    timezone: 'America/Los_Angeles',
  },
  inputSchema,
  outputSchema: z.object({
    ran: z.boolean(),
    reason: z.string().nullable(),
    today: z.string(),
    sent: z.number(),
    skipped: z.number(),
    recipients: z.array(z.object({ memberId: z.string(), name: z.string(), email: z.string(), subject: z.string(), delivery: z.string(), reason: z.string().nullable(), dueToday: z.number(), overdue: z.number(), meetings: z.number(), attention: z.number(), preview: z.string().nullable() })),
  }),
  execute: async ({ input, context }) => {
    const { today: t, dryRun = false, memberIds } = parseInput(inputSchema, input);
    // A person calling this by hand must be an admin; a cron run has no user at all.
    if (context.user) assertCan(await getActor(context), 'settings.manage');

    const settings = await getSettings();
    const today = t && /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : todayIn(settings.timezone);

    if (!settings.preferences.dailyDigest) {
      return { ran: false, reason: 'The daily digest is turned off in Settings → General, so no email was sent.', today, sent: 0, skipped: 0, recipients: [] };
    }

    const dayStart = zonedToUtc(today, '00:00', settings.timezone);
    const dayEnd = zonedToUtc(addDays(today, 1), '00:00', settings.timezone);
    const closingHorizon = addDays(today, 14);

    const [memberRes, taskRes, meetingRes, dealRes] = await Promise.all([
      zite.sql({ query: `SELECT id, "name", "email", "preferences" FROM "Members" WHERE "status" = 'Active' ORDER BY "name"`, params: [] }),
      zite.sql({
        query: `SELECT t."ownerId", t."title", t."dueDate", t."dueTime",
            COALESCE(NULLIF(dl."name", ''), NULLIF(ct."name", ''), NULLIF(co."name", ''), NULLIF(ld."name", ''), '') AS "related"
          FROM "Tasks" t
          LEFT JOIN "Companies" co ON co.id::text = t."companyId"
          LEFT JOIN "Contacts" ct ON ct.id::text = t."contactId"
          LEFT JOIN "Deals" dl ON dl.id::text = t."dealId"
          LEFT JOIN "Leads" ld ON ld.id::text = t."leadId"
          WHERE t."status" = 'Open' AND t."dueDate" <= $1::date AND COALESCE(t."ownerId", '') <> ''
          ORDER BY t."dueDate" ASC, COALESCE(NULLIF(t."dueTime", ''), '99:99') ASC
          LIMIT 2000`,
        params: [today],
      }),
      zite.sql({
        query: `SELECT a."ownerId", a."subject", a."occurredAt", a."location", a."durationMinutes",
            COALESCE(NULLIF(ct."name", ''), NULLIF(co."name", ''), NULLIF(dl."name", ''), '') AS "related"
          FROM "Activities" a
          LEFT JOIN "Companies" co ON co.id::text = a."companyId"
          LEFT JOIN "Contacts" ct ON ct.id::text = a."contactId"
          LEFT JOIN "Deals" dl ON dl.id::text = a."dealId"
          WHERE a."kind" = 'Meeting' AND a."occurredAt" >= $1 AND a."occurredAt" < $2
            AND COALESCE(a."outcome", '') NOT IN ('Canceled', 'No Show') AND COALESCE(a."ownerId", '') <> ''
          ORDER BY a."occurredAt" ASC
          LIMIT 500`,
        params: [dayStart, dayEnd],
      }),
      zite.sql({
        query: `SELECT d."ownerId",
            COUNT(*) FILTER (WHERE COALESCE(s."rottingDays", 0) > 0 AND d."stageEnteredAt" < ($1::date - s."rottingDays"::int)) AS "stalledTotal",
            COUNT(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM "Tasks" tk WHERE tk."dealId" = d.id::text AND tk."status" = 'Open')) AS "noNextStepTotal",
            COUNT(*) FILTER (WHERE d."closeDate" >= $1::date AND d."closeDate" <= $2::date) AS "closingTotal"
          FROM "Deals" d
          LEFT JOIN "Stages" s ON s.id::text = d."stageId"
          WHERE COALESCE(d."archived", false) = false AND d."status" = 'Open' AND COALESCE(d."ownerId", '') <> ''
          GROUP BY d."ownerId"`,
        params: [today, closingHorizon],
      }),
    ]);

    const tasksByOwner = new Map<string, Task[]>();
    for (const r of taskRes.rows) {
      const ownerId = ref(r.ownerId);
      if (!ownerId) continue;
      const list = tasksByOwner.get(ownerId) ?? [];
      list.push({ ownerId, title: str(r.title) ?? '', dueDate: r.dueDate ? String(r.dueDate).slice(0, 10) : null, dueTime: str(r.dueTime) || null, related: str(r.related) || null });
      tasksByOwner.set(ownerId, list);
    }
    const meetingsByOwner = new Map<string, Meeting[]>();
    for (const r of meetingRes.rows) {
      const ownerId = ref(r.ownerId);
      if (!ownerId) continue;
      const list = meetingsByOwner.get(ownerId) ?? [];
      list.push({
        ownerId,
        subject: str(r.subject) || 'Meeting',
        occurredAt: String(r.occurredAt),
        location: str(r.location) || null,
        durationMinutes: r.durationMinutes == null ? null : num(r.durationMinutes),
        related: str(r.related) || null,
      });
      meetingsByOwner.set(ownerId, list);
    }
    const dealsByOwner = new Map<string, { stalled: number; noNextStep: number; closing: number }>();
    for (const r of dealRes.rows) {
      const ownerId = ref(r.ownerId);
      if (!ownerId) continue;
      dealsByOwner.set(ownerId, {
        stalled: settings.preferences.stalledEnabled ? num(r.stalledTotal) : 0,
        noNextStep: num(r.noNextStepTotal),
        closing: num(r.closingTotal),
      });
    }

    const wanted = memberIds?.length ? new Set(memberIds) : null;
    const recipients: Array<{ memberId: string; name: string; email: string; subject: string; delivery: string; reason: string | null; dueToday: number; overdue: number; meetings: number; attention: number; preview: string | null }> = [];
    let sent = 0;
    let skipped = 0;

    for (const row of memberRes.rows) {
      const memberId = String(row.id);
      if (wanted && !wanted.has(memberId)) continue;
      const name = str(row.name) || 'there';
      const email = str(row.email) ?? '';
      const prefs = json<Record<string, unknown>>(row.preferences, {});
      if (prefs.dailyDigest === false || !email) {
        skipped++;
        continue;
      }

      const mine = tasksByOwner.get(memberId) ?? [];
      const dueToday = mine.filter(task => task.dueDate === today);
      const overdue = mine.filter(task => task.dueDate && task.dueDate < today);
      const meetings = meetingsByOwner.get(memberId) ?? [];
      const deals = dealsByOwner.get(memberId) ?? { stalled: 0, noNextStep: 0, closing: 0 };
      const attention = deals.stalled + deals.noNextStep + deals.closing;

      if (!dueToday.length && !overdue.length && !meetings.length && !attention) {
        skipped++;
        continue;
      }

      const headline = [
        dueToday.length ? plural(dueToday.length, 'task') + ' due' : null,
        overdue.length ? `${overdue.length} overdue` : null,
        meetings.length ? plural(meetings.length, 'meeting') : null,
      ]
        .filter(Boolean)
        .join(' · ') || 'No tasks or meetings today';

      const parts: string[] = [`Good morning, ${name.split(' ')[0]}. Here is ${weekday(today, settings.timezone)}, ${longDay(today)}.`, headline];

      if (meetings.length) {
        parts.push(
          ['Meetings', ...meetings.map(m => `${clock(m.occurredAt, settings.timezone)} · ${m.subject}${m.related ? ` · ${m.related}` : ''}${m.durationMinutes ? ` (${m.durationMinutes} min)` : ''}${m.location ? ` · ${m.location}` : ''}`)].join('\n'),
        );
      }
      if (dueToday.length) {
        parts.push(['Due today', ...dueToday.slice(0, 12).map(task => `• ${task.title}${task.related ? ` · ${task.related}` : ''}`), dueToday.length > 12 ? `…and ${dueToday.length - 12} more` : ''].filter(Boolean).join('\n'));
      }
      if (overdue.length) {
        parts.push(['Overdue', ...overdue.slice(0, 8).map(task => `• ${task.title}${task.dueDate ? ` · was due ${longDay(task.dueDate)}` : ''}`), overdue.length > 8 ? `…and ${overdue.length - 8} more` : ''].filter(Boolean).join('\n'));
      }
      if (attention) {
        const bits = [deals.stalled ? `${deals.stalled} stalled` : null, deals.noNextStep ? `${deals.noNextStep} with no next step` : null, deals.closing ? `${deals.closing} closing within 14 days` : null].filter(Boolean);
        parts.push(`Deals needing attention\n${bits.join(' · ')}`);
      }

      const subject = `Your day · ${headline}`;
      const text = parts.join('\n\n');
      const link = appLink('/home');
      let delivery = 'Skipped';
      let reason: string | null = 'Dry run — nothing was sent';
      if (!dryRun) {
        const result = await emailMember({ settings, to: email, subject, text, link: link ? { label: 'Open the CRM', href: link } : null });
        delivery = result.delivery;
        reason = result.reason;
        if (result.delivery === 'Sent') sent++;
      }
      recipients.push({ memberId, name, email, subject, delivery, reason, dueToday: dueToday.length, overdue: overdue.length, meetings: meetings.length, attention, preview: dryRun ? text : null });
    }

    return {
      ran: true,
      reason: null,
      today,
      sent,
      skipped,
      recipients,
    };
  },
});
