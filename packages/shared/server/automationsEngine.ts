import { zite } from 'zitejs/db';
import type { DealType, ForecastCategory, LeadStatus, TaskPriority, TaskType } from '../constants';
import { renderMerge } from '../merge';
import { memberById, type Actor } from './actor';
import type { TriggerKind, TriggerPayload } from './automations';
import { createTask } from './tasks';
import { updateDeal } from './deals';
import { createActivity } from './activities';
import { logEvent } from './events';
import { setLeadStatus } from './leads';
import { mergeContext, sendEmail } from './email';
import { notify } from './notify';
import { entityPath, idList } from './records';
import { enrollContacts } from './sequences';
import { getSettings } from './settings';
import { bool, iso, json, num, numOrNull, ref, str, withRetry } from './sql';

/**
 * The automations engine.
 *
 * `runTrigger` is called after every write that could interest a rule. It finds
 * the active Automations for that trigger, loads the record the trigger is
 * about, checks the rule's conditions against it, runs its actions and records
 * an AutomationRuns row. It NEVER throws: a broken rule must not fail the
 * change that fired it.
 *
 * Loops are prevented two ways:
 *   - a rule can't re-enter itself for the same record (`running`), so a rule
 *     whose own action fires the same trigger stops after one pass;
 *   - every task a rule creates carries a `systemKey`, so re-running a rule on
 *     a record it already acted on doesn't leave a second copy behind.
 */

/* ---------------------------------------------------------------- shapes */

export const CONDITION_FIELDS = ['pipeline', 'stage', 'amount', 'owner', 'dealType', 'source', 'tag', 'leadScore', 'leadStatus', 'companyType'] as const;
export type ConditionField = (typeof CONDITION_FIELDS)[number];

export const CONDITION_OPS = ['is', 'isNot', 'gte', 'lte'] as const;
export type ConditionOp = (typeof CONDITION_OPS)[number];

export type AutomationCondition = { field: ConditionField; op: ConditionOp; value: string };

export const ACTION_TYPES = ['createTask', 'notify', 'sendEmail', 'setField', 'enrollSequence'] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

export const SET_FIELDS = ['owner', 'forecastCategory', 'dealType', 'leadStatus', 'addTag'] as const;
export type SetField = (typeof SET_FIELDS)[number];

export type AutomationAction = {
  type: ActionType;
  /** createTask */
  title?: string;
  taskType?: TaskType;
  priority?: TaskPriority;
  dueInDays?: number;
  /** createTask / notify / setField owner: 'owner' means the record's owner, otherwise a member id. */
  memberId?: string;
  /** notify */
  message?: string;
  /** sendEmail */
  templateId?: string;
  /** setField */
  field?: SetField;
  value?: string;
  /** enrollSequence */
  sequenceId?: string;
};

export type AutomationRow = {
  id: string;
  name: string;
  description: string | null;
  trigger: TriggerKind;
  conditions: AutomationCondition[];
  actions: AutomationAction[];
  active: boolean;
  ownerId: string | null;
  runCount: number;
  lastRunAt: string | null;
  createdAt: string | null;
};

export const TRIGGERS: TriggerKind[] = [
  'deal.created',
  'deal.stage_changed',
  'deal.won',
  'deal.lost',
  'deal.stalled',
  'lead.created',
  'lead.status_changed',
  'lead.converted',
  'contact.created',
  'company.created',
  'form.submitted',
  'meeting.booked',
  'quote.accepted',
  'quote.declined',
  'task.completed',
  'activity.logged',
];

const isTrigger = (v: unknown): v is TriggerKind => typeof v === 'string' && (TRIGGERS as string[]).includes(v);

function toCondition(raw: unknown): AutomationCondition | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const field = String(r.field ?? '');
  const op = String(r.op ?? 'is');
  if (!(CONDITION_FIELDS as readonly string[]).includes(field)) return null;
  return { field: field as ConditionField, op: ((CONDITION_OPS as readonly string[]).includes(op) ? op : 'is') as ConditionOp, value: r.value == null ? '' : String(r.value) };
}

