import { zite } from 'zitejs/db';
import { nextRunAfter, parseSequenceSettings, type SequenceSettings, type SequenceStep } from '@project/shared/server/sequencesEngine';
import { chunked, withRetry } from '@project/shared/server/sql';
import { randomToken } from '@project/shared/tokens';
import { memberMap, ownerFor, type SeedPhase } from './core';
import { addDays, int, pastIso } from './rng';

/**
 * Demo outreach: the templates a team actually keeps, three sequences that
 * between them show every kind of step, and a dozen people part-way through
 * them — some still running, some finished, some who replied and stopped.
 *
 * Everything is derived from the fixed seed and dated relative to today, so a
 * screenshot taken tomorrow looks the same as one taken today. Each phase
 * checks for its own rows first, so a resumed or repeated seed is safe.
 */

const TEMPLATES: Array<{ name: string; category: string; subject: string; body: string; owner: string; shared: boolean; uses: number; usedDaysAgo: number | null }> = [
  {
    name: 'First touch — operations lead',
    category: 'Intro',
    subject: 'A quicker way to run {{company.name | your}} warehouses',
    body: `Hi {{contact.first_name | there}},

I work with operations teams at multi-site distributors who are running their warehouses on spreadsheets and a system that was built for a smaller company.

Two things usually change quickly: pickers stop walking the building twice, and the team can see stock across every site without phoning anyone.

Worth fifteen minutes to see whether it fits how {{company.name | your team}} runs?

{{sender.first_name}}`,
    owner: 'daniel',
    shared: true,
    uses: 48,
    usedDaysAgo: 1,
  },
  {
    name: 'Follow-up after no reply',
    category: 'Follow-up',
    subject: 'Re: {{company.name | your}} operations',
    body: `Hi {{contact.first_name | there}},

Bringing this back to the top of your inbox in case it got buried.

If the timing is wrong I'd rather know — I'll close the loop and come back next quarter instead of chasing you.

{{sender.first_name}}`,
    owner: 'daniel',
    shared: true,
    uses: 63,
    usedDaysAgo: 0,
  },
  {
    name: 'Pricing and packaging',
    category: 'Pricing',
    subject: 'Pricing for {{company.name | your rollout}}',
    body: `Hi {{contact.first_name | there}},

Here's how the numbers work for a team your size.

The platform licence covers your first site and every user on it. Additional sites are licensed monthly, and implementation is one-off — we scope it against the number of sites and whether you're moving historical stock data across.

For {{company.name | you}} that puts the first year around {{deal.amount | the range we discussed}}.

Happy to walk through it line by line if that's easier than reading a table.

{{sender.first_name}}`,
    owner: 'sofia',
    shared: true,
    uses: 31,
    usedDaysAgo: 3,
  },
  {
    name: 'Security review pack',
    category: 'Security review',
    subject: 'Security and compliance pack for {{company.name | your team}}',
    body: `Hi {{contact.first_name | there}},

Attaching everything your security team usually asks for: SOC 2 Type II report, penetration test summary, sub-processor list, data residency options and our standard DPA.

If they have a questionnaire of their own, send it over and we'll turn it around inside three working days.

{{sender.first_name}}
{{sender.title}}`,
    owner: 'maya',
    shared: true,
    uses: 19,
    usedDaysAgo: 6,
  },
  {
    name: 'Checking back in',
    category: 'Re-engagement',
    subject: 'Still worth a look, {{contact.first_name | there}}?',
    body: `Hi {{contact.first_name | there}},

We spoke earlier in the year about stock visibility across {{company.name | your sites}} and the timing wasn't right.

A few things have changed since: the cycle-count workflow now runs on a handheld, and the rollout for a multi-site customer took six weeks rather than six months.

If it's back on your list this quarter I'd be glad to pick it up.

{{sender.first_name}}`,
    owner: 'hannah',
    shared: true,
    uses: 24,
    usedDaysAgo: 9,
  },
  {
    name: 'Renewal — 60 days out',
    category: 'Renewal',
    subject: '{{company.name | Your}} renewal on {{deal.close_date | the date we agreed}}',
    body: `Hi {{contact.first_name | there}},

Your agreement comes up for renewal on {{deal.close_date | its anniversary}}, so I wanted to give you plenty of room rather than send this in the last week.

Nothing changes unless you want it to. If you'd like to look at the sites you've added since you signed, or move to an annual term, now is the easy moment to do it.

Shall I put half an hour in the diary?

{{sender.first_name}}`,
    owner: 'hannah',
    shared: true,
    uses: 27,
    usedDaysAgo: 2,
  },
  {
    name: 'Recap and next steps',
    category: 'Meeting recap',
    subject: 'Notes from today, and what happens next',
    body: `Hi {{contact.first_name | there}},

Thanks for the time today. Writing down what we agreed so nothing gets lost:

- You're replacing a process that depends on one person knowing where everything is
- The pilot covers a single site, with two weeks of parallel running
- Your security team reviews us before anything is signed

Next from me: the security pack this week and a scoped plan for the pilot by Friday. Next from you: confirming who from IT should be on the call.

{{sender.first_name}}`,
    owner: 'sofia',
    shared: true,
    uses: 52,
    usedDaysAgo: 0,
  },
  {
    name: 'Closing the loop',
    category: 'Breakup',
    subject: 'Closing the loop on {{company.name | this}}',
    body: `Hi {{contact.first_name | there}},

I haven't managed to reach you, which usually means this isn't a priority right now — completely fair.

I'll stop emailing. If it comes back around, reply to this and I'll pick it up from where we left off.

All the best,
{{sender.first_name}}`,
    owner: 'daniel',
    shared: false,
    uses: 15,
    usedDaysAgo: 4,
  },
];

