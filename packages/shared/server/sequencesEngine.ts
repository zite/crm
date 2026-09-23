import { zite } from 'zitejs/db';
import { addDays, weekday, zonedParts, zonedToUtc } from '../dates';
import { renderMerge } from '../merge';
import type { Actor } from './actor';
import { memberById } from './actor';
import { hasConsent, isDeliverable, mergeContext, sendEmail, unsubscribeUrl } from './email';
import { logEvent } from './events';
import { notify } from './notify';
import { getSettings, type OrgSettings } from './settings';
import { ensureTask } from './tasks';
import { iso, json, num, ref, str, withRetry } from './sql';

/**
 * Sequences: the machine behind multi-step outreach.
 *
 * A Sequences row owns an ordered JSON array of steps; an Enrollments row is
 * one contact walking that array. Three entry points, all of them the only
 * writers of Enrollments:
 *
 *   enrollContacts — put people on a sequence, saying why anyone was skipped
 *   exitEnrollments — stop a contact's active enrollments (called by
 *     `createActivity` on a reply or a booked meeting, and by unsubscribe)
 *   runDueSteps — the scheduled worker: send, or create the task, then advance
 *
 * Three rules keep it safe to install:
 *   - a step is CLAIMED (stepIndex advanced) before its side effect runs, so a
 *     retry or an overlapping run can never send the same step twice;
 *   - every write is sequential — live Zite rate-limits bursts;
 *   - one run has a hard cap, so a backlog drains over several runs instead of
 *     melting one.
 *
 * Nothing here writes Activities or Tasks directly: it goes through
 * `createActivity` / `createTask` so last-activity dates, notifications and
 * history stay right.
 */

/* ---------------------------------------------------------------- model --- */

export const STEP_KINDS = ['auto_email', 'manual_email', 'call', 'todo', 'linkedin'] as const;
export type StepKind = (typeof STEP_KINDS)[number];

export type SequenceStep = {
  id: string;
  kind: StepKind;
  /** Days to wait after the previous step. The first step is always 0. */
  delayDays: number;
  subject: string;
  body: string;
  note: string;
};

export type SequenceSettings = {
  /** Skip Saturday and Sunday when scheduling a step. */
  weekdaysOnly: boolean;
  /** Local to the organization's timezone, 'HH:MM'. */
  sendWindow: { start: string; end: string };
  exitOnReply: boolean;
  exitOnMeeting: boolean;
  exitOnDeal: boolean;
};

export const DEFAULT_SEQUENCE_SETTINGS: SequenceSettings = {
  weekdaysOnly: true,
  sendWindow: { start: '08:00', end: '17:00' },
  exitOnReply: true,
  exitOnMeeting: true,
  exitOnDeal: false,
};

/** Exit reasons. 'Replied', 'Meeting booked' and 'Deal created' obey the sequence's own settings. */
export type ExitReason = 'Replied' | 'Meeting booked' | 'Deal created' | 'Deal won' | 'Unsubscribed' | 'Manually' | 'Contact deleted';

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

const isStepKind = (v: unknown): v is StepKind => typeof v === 'string' && (STEP_KINDS as readonly string[]).includes(v);

const clampText = (v: unknown, max: number) => (typeof v === 'string' ? v : '').slice(0, max);

/** A step id that is stable and readable without needing crypto in the seed. */
const stepId = (index: number) => `s${index + 1}`;

/** Parse and repair the steps column: unknown kinds, missing ids and silly delays all become sane. */
export function parseSteps(raw: unknown): SequenceStep[] {
  const list = json<unknown[]>(raw, []);
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  return list.slice(0, 40).map((item, index) => {
    const s = (item ?? {}) as Record<string, unknown>;
    let id = clampText(s.id, 40).trim() || stepId(index);
    while (seen.has(id)) id = `${id}x`;
    seen.add(id);
    return {
      id,
      kind: isStepKind(s.kind) ? s.kind : 'auto_email',
      delayDays: index === 0 ? 0 : Math.min(120, Math.max(0, Math.round(num(s.delayDays, 0)))),
      subject: clampText(s.subject, 200),
      body: clampText(s.body, 20_000),
      note: clampText(s.note, 2000),
    };
  });
}