function toAction(raw: unknown): AutomationAction | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const type = String(r.type ?? '');
  if (!(ACTION_TYPES as readonly string[]).includes(type)) return null;
  return {
    type: type as ActionType,
    title: r.title == null ? undefined : String(r.title),
    taskType: r.taskType == null ? undefined : (String(r.taskType) as TaskType),
    priority: r.priority == null ? undefined : (String(r.priority) as TaskPriority),
    dueInDays: r.dueInDays == null ? undefined : Number(r.dueInDays),
    memberId: r.memberId == null ? undefined : String(r.memberId),
    message: r.message == null ? undefined : String(r.message),
    templateId: r.templateId == null ? undefined : String(r.templateId),
    field: r.field == null ? undefined : (String(r.field) as SetField),
    value: r.value == null ? undefined : String(r.value),
    sequenceId: r.sequenceId == null ? undefined : String(r.sequenceId),
  };
}

export function toAutomationRow(r: Record<string, unknown>): AutomationRow {
  return {
    id: String(r.id),
    name: str(r.name) ?? '',
    description: str(r.description) || null,
    trigger: isTrigger(r.trigger) ? r.trigger : 'deal.won',
    conditions: json<unknown[]>(r.conditions, []).map(toCondition).filter((c): c is AutomationCondition => Boolean(c)),
    actions: json<unknown[]>(r.actions, []).map(toAction).filter((a): a is AutomationAction => Boolean(a)),
    active: bool(r.active),
    ownerId: ref(r.ownerId),
    runCount: num(r.runCount),
    lastRunAt: iso(r.lastRunAt),
    createdAt: iso(r.created_at),
  };
}

export async function loadAutomations(trigger?: TriggerKind, onlyActive = false): Promise<AutomationRow[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (trigger) {
    params.push(trigger);
    where.push(`"trigger" = $${params.length}`);
  }
  if (onlyActive) where.push(`COALESCE("active", false) = true`);
  const { rows } = await zite.sql({
    query: `SELECT * FROM "Automations" ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at ASC`,
    params,
  });
  return rows.map(toAutomationRow);
}

/* --------------------------------------------------------- record context */

/** Everything conditions can read and actions can act on, resolved once per trigger. */
export type RecordContext = {
  kind: 'deal' | 'lead' | 'contact' | 'company' | null;
  id: string | null;
  name: string;
  ownerId: string | null;
  companyId: string | null;
  contactId: string | null;
  dealId: string | null;
  leadId: string | null;
  tagIds: string[];
  pipelineId: string | null;
  stageId: string | null;
  amount: number | null;
  dealType: string | null;
  source: string | null;
  leadScore: number | null;
  leadStatus: string | null;
  companyType: string | null;
  stageEnteredAt: string | null;
};

const EMPTY: RecordContext = {
  kind: null,
  id: null,
  name: '',
  ownerId: null,
  companyId: null,
  contactId: null,
  dealId: null,
  leadId: null,
  tagIds: [],
  pipelineId: null,
  stageId: null,
  amount: null,
  dealType: null,
  source: null,
  leadScore: null,
  leadStatus: null,
  companyType: null,
  stageEnteredAt: null,
};

async function loadDealContext(dealId: string): Promise<RecordContext | null> {
  const { rows } = await zite.sql({
    query: `SELECT d.*, c."type" AS "companyType" FROM "Deals" d LEFT JOIN "Companies" c ON c.id::text = d."companyId" WHERE d.id::text = $1 LIMIT 1`,
    params: [dealId],
  });
  const d = rows[0];
  if (!d) return null;
  return {
    ...EMPTY,
    kind: 'deal',
    id: String(d.id),
    name: str(d.name) ?? '',
    ownerId: ref(d.ownerId),
    companyId: ref(d.companyId),
    contactId: ref(d.contactId),
    dealId: String(d.id),
    tagIds: idList(d.tagIds),
    pipelineId: ref(d.pipelineId),
    stageId: ref(d.stageId),
    amount: numOrNull(d.amount),
    dealType: str(d.type) || null,
    source: str(d.source) || null,
    companyType: str(d.companyType) || null,
    stageEnteredAt: iso(d.stageEnteredAt),
  };
}

async function loadLeadContext(leadId: string): Promise<RecordContext | null> {
  const { rows } = await zite.sql({ query: `SELECT * FROM "Leads" WHERE id::text = $1 LIMIT 1`, params: [leadId] });
  const l = rows[0];
  if (!l) return null;
  return {
    ...EMPTY,
    kind: 'lead',
    id: String(l.id),
    name: str(l.name) ?? '',
    ownerId: ref(l.ownerId),
    leadId: String(l.id),
    contactId: ref(l.convertedContactId),
    companyId: ref(l.convertedCompanyId),
    tagIds: idList(l.tagIds),
    source: str(l.source) || null,
    leadScore: numOrNull(l.score),
    leadStatus: str(l.status) || null,
  };
}