type SeedStep = Omit<SequenceStep, 'id'>;

const step = (kind: SequenceStep['kind'], delayDays: number, subject: string, body = '', note = ''): SeedStep => ({ kind, delayDays, subject, body, note });

const SEQUENCES: Array<{ name: string; description: string; owner: string; status: 'Active' | 'Paused'; settings: Partial<SequenceSettings>; steps: SeedStep[] }> = [
  {
    name: 'New inbound lead',
    description: 'For someone who asked to hear from us. Fast on day one, then it backs off.',
    owner: 'marcus',
    status: 'Active',
    settings: { weekdaysOnly: true, sendWindow: { start: '08:00', end: '17:00' }, exitOnReply: true, exitOnMeeting: true, exitOnDeal: false },
    steps: [
      step(
        'auto_email',
        0,
        'Thanks for getting in touch, {{contact.first_name | there}}',
        `Hi {{contact.first_name | there}},

Thanks for reaching out about {{organization.name}} — I'm the person who looks after teams like yours.

Before we talk, it helps to know one thing: how many sites are you running stock across today?

{{sender.first_name}}`,
      ),
      step('call', 1, 'Call {{contact.first_name}} about their enquiry', '', 'They came in through the website. Lead with the question they asked, not the product.'),
      step(
        'auto_email',
        2,
        'Two ways teams like {{company.name | yours}} start',
        `Hi {{contact.first_name | there}},

Most teams start one of two ways: a single site running in parallel for a fortnight, or a read-only rollout so everyone can see stock before anything changes.

Either way you're live inside six weeks.

Which sounds closer to how {{company.name | your team}} would want to do it?

{{sender.first_name}}`,
      ),
      step('linkedin', 2, 'Connect with {{contact.first_name}} on LinkedIn', '', 'Short note referencing their enquiry — no pitch.'),
      step(
        'auto_email',
        3,
        'Closing the loop',
        `Hi {{contact.first_name | there}},

I haven't managed to reach you since you got in touch, so I'll leave it there rather than keep filling your inbox.

If it comes back around, replying to this is enough.

{{sender.first_name}}`,
      ),
    ],
  },
  {
    name: 'Outbound prospecting',
    description: 'Cold, for operations leaders at multi-site distributors. Stops the moment a deal appears.',
    owner: 'aisha',
    status: 'Active',
    settings: { weekdaysOnly: true, sendWindow: { start: '07:30', end: '16:00' }, exitOnReply: true, exitOnMeeting: true, exitOnDeal: true },
    steps: [
      step(
        'auto_email',
        0,
        'Stock visibility across {{company.name | your sites}}',
        `Hi {{contact.first_name | there}},

I work with operations leaders at distributors running several sites, where the honest answer to "how much do we have" is "let me phone the warehouse".

We fix that in weeks, not quarters.

Is that a real problem at {{company.name | your company}}, or have you already solved it?

{{sender.first_name}}`,
      ),
      step('linkedin', 2, 'Connect with {{contact.first_name}}', '', 'Connection request with one line about their sites. No link.'),
      step(
        'auto_email',
        3,
        'One number that usually moves',
        `Hi {{contact.first_name | there}},

The number that tends to move first is pick accuracy — most teams find they are running at about 96% and don't know it until they can measure it.

A customer of ours with eleven cross-docks went from 96% to 99.4% in a quarter, without hiring anyone.

Worth a short call?

{{sender.first_name}}`,
      ),
      step('call', 2, 'Cold call {{contact.first_name}}', '', 'Reference the two emails. If no answer, leave a twenty-second voicemail and move on.'),
      step(
        'manual_email',
        4,
        'A note for {{contact.first_name}}',
        `Hi {{contact.first_name | there}},

Write two lines of your own here — something specific to {{company.name | their business}}. A template at this point in the cadence reads like a template.

{{sender.first_name}}`,
        'Personalise this one properly: mention something from their site, their news page or the job ads they have open.',
      ),
      step(
        'auto_email',
        5,
        'Last one from me',
        `Hi {{contact.first_name | there}},

I'll stop here. If stock visibility across your sites lands on your list later in the year, reply to this and I'll pick it up.

All the best,
{{sender.first_name}}`,
      ),
    ],
  },
  {
    name: 'Renewal check-in',
    description: 'Starts sixty days out. Warm, short, and it never emails at the weekend.',
    owner: 'hannah',
    status: 'Active',
    settings: { weekdaysOnly: true, sendWindow: { start: '09:00', end: '16:00' }, exitOnReply: true, exitOnMeeting: true, exitOnDeal: false },
    steps: [
      step(
        'auto_email',
        0,
        'Your renewal is coming up',
        `Hi {{contact.first_name | there}},

Your agreement with {{organization.name}} comes up for renewal soon, and I'd rather talk about it now than in the last week.

Nothing changes unless you want it to. Is there anything you'd like to look at before it rolls?

{{sender.first_name}}`,
      ),
      step('call', 3, 'Renewal call with {{contact.first_name}}', '', 'Ask what has changed in their operation since they signed — sites, headcount, peak season.'),
      step(
        'auto_email',
        4,
        'A short summary before your renewal',
        `Hi {{contact.first_name | there}},

A quick summary of where things stand ahead of {{deal.close_date | your renewal}}: the sites you're licensed for, the ones you've added, and what an annual term would look like instead.

If the answer is "leave it exactly as it is", that's a one-line reply and I'll stop asking.

{{sender.first_name}}`,
      ),
      step('todo', 5, 'Confirm {{contact.first_name}}’s renewal internally', '', 'Update the renewal deal with whatever they said, and tell finance if the term is changing.'),
    ],
  },
];