export function parseSequenceSettings(raw: unknown): SequenceSettings {
  const s = json<Partial<SequenceSettings>>(raw, {});
  const window = (s.sendWindow ?? {}) as { start?: unknown; end?: unknown };
  const start = typeof window.start === 'string' && HHMM.test(window.start) ? window.start : DEFAULT_SEQUENCE_SETTINGS.sendWindow.start;
  let end = typeof window.end === 'string' && HHMM.test(window.end) ? window.end : DEFAULT_SEQUENCE_SETTINGS.sendWindow.end;
  if (toMinutes(end) < toMinutes(start)) end = start;
  return {
    weekdaysOnly: s.weekdaysOnly !== false,
    sendWindow: { start, end },
    exitOnReply: s.exitOnReply !== false,
    exitOnMeeting: s.exitOnMeeting !== false,
    exitOnDeal: s.exitOnDeal === true,
  };
}

/** "Day 0", "Day 3" — each step's day counted from enrollment. */
export function cumulativeDays(steps: SequenceStep[]): number[] {
  let total = 0;
  return steps.map((step, i) => {
    total += i === 0 ? 0 : step.delayDays;
    return total;
  });
}

export const TASK_TYPE_FOR_STEP: Record<Exclude<StepKind, 'auto_email'>, 'To-do' | 'Call' | 'Email' | 'LinkedIn'> = {
  manual_email: 'Email',
  call: 'Call',
  todo: 'To-do',
  linkedin: 'LinkedIn',
};

const toMinutes = (hhmm: string) => {
  const m = HHMM.exec(hhmm);
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
};

const toHhmm = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

/**
 * The next moment a step may run: `from` plus its delay, pulled forward into
 * the send window and off the weekend when the sequence asks for that.
 */
export function nextRunAfter(from: Date | string, delayDays: number, cfg: SequenceSettings, timezone: string): string {
  const base = new Date(new Date(from).getTime() + Math.max(0, delayDays) * 86_400_000);
  const start = toMinutes(cfg.sendWindow.start);
  const end = toMinutes(cfg.sendWindow.end);
  const parts = zonedParts(base, timezone);
  let day = parts.day;
  let minutes = parts.minutes;
  for (let i = 0; i < 16; i++) {
    const wd = weekday(day);
    if (cfg.weekdaysOnly && (wd === 0 || wd === 6)) {
      day = addDays(day, 1);
      minutes = start;
      continue;
    }
    if (minutes > end) {
      day = addDays(day, 1);
      minutes = start;
      continue;
    }
    return zonedToUtc(day, toHhmm(Math.max(minutes, start)), timezone);
  }
  return zonedToUtc(day, toHhmm(start), timezone);
}

/* ------------------------------------------------------------- enrolling --- */

export type SkipCode = 'missing' | 'no_email' | 'no_consent' | 'already_enrolled' | 'undeliverable';

export type EnrollResult = {
  enrolled: number;
  skipped: Array<{ contactId: string; reason: string; code: SkipCode }>;
};

type SequenceRow = { id: string; name: string; status: string; steps: SequenceStep[]; settings: SequenceSettings; ownerId: string | null };

async function loadSequence(sequenceId: string): Promise<SequenceRow | null> {
  const { rows } = await zite.sql({ query: `SELECT id, "name", "status", "steps", "settings", "ownerId" FROM "Sequences" WHERE id::text = $1 LIMIT 1`, params: [sequenceId] });
  const r = rows[0];
  if (!r) return null;
  return { id: String(r.id), name: str(r.name) ?? '', status: str(r.status) || 'Active', steps: parseSteps(r.steps), settings: parseSequenceSettings(r.settings), ownerId: ref(r.ownerId) };
}