async function loadContactContext(contactId: string): Promise<RecordContext | null> {
  const { rows } = await zite.sql({
    query: `SELECT ct.*, co."type" AS "companyType" FROM "Contacts" ct LEFT JOIN "Companies" co ON co.id::text = ct."companyId" WHERE ct.id::text = $1 LIMIT 1`,
    params: [contactId],
  });
  const c = rows[0];
  if (!c) return null;
  return {
    ...EMPTY,
    kind: 'contact',
    id: String(c.id),
    name: str(c.name) ?? '',
    ownerId: ref(c.ownerId),
    contactId: String(c.id),
    companyId: ref(c.companyId),
    tagIds: idList(c.tagIds),
    source: str(c.source) || null,
    companyType: str(c.companyType) || null,
  };
}

async function loadCompanyContext(companyId: string): Promise<RecordContext | null> {
  const { rows } = await zite.sql({ query: `SELECT * FROM "Companies" WHERE id::text = $1 LIMIT 1`, params: [companyId] });
  const c = rows[0];
  if (!c) return null;
  return {
    ...EMPTY,
    kind: 'company',
    id: String(c.id),
    name: str(c.name) ?? '',
    ownerId: ref(c.ownerId),
    companyId: String(c.id),
    tagIds: idList(c.tagIds),
    source: str(c.source) || null,
    companyType: str(c.type) || null,
  };
}

/** Merge a child record's links into whichever parent context we could load. */
async function contextFromLinks(links: { dealId?: unknown; leadId?: unknown; contactId?: unknown; companyId?: unknown }): Promise<RecordContext | null> {
  const dealId = ref(links.dealId);
  const leadId = ref(links.leadId);
  const contactId = ref(links.contactId);
  const companyId = ref(links.companyId);
  let ctx: RecordContext | null = null;
  if (dealId) ctx = await loadDealContext(dealId);
  if (!ctx && leadId) ctx = await loadLeadContext(leadId);
  if (!ctx && contactId) ctx = await loadContactContext(contactId);
  if (!ctx && companyId) ctx = await loadCompanyContext(companyId);
  if (!ctx) return null;
  return { ...ctx, contactId: ctx.contactId ?? contactId, companyId: ctx.companyId ?? companyId, leadId: ctx.leadId ?? leadId };
}

/** Resolve the record a trigger is about — following a quote, task or activity up to its deal or lead. */
export async function loadContext(payload: TriggerPayload): Promise<RecordContext | null> {
  const id = payload.entityId;
  if (!id) return null;
  switch (payload.entityType) {
    case 'deal':
      return loadDealContext(id);
    case 'lead':
      return loadLeadContext(id);
    case 'contact':
      return loadContactContext(id);
    case 'company':
      return loadCompanyContext(id);
    case 'quote': {
      const { rows } = await zite.sql({ query: `SELECT "dealId", "companyId", "contactId" FROM "Quotes" WHERE id::text = $1 LIMIT 1`, params: [id] });
      return rows[0] ? contextFromLinks(rows[0]) : null;
    }
    case 'task': {
      const { rows } = await zite.sql({ query: `SELECT "dealId", "leadId", "companyId", "contactId" FROM "Tasks" WHERE id::text = $1 LIMIT 1`, params: [id] });
      return rows[0] ? contextFromLinks(rows[0]) : null;
    }
    case 'activity': {
      const { rows } = await zite.sql({ query: `SELECT "dealId", "leadId", "companyId", "contactId" FROM "Activities" WHERE id::text = $1 LIMIT 1`, params: [id] });
      return rows[0] ? contextFromLinks(rows[0]) : null;
    }
    case 'form': {
      const leadId = payload.data && typeof payload.data === 'object' ? ref((payload.data as Record<string, unknown>).leadId) : null;
      return leadId ? loadLeadContext(leadId) : null;
    }
    default:
      return null;
  }
}

/* ------------------------------------------------------------ conditions */

function compare(op: ConditionOp, actual: string | null, expected: string) {
  const a = (actual ?? '').trim().toLowerCase();
  const b = expected.trim().toLowerCase();
  return op === 'isNot' ? a !== b : a === b;
}