const withIds = (steps: SeedStep[]): SequenceStep[] => steps.map((s, i) => ({ ...s, id: `s${i + 1}` }));

export const seedTemplates: SeedPhase = {
  key: 'templates',
  label: 'email templates',
  run: async ({ actor, today }) => {
    const existing = await zite.emailTemplates.findAll({ limit: 1 });
    if (existing.records.length) return;
    const members = await memberMap();
    await chunked(
      TEMPLATES.map(t => ({
        name: t.name,
        subject: t.subject,
        body: t.body,
        category: t.category,
        ownerId: ownerFor(t.owner, members, actor.id),
        shared: t.shared,
        archived: false,
        useCount: t.uses,
        lastUsedAt: t.usedDaysAgo == null ? null : `${addDays(today, -t.usedDaysAgo)}T16:20:00.000Z`,
      })),
      async batch => void (await zite.emailTemplates.bulkCreate({ records: batch })),
    );
  },
};

export const seedSequences: SeedPhase = {
  key: 'sequences',
  label: 'sequences',
  run: async ({ actor }) => {
    const existing = await zite.sequences.findAll({ limit: 1 });
    if (existing.records.length) return;
    const members = await memberMap();
    await zite.sequences.bulkCreate({
      records: SEQUENCES.map(s => ({
        name: s.name,
        description: s.description,
        ownerId: ownerFor(s.owner, members, actor.id),
        status: s.status,
        shared: true,
        steps: JSON.stringify(withIds(s.steps)),
        settings: JSON.stringify(parseSequenceSettings(s.settings)),
      })),
    });
  },
};

