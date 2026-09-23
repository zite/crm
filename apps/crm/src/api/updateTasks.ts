import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { assertCan, assertMember, getActor } from '@project/shared/server/actor';
import { completeTask } from '@project/shared/server/tasks';
import { notify } from '@project/shared/server/notify';
import { withRetry } from '@project/shared/server/sql';
import { TASK_PRIORITIES, TASK_TYPES } from '@project/shared/constants';
import { day, id, parseInput } from '../server/input';

const patchSchema = z
  .object({
    title: z.string().trim().min(1).max(240),
    status: z.enum(['Open', 'Done']),
    type: z.enum(TASK_TYPES),
    priority: z.enum(TASK_PRIORITIES),
    dueDate: day.nullable(),
    dueTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable(),
    ownerId: id.nullable(),
    notes: z.string().max(10_000).nullable(),
    companyId: id.nullable(),
    contactId: id.nullable(),
    dealId: id.nullable(),
    leadId: id.nullable(),
  })
  .partial();

const inputSchema = z.object({ ids: z.array(id).min(1).max(500), patch: patchSchema });

export default createEndpoint({
  description: 'Update tasks: complete or reopen, reschedule, reassign, edit',
  authenticated: true,
  inputSchema,
  outputSchema: z.object({ updated: z.number() }),
  execute: async ({ input, context }) => {
    const { ids, patch } = parseInput(inputSchema, input);
    const actor = await getActor(context);
    assertCan(actor, 'records.edit');
    if (!Object.keys(patch).length) throw new ZiteError('Nothing to change', 'BAD_REQUEST');
    if (patch.ownerId) await assertMember(patch.ownerId, 'assignee');
    const { status, ...rest } = patch;
    let updated = 0;
    for (const taskId of ids) {
      const task = await zite.tasks.findOne({ id: taskId });
      if (!task) continue;
      if (status !== undefined) await completeTask(actor, taskId, status === 'Done');
      const record = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined));
      if (Object.keys(record).length) await withRetry(() => zite.tasks.update({ id: taskId, record: record as never }));
      if (rest.ownerId && rest.ownerId !== task.ownerId && rest.ownerId !== actor.id) {
        await notify({ recipientIds: [rest.ownerId], kind: 'assigned', title: `${actor.name} assigned you a task: ${task.title ?? ''}`, link: '/tasks', entityType: 'task', entityId: taskId, actorId: actor.id });
      }
      updated++;
    }
    return { updated };
  },
});