function compareNumber(op: ConditionOp, actual: number | null, expected: string) {
  const b = Number(expected);
  if (!Number.isFinite(b)) return true;
  const a = actual ?? 0;
  if (op === 'lte') return a <= b;
  if (op === 'gte') return a >= b;
  if (op === 'isNot') return a !== b;
  return a === b;
}

export function matches(conditions: AutomationCondition[], ctx: RecordContext): boolean {
  for (const c of conditions) {
    let ok = true;
    switch (c.field) {
      case 'pipeline':
        ok = compare(c.op, ctx.pipelineId, c.value);
        break;
      case 'stage':
        ok = compare(c.op, ctx.stageId, c.value);
        break;
      case 'amount':
        ok = compareNumber(c.op, ctx.amount, c.value);
        break;
      case 'owner':
        ok = compare(c.op, ctx.ownerId ?? '', c.value === 'unassigned' ? '' : c.value);
        break;
      case 'dealType':
        ok = compare(c.op, ctx.dealType, c.value);
        break;
      case 'source':
        ok = compare(c.op, ctx.source, c.value);
        break;
      case 'tag': {
        const has = ctx.tagIds.includes(c.value);
        ok = c.op === 'isNot' ? !has : has;
        break;
      }
      case 'leadScore':
        ok = compareNumber(c.op, ctx.leadScore, c.value);
        break;
      case 'leadStatus':
        ok = compare(c.op, ctx.leadStatus, c.value);
        break;
      case 'companyType':
        ok = compare(c.op, ctx.companyType, c.value);
        break;
    }
    if (!ok) return false;
  }
  return true;
}

/* --------------------------------------------------------------- actions */

const DAY_MS = 86_400_000;
const addDays = (iso8601: string, n: number) => new Date(Date.parse(iso8601) + n * DAY_MS).toISOString().slice(0, 10);

/** The Actor an automation writes as: its own owner when it has one, so history reads sensibly. */
async function automationActor(automation: AutomationRow, ctx: RecordContext): Promise<Actor | null> {
  const member = (await memberById(automation.ownerId)) ?? (await memberById(ctx.ownerId));
  if (!member) return null;
  return { id: member.id, name: member.name, email: member.email, role: member.role, created: false };
}

function linksFor(ctx: RecordContext) {
  return { dealId: ctx.dealId, leadId: ctx.leadId, contactId: ctx.contactId, companyId: ctx.companyId };
}

function pathFor(ctx: RecordContext) {
  if (ctx.dealId) return entityPath('deal', ctx.dealId);
  if (ctx.leadId) return entityPath('lead', ctx.leadId);
  if (ctx.contactId) return entityPath('contact', ctx.contactId);
  if (ctx.companyId) return entityPath('company', ctx.companyId);
  return '/home';
}