/**
 * Twelve people spread across the three sequences: five still running, two
 * paused, two finished the whole cadence and three replied and came off it.
 * Each one carries the emails it already sent, so a contact's timeline and the
 * sequence's numbers agree with each other.
 */
export const seedEnrollments: SeedPhase = {
  key: 'enrollments',
  label: 'sequence enrollments',
  run: async ({ actor, today, rng, settings }) => {
    const existing = await zite.enrollments.findAll({ limit: 1 });
    if (existing.records.length) return;

    // Only the sample's own sequences: one the admin wrote before loading it must not fill up with sample contacts.
    const names = SEQUENCES.map(s => s.name);
    const { rows: sequenceRows } = await zite.sql({
      query: `SELECT id, "name", "ownerId", "steps", "settings" FROM "Sequences" WHERE "name" IN (${names.map((_, i) => `$${i + 1}`).join(', ')}) ORDER BY created_at LIMIT 10`,
      params: names,
    });
    if (!sequenceRows.length) return;
    const sequences = sequenceRows.map(r => ({
      id: String(r.id),
      name: String(r.name ?? ''),
      ownerId: r.ownerId ? String(r.ownerId) : actor.id,
      steps: JSON.parse(String(r.steps || '[]')) as SequenceStep[],
      settings: parseSequenceSettings(r.settings),
    }));

    const { rows: contactRows } = await zite.sql({
      query: `
        SELECT c.id, c."name", c."firstName", c."email", c."companyId", c."ownerId", co."name" AS "companyName"
        FROM "Contacts" c LEFT JOIN "Companies" co ON co.id::text = c."companyId"
        WHERE COALESCE(c."doNotContact", false) = false AND c."unsubscribedAt" IS NULL
        ORDER BY c.created_at LIMIT 120`,
      params: [],
    });
    if (contactRows.length < 12) return;

    const { rows: memberRows } = await zite.sql({ query: `SELECT id, "name" FROM "Members"`, params: [] });
    const memberName = new Map(memberRows.map(r => [String(r.id), String(r.name ?? '')]));

    // A fixed stride, so the same twelve people are picked on every install.
    const chosen = Array.from({ length: 12 }, (_, i) => contactRows[(i * 7 + 3) % contactRows.length]);

    type Plan = { sequence: (typeof sequences)[number]; status: 'Active' | 'Paused' | 'Finished' | 'Exited'; done: number; exitReason: string | null; startedDaysAgo: number };
    const plans: Plan[] = [
      { sequence: sequences[0], status: 'Active', done: 1, exitReason: null, startedDaysAgo: 2 },
      { sequence: sequences[0], status: 'Active', done: 3, exitReason: null, startedDaysAgo: 6 },
      { sequence: sequences[0], status: 'Exited', done: 2, exitReason: 'Replied', startedDaysAgo: 11 },
      { sequence: sequences[0], status: 'Finished', done: 5, exitReason: null, startedDaysAgo: 19 },
      { sequence: sequences[1] ?? sequences[0], status: 'Active', done: 2, exitReason: null, startedDaysAgo: 5 },
      { sequence: sequences[1] ?? sequences[0], status: 'Active', done: 4, exitReason: null, startedDaysAgo: 12 },
      { sequence: sequences[1] ?? sequences[0], status: 'Paused', done: 1, exitReason: null, startedDaysAgo: 8 },
      { sequence: sequences[1] ?? sequences[0], status: 'Exited', done: 3, exitReason: 'Replied', startedDaysAgo: 15 },
      { sequence: sequences[1] ?? sequences[0], status: 'Finished', done: 6, exitReason: null, startedDaysAgo: 26 },
      { sequence: sequences[2] ?? sequences[0], status: 'Active', done: 1, exitReason: null, startedDaysAgo: 3 },
      { sequence: sequences[2] ?? sequences[0], status: 'Exited', done: 2, exitReason: 'Meeting booked', startedDaysAgo: 9 },
      { sequence: sequences[2] ?? sequences[0], status: 'Paused', done: 2, exitReason: null, startedDaysAgo: 7 },
    ];

    const now = new Date();
    const records = plans.map((plan, i) => {
      const contact = chosen[i];
      const steps = plan.sequence.steps;
      const done = Math.min(plan.done, steps.length);
      const enrolledAt = pastIso(rng, today, plan.startedDaysAgo);
      const lastStepAt = done ? pastIso(rng, today, Math.max(0, plan.startedDaysAgo - cumulative(steps, done - 1))) : null;
      const nextStep = steps[done];
      const finished = plan.status === 'Finished' || plan.status === 'Exited';
      return {
        sequenceId: plan.sequence.id,
        contactId: String(contact.id),
        dealId: null,
        ownerId: contact.ownerId ? String(contact.ownerId) : plan.sequence.ownerId,
        status: plan.status,
        stepIndex: done,
        nextRunAt: finished || !nextStep ? null : nextRunAfter(now, nextStep.delayDays, plan.sequence.settings, settings.timezone),
        enrolledAt,
        lastStepAt,
        finishedAt: finished ? pastIso(rng, today, Math.max(0, plan.startedDaysAgo - cumulative(steps, done - 1) - 1)) : null,
        exitReason: plan.exitReason,
        enrolledById: plan.sequence.ownerId,
      };
    });

    const created = await zite.enrollments.bulkCreate({ records });
    const enrollmentIds = created.records.map(r => r.id);

    // The work each enrollment has already done: the emails it sent, the reply
    // that stopped three of them, and the open task anyone sitting on a manual
    // step is waiting on.
    const activities: Array<Record<string, unknown>> = [];
    const tasks: Array<Record<string, unknown>> = [];
    const tokenPatches: Array<{ id: string; token: string }> = [];

    plans.forEach((plan, i) => {
      const contact = chosen[i];
      const contactId = String(contact.id);
      const first = String(contact.firstName || String(contact.name ?? '').split(' ')[0] || 'there');
      const companyName = String(contact.companyName ?? '');
      const enrollmentId = enrollmentIds[i];
      const ownerId = contact.ownerId ? String(contact.ownerId) : plan.sequence.ownerId;
      const sender = memberName.get(ownerId) || actor.name;
      const steps = plan.sequence.steps;
      const done = Math.min(plan.done, steps.length);
      tokenPatches.push({ id: contactId, token: randomToken(28) });

      for (let s = 0; s < done; s++) {
        const stepDef = steps[s];
        const daysAgo = Math.max(0, plan.startedDaysAgo - cumulative(steps, s));
        const at = pastIso(rng, today, daysAgo);
        if (stepDef.kind === 'auto_email') {
          activities.push({
            kind: 'Email',
            subject: render(stepDef.subject, first, companyName, sender),
            body: render(stepDef.body, first, companyName, sender),
            occurredAt: at,
            direction: 'Outbound',
            delivery: 'Sent',
            emailTo: String(contact.email ?? ''),
            ownerId,
            createdById: ownerId,
            companyId: contact.companyId ?? null,
            contactId,
            enrollmentId,
          });
        } else {
          tasks.push({
            title: render(stepDef.subject, first, companyName, sender) || `Follow up with ${first}`,
            type: stepDef.kind === 'manual_email' ? 'Email' : stepDef.kind === 'call' ? 'Call' : stepDef.kind === 'linkedin' ? 'LinkedIn' : 'To-do',
            status: 'Done',
            priority: 'Normal',
            dueDate: addDays(today, -daysAgo),
            completedAt: at,
            ownerId,
            createdById: ownerId,
            companyId: contact.companyId ?? null,
            contactId,
            enrollmentId,
            stepId: stepDef.id,
            systemKey: `seq:${enrollmentId}:${stepDef.id}`,
            notes: stepDef.note || null,
          });
        }
      }

      // The inbound reply that took three of them off their sequence.
      if (plan.exitReason === 'Replied') {
        activities.push({
          kind: 'Email',
          subject: `Re: ${render(steps[Math.max(0, done - 1)]?.subject ?? '', first, companyName, sender)}`,
          body: `Thanks for persisting — this is on our list for next quarter. Can you send over what a single-site pilot would involve?\n\n${first}`,
          occurredAt: pastIso(rng, today, Math.max(0, plan.startedDaysAgo - cumulative(steps, done - 1) - 1)),
          direction: 'Inbound',
          delivery: 'Sent',
          emailFrom: String(contact.email ?? ''),
          ownerId,
          createdById: ownerId,
          companyId: contact.companyId ?? null,
          contactId,
        });
      }

      // Anyone still running and sitting on a step a person has to do has it waiting for them.
      const nextStep = steps[done];
      if (plan.status === 'Active' && nextStep && nextStep.kind !== 'auto_email') {
        tasks.push({
          title: render(nextStep.subject, first, companyName, sender) || `Follow up with ${first}`,
          type: nextStep.kind === 'manual_email' ? 'Email' : nextStep.kind === 'call' ? 'Call' : nextStep.kind === 'linkedin' ? 'LinkedIn' : 'To-do',
          status: 'Open',
          priority: 'Normal',
          dueDate: addDays(today, int(rng, 0, 2)),
          ownerId,
          createdById: ownerId,
          companyId: contact.companyId ?? null,
          contactId,
          enrollmentId,
          stepId: nextStep.id,
          systemKey: `seq:${enrollmentId}:${nextStep.id}`,
          notes: `${nextStep.note ? `${nextStep.note}\n\n` : ''}From the “${plan.sequence.name}” sequence.`,
        });
      }
    });

    await chunked(activities, async batch => void (await zite.activities.bulkCreate({ records: batch })));
    await chunked(tasks, async batch => void (await zite.tasks.bulkCreate({ records: batch })));
    // Enrolled contacts get their unsubscribe link now, so the public page works straight away.
    for (const patch of tokenPatches) {
      await withRetry(() => zite.contacts.update({ id: patch.id, record: { unsubscribeToken: patch.token } }));
    }
  },
};

