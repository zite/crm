import { z } from 'zod';
import { createEndpoint } from 'zitejs/backend';
import { assertCan, getActor } from '@project/shared/server/actor';
import { createTask } from '@project/shared/server/tasks';
import { TASK_PRIORITIES, TASK_TYPES } from '@project/shared/constants';
import { day, id, parseInput } from '../server/input';

const inputSchema = z.object({
  title: z.string().trim().min(1, 'Give the task a title').max(240),
  type: z.enum(TASK_TYPES).optional(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  dueDate: day.nullable().optional(),
  dueTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a time like 09:30').nullable().optional(),
  ownerId: id.nullable().optional(),
  notes: z.string().max(10_000).nullable().optional(),
  companyId: id.nullable().optional(),
  contactId: id.nullable().optional(),
  dealId: id.nullable().optional(),
  leadId: id.nullable().optional(),
});

export default createEndpoint({
  description: 'Create a task',
  authenticated: true,
  inputSchema,
  outputSchema: z.object({ id: z.string() }),
  execute: async ({ input, context }) => {
    const data = parseInput(inputSchema, input);
    const actor = await getActor(context);
    assertCan(actor, 'records.edit');
    return { id: await createTask(actor, data) };
  },
});
