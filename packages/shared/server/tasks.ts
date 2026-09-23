import { zite } from 'zitejs/db';
import type { TaskPriority, TaskType } from '../constants';
import { longDay } from '../format';
import type { Actor } from './actor';
import { runTrigger } from './automations';
import { logEvent } from './events';
import { notify } from './notify';
import { entityPath, resolveLinks, type Links } from './records';
import { day, iso, ref, str, withRetry } from './sql';

/**
 * Tasks: the to-dos that make "next step" real. `createTask` is the only
 * writer of new tasks (people, sequences and automations all go through it),
 * so assignment notifications and history are never skipped.
 */

export type TaskInput = Links & {
  title: string;
  type?: TaskType;
  priority?: TaskPriority;
  dueDate?: string | null;
  dueTime?: string | null;
  ownerId?: string | null;
  notes?: string | null;
  enrollmentId?: string | null;
  stepId?: string | null;
  systemKey?: string | null;
};

export async function createTask(actor: Pick<Actor, 'id' | 'name'> | null, input: TaskInput) {
  const links = await resolveLinks(input);
  const ownerId = input.ownerId === undefined ? actor?.id ?? null : input.ownerId;
  const created = await withRetry(() =>
    zite.tasks.create({
      record: {
        title: input.title.trim().slice(0, 240),
        type: input.type ?? 'To-do',
        status: 'Open',
        priority: input.priority ?? 'Normal',
        dueDate: input.dueDate ?? null,
        dueTime: input.dueTime ?? null,
        ownerId,
        createdById: actor?.id ?? null,
        notes: input.notes ?? null,
        enrollmentId: input.enrollmentId ?? null,
        stepId: input.stepId ?? null,
        systemKey: input.systemKey ?? null,
        ...links,
      },
    }),
  );
  if (ownerId && ownerId !== actor?.id) {
    const where = links.dealId ? entityPath('deal', links.dealId) : links.contactId ? entityPath('contact', links.contactId) : links.companyId ? entityPath('company', links.companyId) : links.leadId ? entityPath('lead', links.leadId) : '/tasks';
    await notify({
      recipientIds: [ownerId],
      kind: 'assigned',
      title: `${actor?.name ?? 'An automation'} assigned you a task: ${input.title.trim()}`,
      body: input.dueDate ? `Due ${longDay(input.dueDate)}` : null,
      link: where,
      entityType: 'task',
      entityId: created.id,
      actorId: actor?.id ?? null,
    });
  }
  return created.id;
}

/** Create a system task once per `systemKey` (automations, stalled-deal nudges). Returns the id, new or existing. */
export async function ensureTask(actor: Pick<Actor, 'id' | 'name'> | null, input: TaskInput & { systemKey: string }) {
  const { rows } = await zite.sql({ query: `SELECT id FROM "Tasks" WHERE "systemKey" = $1 LIMIT 1`, params: [input.systemKey] });
  if (rows[0]) return String(rows[0].id);
  return createTask(actor, input);
}

export async function completeTask(actor: Pick<Actor, 'id' | 'name'>, taskId: string, done: boolean) {
  const task = await zite.tasks.findOne({ id: taskId });
  if (!task) return null;
  const wasDone = task.status === 'Done';
  if (wasDone === done) return task;
  await withRetry(() => zite.tasks.update({ id: taskId, record: { status: done ? 'Done' : 'Open', completedAt: done ? new Date().toISOString() : null } }));
  if (done) {
    await logEvent({
      kind: 'task.completed',
      entity: { type: 'task', id: taskId },
      actorId: actor.id,
      summary: `completed “${task.title ?? 'a task'}”`,
      companyId: task.companyId || null,
      contactId: task.contactId || null,
      dealId: task.dealId || null,
      leadId: task.leadId || null,
    });
    await runTrigger('task.completed', { entityType: 'task', entityId: taskId, actorId: actor.id });
  }
  return task;
}

export type NextStep = { taskId: string; title: string; type: string; dueDate: string | null; dueTime: string | null; ownerId: string | null };

/**
 * The earliest open task per record, for "next step" in lists and cards.
 * `column` is the Tasks column that points at the records.
 */
export async function nextStepsFor(column: 'companyId' | 'contactId' | 'dealId' | 'leadId', ids: string[]): Promise<Map<string, NextStep>> {
  const out = new Map<string, NextStep>();
  if (!ids.length) return out;
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    const placeholders = chunk.map((_, j) => `$${j + 1}`).join(', ');
    const { rows } = await zite.sql({
      query: `
        SELECT DISTINCT ON ("${column}") id, "${column}" AS "recordRef", "title", "type", "dueDate", "dueTime", "ownerId"
        FROM "Tasks"
        WHERE "status" = 'Open' AND "${column}" IN (${placeholders})
        ORDER BY "${column}", "dueDate" ASC NULLS LAST, COALESCE(NULLIF("dueTime", ''), '99:99') ASC, created_at ASC`,
      params: chunk,
    });
    for (const r of rows) {
      out.set(String(r.recordRef), { taskId: String(r.id), title: str(r.title) ?? '', type: str(r.type) ?? 'To-do', dueDate: day(r.dueDate), dueTime: str(r.dueTime) || null, ownerId: ref(r.ownerId) });
    }
  }
  return out;
}

export type TaskRow = {
  id: string;
  title: string;
  type: string;
  status: 'Open' | 'Done';
  priority: string;
  dueDate: string | null;
  dueTime: string | null;
  ownerId: string | null;
  createdById: string | null;
  companyId: string | null;
  contactId: string | null;
  dealId: string | null;
  leadId: string | null;
  notes: string | null;
  completedAt: string | null;
  enrollmentId: string | null;
  createdAt: string | null;
};

export function toTaskRow(r: Record<string, unknown>): TaskRow {
  return {
    id: String(r.id),
    title: str(r.title) ?? '',
    type: str(r.type) || 'To-do',
    status: r.status === 'Done' ? 'Done' : 'Open',
    priority: str(r.priority) || 'Normal',
    dueDate: day(r.dueDate),
    dueTime: str(r.dueTime) || null,
    ownerId: ref(r.ownerId),
    createdById: ref(r.createdById),
    companyId: ref(r.companyId),
    contactId: ref(r.contactId),
    dealId: ref(r.dealId),
    leadId: ref(r.leadId),
    notes: str(r.notes) || null,
    completedAt: iso(r.completedAt),
    enrollmentId: ref(r.enrollmentId),
    createdAt: iso(r.created_at),
  };
}