async function runAction(automation: AutomationRow, action: AutomationAction, ctx: RecordContext, payload: RunPayload): Promise<string> {
  const actor = await automationActor(automation, ctx);
  switch (action.type) {
    case 'createTask': {
      const title = (action.title ?? '').trim();
      if (!title) return 'no task title set';
      const ownerId = !action.memberId || action.memberId === 'owner' ? ctx.ownerId : action.memberId;
      const dueDate = addDays(new Date().toISOString(), Math.max(0, Math.round(action.dueInDays ?? 0)));
      // One task per rule per record per stall, so a repeated trigger can't stack copies up.
      const stamp = payload.trigger === 'deal.stalled' ? (ctx.stageEnteredAt ?? '').slice(0, 10) : '';
      const systemKey = `auto:${automation.id}:${ctx.id ?? payload.entityId}${stamp ? `:${stamp}` : ''}`;
      const { rows } = await zite.sql({ query: `SELECT id FROM "Tasks" WHERE "systemKey" = $1 LIMIT 1`, params: [systemKey] });
      if (rows[0]) return `task “${title}” was already there`;
      await createTask(actor, {
        ...linksFor(ctx),
        title,
        type: action.taskType ?? 'To-do',
        priority: action.priority ?? 'Normal',
        dueDate,
        ownerId,
        systemKey,
        notes: `Created by the automation “${automation.name}”.`,
      });
      return `created the task “${title}”`;
    }
    case 'notify': {
      const recipient = !action.memberId || action.memberId === 'owner' ? ctx.ownerId : action.memberId;
      if (!recipient) return 'nobody to notify';
      const sent = await notify({
        recipientIds: [recipient],
        kind: 'automation',
        title: (action.message ?? '').trim() || `${automation.name}: ${ctx.name || 'a record'}`,
        body: ctx.name ? `On ${ctx.name}.` : null,
        link: pathFor(ctx),
        entityType: ctx.kind ?? payload.entityType,
        entityId: ctx.id ?? payload.entityId,
        actorId: null,
      });
      return sent ? 'sent a notification' : 'nobody to notify';
    }
    case 'sendEmail': {
      if (!action.templateId) return 'no email template chosen';
      if (!ctx.contactId) return 'no contact to email';
      const [template, contact, settings] = await Promise.all([
        zite.emailTemplates.findOne({ id: action.templateId }),
        zite.contacts.findOne({ id: ctx.contactId }),
        getSettings(),
      ]);
      if (!template) return 'that email template no longer exists';
      if (!contact?.email) return 'that contact has no email address';
      if (contact.doNotContact || contact.unsubscribedAt) return `${contact.name ?? 'that contact'} has opted out of email`;
      const sender = await memberById(ctx.ownerId);
      const merge = await mergeContext({ settings, sender, contactId: ctx.contactId, companyId: ctx.companyId, dealId: ctx.dealId });
      const subject = renderMerge(template.subject ?? '', merge) || template.name || 'A note from us';
      const text = renderMerge(template.body ?? '', merge);
      const result = await sendEmail({ to: contact.email, subject, text, replyTo: sender?.email ?? null, settings, signature: sender?.signature ?? null, footer: {} });
      await createActivity(actor, {
        ...linksFor(ctx),
        kind: 'Email',
        subject,
        body: text,
        direction: 'Outbound',
        delivery: result.delivery,
        emailTo: contact.email,
        emailFrom: sender?.email ?? null,
        ownerId: ctx.ownerId,
      });
      return result.delivery === 'Sent' ? `emailed ${contact.email}` : `recorded an email to ${contact.email} (${result.reason ?? result.delivery})`;
    }
    case 'setField': {
      const value = (action.value ?? '').trim();
      switch (action.field) {
        case 'owner': {
          const ownerId = value === 'unassigned' || !value ? null : value;
          if (!ctx.id || !ctx.kind) return 'nothing to change';
          if (ctx.kind === 'deal' && actor) {
            await updateDeal(actor, ctx.id, { ownerId }, { today: new Date().toISOString().slice(0, 10) });
          } else {
            const table = { deal: 'deals', lead: 'leads', contact: 'contacts', company: 'companies' }[ctx.kind] as 'deals' | 'leads' | 'contacts' | 'companies';
            await withRetry(() => (zite[table] as { update: (a: { id: string; record: never }) => Promise<unknown> }).update({ id: ctx.id as string, record: { ownerId } as never }));
            await logEvent({ kind: `${ctx.kind}.owner_changed`, entity: { type: ctx.kind, id: ctx.id }, actorId: actor?.id ?? null, summary: ownerId ? 'changed the owner' : 'removed the owner' });
          }
          if (ownerId) await notify({ recipientIds: [ownerId], kind: 'assigned', title: `“${automation.name}” gave you ${ctx.name || 'a record'}`, link: pathFor(ctx), entityType: ctx.kind, entityId: ctx.id, actorId: null });
          return ownerId ? 'changed the owner' : 'cleared the owner';
        }
        case 'forecastCategory': {
          if (ctx.kind !== 'deal' || !ctx.id || !actor) return 'only deals have a forecast category';
          await updateDeal(actor, ctx.id, { forecastCategory: value as ForecastCategory }, { today: new Date().toISOString().slice(0, 10) });
          return `set the forecast category to ${value}`;
        }
        case 'dealType': {
          if (ctx.kind !== 'deal' || !ctx.id || !actor) return 'only deals have a type';
          await updateDeal(actor, ctx.id, { type: value as DealType }, { today: new Date().toISOString().slice(0, 10) });
          return `set the deal type to ${value}`;
        }
        case 'leadStatus': {
          if (ctx.kind !== 'lead' || !ctx.id) return 'only leads have a status';
          if (ctx.leadStatus === value) return `the lead was already ${value}`;
          if (actor) {
            await setLeadStatus(actor, ctx.id, value as LeadStatus, { previous: ctx.leadStatus });
          } else {
            await withRetry(() => zite.leads.update({ id: ctx.id as string, record: { status: value as LeadStatus } }));
            await logEvent({ kind: 'lead.status_changed', entity: { type: 'lead', id: ctx.id }, actorId: null, summary: `moved the lead to ${value}`, leadId: ctx.id });
          }
          return `set the lead’s status to ${value}`;
        }
        case 'addTag': {
          if (!ctx.id || !ctx.kind || !value) return 'no tag chosen';
          if (ctx.tagIds.includes(value)) return 'that tag was already on the record';
          const tag = await zite.tags.findOne({ id: value });
          const table = { deal: 'deals', lead: 'leads', contact: 'contacts', company: 'companies' }[ctx.kind] as 'deals' | 'leads' | 'contacts' | 'companies';
          const next = [...ctx.tagIds, value];
          await withRetry(() => (zite[table] as { update: (a: { id: string; record: never }) => Promise<unknown> }).update({ id: ctx.id as string, record: { tagIds: JSON.stringify(next) } as never }));
          ctx.tagIds = next;
          return `added the tag ${tag?.name ?? ''}`.trim();
        }
        default:
          return 'nothing to change';
      }
    }
    case 'enrollSequence': {
      if (!action.sequenceId) return 'no sequence chosen';
      if (!ctx.contactId) return 'no contact to enroll';
      if (!actor) return 'the automation has no owner to enroll as';
      const result = await enrollContacts({ actor, sequenceId: action.sequenceId, contactIds: [ctx.contactId], ownerId: ctx.ownerId, dealId: ctx.dealId, includeUndeliverable: true });
      if (result.enrolled) return 'enrolled the contact in a sequence';
      return `couldn’t enroll the contact — ${result.skipped[0]?.reason ?? 'they were skipped'}`;
    }
    default:
      return 'nothing to do';
  }
}