/**
 * Put contacts on a sequence. Everyone who can't go on is returned with the
 * reason, so the dialog can say exactly who was left out and why.
 */
export async function enrollContacts(input: {
  actor: Actor;
  sequenceId: string;
  contactIds: string[];
  ownerId?: string | null;
  dealId?: string | null;
  /** Demo addresses (example.com, *.example) can't be delivered to. Enroll them anyway and record each send as Not Sent. */
  includeUndeliverable?: boolean;
}): Promise<EnrollResult> {
  const skipped: EnrollResult['skipped'] = [];
  const ids = [...new Set(input.contactIds.filter(Boolean))].slice(0, 500);
  if (!ids.length) return { enrolled: 0, skipped };

  const sequence = await loadSequence(input.sequenceId);
  if (!sequence) return { enrolled: 0, skipped: ids.map(contactId => ({ contactId, reason: 'That sequence no longer exists', code: 'missing' as const })) };
  if (!sequence.steps.length) return { enrolled: 0, skipped: ids.map(contactId => ({ contactId, reason: 'That sequence has no steps yet', code: 'missing' as const })) };

  const settings = await getSettings();
  const now = new Date();
  const firstRun = nextRunAfter(now, sequence.steps[0].delayDays, sequence.settings, settings.timezone);

  const placeholders = ids.map((_, i) => `$${i + 1}`).join(', ');
  const { rows: contacts } = await zite.sql({
    query: `SELECT id, "name", "email", "ownerId", "doNotContact", "unsubscribedAt" FROM "Contacts" WHERE id::text IN (${placeholders})`,
    params: ids,
  });
  const byId = new Map(contacts.map(r => [String(r.id), r]));

  const { rows: existing } = await zite.sql({
    query: `SELECT "contactId" FROM "Enrollments" WHERE "sequenceId" = $1 AND "status" IN ('Active', 'Paused')`,
    params: [input.sequenceId],
  });
  const busy = new Set(existing.map(r => String(r.contactId)));

  let enrolled = 0;
  const byOwner = new Map<string, number>();
  // Sequential: live Zite rate-limits bursts of parallel writes.
  for (const contactId of ids) {
    const c = byId.get(contactId);
    if (!c) {
      skipped.push({ contactId, reason: 'That contact no longer exists', code: 'missing' });
      continue;
    }
    const name = str(c.name) || 'This contact';
    const email = (str(c.email) ?? '').trim();
    if (!email) {
      skipped.push({ contactId, reason: `${name} has no email address`, code: 'no_email' });
      continue;
    }
    if (!hasConsent({ doNotContact: c.doNotContact === true, unsubscribedAt: str(c.unsubscribedAt) })) {
      skipped.push({ contactId, reason: `${name} has opted out of email`, code: 'no_consent' });
      continue;
    }
    if (busy.has(contactId)) {
      skipped.push({ contactId, reason: `${name} is already in this sequence`, code: 'already_enrolled' });
      continue;
    }
    if (!isDeliverable(email) && !input.includeUndeliverable) {
      skipped.push({ contactId, reason: `${email} is a demo address — nothing can be delivered to it`, code: 'undeliverable' });
      continue;
    }
    const ownerId = input.ownerId || ref(c.ownerId) || input.actor.id;
    await withRetry(() =>
      zite.enrollments.create({
        record: {
          sequenceId: sequence.id,
          contactId,
          dealId: input.dealId ?? null,
          ownerId,
          status: 'Active',
          stepIndex: 0,
          nextRunAt: firstRun,
          enrolledAt: now.toISOString(),
          lastStepAt: null,
          finishedAt: null,
          exitReason: null,
          enrolledById: input.actor.id,
        },
      }),
    );
    busy.add(contactId);
    enrolled++;
    byOwner.set(ownerId, (byOwner.get(ownerId) ?? 0) + 1);
    await logEvent({
      kind: 'sequence.enrolled',
      entity: { type: 'contact', id: contactId },
      actorId: input.actor.id,
      summary: `enrolled ${name} in “${sequence.name}”`,
      contactId,
      dealId: input.dealId ?? null,
      data: { sequenceId: sequence.id },
    });
  }

  for (const [ownerId, count] of byOwner) {
    if (ownerId === input.actor.id) continue;
    await notify({
      recipientIds: [ownerId],
      kind: 'sequence',
      title: `${input.actor.name} enrolled ${count === 1 ? 'a contact' : `${count} contacts`} of yours in “${sequence.name}”`,
      link: `/outreach/sequences/${sequence.id}`,
      entityType: 'sequence',
      entityId: sequence.id,
      actorId: input.actor.id,
    });
  }

  return { enrolled, skipped };
}