/** Days from enrollment to step `index` — the first step is always day 0. */
function cumulative(steps: SequenceStep[], index: number) {
  let total = 0;
  for (let i = 1; i <= Math.max(0, index); i++) total += steps[i]?.delayDays ?? 0;
  return total;
}

/** The seed writes rows straight to the database, so merge fields are filled in here. */
function render(text: string, first: string, company: string, sender: string) {
  return text
    .replace(/\{\{\s*contact\.first_name[^}]*\}\}/g, first)
    .replace(/\{\{\s*sender\.first_name[^}]*\}\}/g, sender.split(' ')[0])
    .replace(/\{\{\s*sender\.name[^}]*\}\}/g, sender)
    .replace(/\{\{\s*organization\.name[^}]*\}\}/g, 'Ashgrove Software')
    .replace(/\{\{\s*company\.name\s*\|\s*([^}]*?)\s*\}\}/g, (_m, fallback: string) => company || fallback)
    .replace(/\{\{\s*company\.name\s*\}\}/g, company)
    .replace(/\{\{[^}]*\|\s*([^}]*?)\s*\}\}/g, '$1')
    .replace(/\{\{[^}]*\}\}/g, '')
    .trim();
}

export const OUTREACH_PHASES: SeedPhase[] = [seedTemplates, seedSequences, seedEnrollments];