/* ------------------------------------------------------------------ runs */

export type RunOutcome = { status: 'Succeeded' | 'Failed' | 'Skipped'; detail: string };

/** A payload plus the trigger that produced it — the engine's own shape. */
export type RunPayload = TriggerPayload & { trigger: TriggerKind };

async function recordRun(automation: AutomationRow, payload: RunPayload, outcome: RunOutcome) {
  try {
    await withRetry(() =>
      zite.automationRuns.create({
        record: {
          automationId: automation.id,
          entityType: payload.entityType,
          entityId: payload.entityId,
          status: outcome.status,
          detail: outcome.detail.slice(0, 1000),
          ranAt: new Date().toISOString(),
        },
      }),
    );
    if (outcome.status !== 'Skipped') {
      await withRetry(() => zite.automations.update({ id: automation.id, record: { runCount: automation.runCount + 1, lastRunAt: new Date().toISOString() } }));
    }
  } catch (err) {
    console.error('automation run log failed', err instanceof Error ? err.message : err);
  }
}

/** Run one rule against one record, whatever fired it. Used by the trigger loop and by "Run on the last match". */
export async function runAutomationOnce(automation: AutomationRow, payload: RunPayload, opts: { recordSkips?: boolean } = {}): Promise<RunOutcome> {
  // A rule already on the stack is a rule acting on its own writes — stop there.
  if (stack.includes(automation.id)) return { status: 'Skipped', detail: 'This rule was already running, so its own changes didn’t start it again' };
  let outcome: RunOutcome;
  stack.push(automation.id);
  try {
    const ctx = await loadContext(payload);
    if (!ctx) {
      outcome = { status: 'Skipped', detail: 'The record this fired for no longer exists' };
    } else if (!matches(automation.conditions, ctx)) {
      outcome = { status: 'Skipped', detail: `${ctx.name || 'That record'} doesn’t meet the conditions` };
    } else if (!automation.actions.length) {
      outcome = { status: 'Skipped', detail: 'This rule has no actions yet' };
    } else {
      const done: string[] = [];
      for (const action of automation.actions) {
        done.push(await runAction(automation, action, ctx, payload));
      }
      outcome = { status: 'Succeeded', detail: `${ctx.name || 'Record'}: ${done.join('; ')}` };
    }
  } catch (err) {
    outcome = { status: 'Failed', detail: err instanceof Error ? err.message : 'Something went wrong running this rule' };
  } finally {
    stack.splice(stack.lastIndexOf(automation.id), 1);
  }
  if (outcome.status !== 'Skipped' || opts.recordSkips) await recordRun(automation, payload, outcome);
  return outcome;
}

/**
 * The rules currently mid-run. An action that writes (an email logs an
 * activity, a field change logs an event) fires triggers of its own, so a rule
 * already on the stack is skipped rather than allowed to act on itself.
 */