/* -------------------------------------------------------------- exiting --- */

const REASON_SETTING: Partial<Record<string, keyof SequenceSettings>> = {
  Replied: 'exitOnReply',
  'Meeting booked': 'exitOnMeeting',
  'Deal created': 'exitOnDeal',
};

/**
 * End every active enrollment for a contact. Reasons that a sequence can opt
 * out of ("Replied", "Meeting booked", "Deal created") only end the
 * enrollments whose sequence asks for it; everything else always ends.
 */
export async function exitEnrollments(input: { contactId: string; reason: string }): Promise<number> {
  if (!input.contactId) return 0;
  const { rows } = await zite.sql({
    query: `
      SELECT e.id, e."sequenceId", s."name" AS "sequenceName", s."settings"
      FROM "Enrollments" e
      LEFT JOIN "Sequences" s ON s.id::text = e."sequenceId"
      WHERE e."contactId" = $1 AND e."status" IN ('Active', 'Paused')`,
    params: [input.contactId],
  });
  if (!rows.length) return 0;
  const gate = REASON_SETTING[input.reason];
  const now = new Date().toISOString();
  let exited = 0;
  for (const r of rows) {
    if (gate) {
      const cfg = parseSequenceSettings(r.settings);
      if (cfg[gate] !== true) continue;
    }
    await withRetry(() => zite.enrollments.update({ id: String(r.id), record: { status: 'Exited', exitReason: input.reason, finishedAt: now, nextRunAt: null } }));
    exited++;
    await logEvent({
      kind: 'sequence.exited',
      entity: { type: 'contact', id: input.contactId },
      actorId: null,
      summary: `left “${str(r.sequenceName) || 'a sequence'}” — ${input.reason.toLowerCase()}`,
      contactId: input.contactId,
      data: { sequenceId: str(r.sequenceId) },
    });
  }
  return exited;
}

/* --------------------------------------------------------------- running --- */

/** One run never does more than this, so a backlog drains over several runs. */
const RUN_CAP = 120;

type DueRow = {
  id: string;
  sequenceId: string;
  sequenceName: string;
  steps: SequenceStep[];
  cfg: SequenceSettings;
  contactId: string | null;
  companyId: string | null;
  dealId: string | null;
  ownerId: string | null;
  stepIndex: number;
  enrolledAt: string | null;
  contactName: string;
  contactEmail: string;
  doNotContact: boolean;
  unsubscribedAt: string | null;
};

export type RunResult = { sent: number; tasks: number; failed: number; notSent: number; exited: number; finished: number; considered: number };