const stack: string[] = [];

export async function runTrigger(trigger: TriggerKind, payload: TriggerPayload): Promise<void> {
  try {
    if (stack.length >= 4) return; // a runaway chain: stop rather than cascade
    const automations = await loadAutomations(trigger, true);
    if (!automations.length) return;
    // Sequential on purpose: live Zite rate-limits bursts of parallel writes.
    for (const automation of automations) {
      await runAutomationOnce(automation, { ...payload, trigger });
    }
  } catch (err) {
    // An automation must never fail the change that fired it.
    console.error('runTrigger failed', err instanceof Error ? err.message : err);
  }
}

/* ----------------------------------------------- finding a record to test */

const CANDIDATES: Record<TriggerKind, { sql: string; entityType: TriggerPayload['entityType'] }> = {
  'deal.created': { sql: `SELECT id FROM "Deals" ORDER BY created_at DESC LIMIT 40`, entityType: 'deal' },
  'deal.stage_changed': { sql: `SELECT id FROM "Deals" ORDER BY "stageEnteredAt" DESC NULLS LAST LIMIT 40`, entityType: 'deal' },
  'deal.won': { sql: `SELECT id FROM "Deals" WHERE "status" = 'Won' ORDER BY "closedAt" DESC NULLS LAST LIMIT 40`, entityType: 'deal' },
  'deal.lost': { sql: `SELECT id FROM "Deals" WHERE "status" = 'Lost' ORDER BY "closedAt" DESC NULLS LAST LIMIT 40`, entityType: 'deal' },
  'deal.stalled': { sql: `SELECT id FROM "Deals" WHERE "status" = 'Open' ORDER BY "stageEnteredAt" ASC NULLS LAST LIMIT 40`, entityType: 'deal' },
  'lead.created': { sql: `SELECT id FROM "Leads" ORDER BY "receivedAt" DESC NULLS LAST LIMIT 40`, entityType: 'lead' },
  'lead.status_changed': { sql: `SELECT id FROM "Leads" ORDER BY updated_at DESC LIMIT 40`, entityType: 'lead' },
  'lead.converted': { sql: `SELECT id FROM "Leads" WHERE "convertedAt" IS NOT NULL ORDER BY "convertedAt" DESC LIMIT 40`, entityType: 'lead' },
  'contact.created': { sql: `SELECT id FROM "Contacts" ORDER BY created_at DESC LIMIT 40`, entityType: 'contact' },
  'company.created': { sql: `SELECT id FROM "Companies" ORDER BY created_at DESC LIMIT 40`, entityType: 'company' },
  'form.submitted': { sql: `SELECT id FROM "Leads" WHERE COALESCE("formId", '') <> '' ORDER BY "receivedAt" DESC NULLS LAST LIMIT 40`, entityType: 'lead' },
  'meeting.booked': { sql: `SELECT id FROM "Activities" WHERE "kind" = 'Meeting' ORDER BY "occurredAt" DESC NULLS LAST LIMIT 40`, entityType: 'activity' },
  'quote.accepted': { sql: `SELECT id FROM "Quotes" WHERE "status" = 'Accepted' ORDER BY created_at DESC LIMIT 40`, entityType: 'quote' },
  'quote.declined': { sql: `SELECT id FROM "Quotes" WHERE "status" = 'Declined' ORDER BY created_at DESC LIMIT 40`, entityType: 'quote' },
  'task.completed': { sql: `SELECT id FROM "Tasks" WHERE "status" = 'Done' ORDER BY "completedAt" DESC NULLS LAST LIMIT 40`, entityType: 'task' },
  'activity.logged': { sql: `SELECT id FROM "Activities" ORDER BY "occurredAt" DESC NULLS LAST LIMIT 40`, entityType: 'activity' },
};

/** The most recent record this rule would fire on, for "Run on the last matching record". */
export async function findLastMatch(automation: AutomationRow): Promise<RunPayload | null> {
  const plan = CANDIDATES[automation.trigger];
  if (!plan) return null;
  const { rows } = await zite.sql({ query: plan.sql, params: [] });
  for (const row of rows) {
    const payload: RunPayload = { entityType: plan.entityType, entityId: String(row.id), actorId: null, trigger: automation.trigger };
    const ctx = await loadContext(payload);
    if (ctx && matches(automation.conditions, ctx)) return payload;
  }
  return null;
}