export async function runDueSteps(input: { now: Date }): Promise<RunResult> {
  const out: RunResult = { sent: 0, tasks: 0, failed: 0, notSent: 0, exited: 0, finished: 0, considered: 0 };
  const now = input.now instanceof Date && !Number.isNaN(input.now.getTime()) ? input.now : new Date();
  const nowIso = now.toISOString();
  const settings = await getSettings();

  const { rows } = await zite.sql({
    query: `
      SELECT e.id, e."sequenceId", e."contactId", e."dealId", e."ownerId", e."stepIndex", e."enrolledAt",
             s."name" AS "sequenceName", s."status" AS "sequenceStatus", s."steps", s."settings",
             c."name" AS "contactName", c."email" AS "contactEmail", c."companyId", c."doNotContact", c."unsubscribedAt"
      FROM "Enrollments" e
      JOIN "Sequences" s ON s.id::text = e."sequenceId"
      LEFT JOIN "Contacts" c ON c.id::text = e."contactId"
      WHERE e."status" = 'Active' AND (e."nextRunAt" IS NULL OR e."nextRunAt" <= $1) AND s."status" = 'Active'
      ORDER BY e."nextRunAt" ASC NULLS FIRST, e.created_at ASC
      LIMIT ${RUN_CAP}`,
    params: [nowIso],
  });

  const due: DueRow[] = rows.map(r => ({
    id: String(r.id),
    sequenceId: str(r.sequenceId) ?? '',
    sequenceName: str(r.sequenceName) ?? '',
    steps: parseSteps(r.steps),
    cfg: parseSequenceSettings(r.settings),
    contactId: ref(r.contactId),
    companyId: ref(r.companyId),
    dealId: ref(r.dealId),
    ownerId: ref(r.ownerId),
    stepIndex: Math.max(0, num(r.stepIndex, 0)),
    enrolledAt: iso(r.enrolledAt),
    contactName: str(r.contactName) ?? '',
    contactEmail: (str(r.contactEmail) ?? '').trim(),
    doNotContact: r.doNotContact === true,
    unsubscribedAt: str(r.unsubscribedAt),
  }));
  out.considered = due.length;
  if (!due.length) return out;

  const owners = new Map<string, { id: string; name: string }>();
  const ownerFor = async (id: string | null) => {
    if (!id) return null;
    if (!owners.has(id)) {
      const member = await memberById(id);
      owners.set(id, { id, name: member?.name ?? 'Your team' });
    }
    return owners.get(id) ?? null;
  };

  // Sequential: live Zite rate-limits bursts of parallel writes.
  for (const e of due) {
    try {
      if (!e.contactId) {
        await finish(e.id, 'Exited', 'Contact deleted', nowIso);
        out.exited++;
        continue;
      }
      if (!hasConsent({ doNotContact: e.doNotContact, unsubscribedAt: e.unsubscribedAt })) {
        await finish(e.id, 'Exited', 'Unsubscribed', nowIso);
        out.exited++;
        continue;
      }
      if (e.stepIndex >= e.steps.length) {
        await finish(e.id, 'Finished', null, nowIso);
        out.finished++;
        continue;
      }
      if (e.cfg.exitOnDeal && (await hasNewDeal(e.contactId, e.enrolledAt))) {
        await finish(e.id, 'Exited', 'Deal created', nowIso);
        out.exited++;
        continue;
      }

      const step = e.steps[e.stepIndex];
      // Outside the working window: put it back in the diary rather than sending at 3am.
      const allowed = nextRunAfter(now, 0, e.cfg, settings.timezone);
      if (Date.parse(allowed) > now.getTime() + 60_000) {
        await withRetry(() => zite.enrollments.update({ id: e.id, record: { nextRunAt: allowed } }));
        continue;
      }

      // Claim the step BEFORE doing it: a retry or an overlapping run can then
      // never send the same step twice.
      const next = e.steps[e.stepIndex + 1];
      const isLast = !next;
      await withRetry(() =>
        zite.enrollments.update({
          id: e.id,
          record: {
            stepIndex: e.stepIndex + 1,
            lastStepAt: nowIso,
            nextRunAt: isLast ? null : nextRunAfter(now, next.delayDays, e.cfg, settings.timezone),
            ...(isLast ? { status: 'Finished', finishedAt: nowIso } : {}),
          },
        }),
      );
      if (isLast) out.finished++;

      const owner = await ownerFor(e.ownerId);
      if (step.kind === 'auto_email') {
        const result = await sendStep(e, step, settings, owner);
        if (result === 'Sent') out.sent++;
        else if (result === 'Not Sent') out.notSent++;
        else out.failed++;
      } else {
        await taskStep(e, step, settings, owner);
        out.tasks++;
      }
    } catch (err) {
      out.failed++;
      console.error('Sequence step failed', e.id, err instanceof Error ? err.message : err);
    }
  }

  return out;
}

async function finish(id: string, status: 'Finished' | 'Exited', reason: string | null, at: string) {
  await withRetry(() => zite.enrollments.update({ id, record: { status, exitReason: reason, finishedAt: at, nextRunAt: null } }));
}

async function hasNewDeal(contactId: string, since: string | null) {
  const { rows } = await zite.sql({
    query: `SELECT 1 FROM "Deals" WHERE "contactId" = $1 AND "status" = 'Open' AND created_at >= $2 LIMIT 1`,
    params: [contactId, since ?? new Date(0).toISOString()],
  });
  return rows.length > 0;
}

async function sendStep(e: DueRow, step: SequenceStep, settings: OrgSettings, owner: { id: string; name: string } | null) {
  const sender = owner ? await memberById(owner.id) : null;
  const ctx = await mergeContext({ settings, sender, contactId: e.contactId, companyId: e.companyId, dealId: e.dealId });
  const subject = renderMerge(step.subject, ctx).trim() || `A note from ${settings.organizationName}`;
  const body = renderMerge(step.body, ctx).trim();
  const unsubscribe = e.contactId ? await unsubscribeUrl(settings, e.contactId) : '';

  const result = await sendEmail({
    to: e.contactEmail,
    subject,
    text: body,
    replyTo: sender?.email ?? null,
    settings,
    signature: sender?.signature ?? null,
    footer: { unsubscribeUrl: unsubscribe || null },
  });

  const { createActivity } = await import('./activities');
  await createActivity(owner, {
    kind: 'Email',
    subject,
    body,
    direction: 'Outbound',
    delivery: result.delivery,
    emailFrom: sender?.email ?? null,
    emailTo: e.contactEmail,
    ownerId: e.ownerId,
    contactId: e.contactId,
    companyId: e.companyId,
    dealId: e.dealId,
    enrollmentId: e.id,
  });
  return result.delivery;
}

async function taskStep(e: DueRow, step: SequenceStep, settings: OrgSettings, owner: { id: string; name: string } | null) {
  const sender = owner ? await memberById(owner.id) : null;
  const ctx = await mergeContext({ settings, sender, contactId: e.contactId, companyId: e.companyId, dealId: e.dealId });
  const first = (e.contactName || 'your contact').split(' ')[0];
  const subject = renderMerge(step.subject, ctx).trim();
  const label: Record<Exclude<StepKind, 'auto_email'>, string> = {
    manual_email: subject ? `Email ${first}: ${subject}` : `Write to ${first}`,
    call: subject || `Call ${first}`,
    todo: subject || `Follow up with ${first}`,
    linkedin: subject || `Connect with ${first} on LinkedIn`,
  };
  const kind = step.kind as Exclude<StepKind, 'auto_email'>;
  const notes = [renderMerge(step.body, ctx).trim(), renderMerge(step.note, ctx).trim()].filter(Boolean).join('\n\n');
  await ensureTask(owner, {
    // One task per enrollment step, so a re-run can never duplicate it.
    systemKey: `seq:${e.id}:${step.id}`,
    title: label[kind],
    type: TASK_TYPE_FOR_STEP[kind],
    dueDate: zonedParts(new Date(), settings.timezone).day,
    ownerId: e.ownerId,
    notes: notes ? `${notes}\n\nFrom the “${e.sequenceName}” sequence.` : `From the “${e.sequenceName}” sequence.`,
    enrollmentId: e.id,
    stepId: step.id,
    contactId: e.contactId,
    companyId: e.companyId,
    dealId: e.dealId,
  });
}
