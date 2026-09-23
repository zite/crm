import { z } from 'zod';
import { createEndpoint } from 'zitejs/backend';
import { assertCan, getActor } from '@project/shared/server/actor';
import { createDeal } from '@project/shared/server/deals';
import { createTask } from '@project/shared/server/tasks';
import { DEAL_TYPES, FORECAST_CATEGORIES } from '@project/shared/constants';
import { customValues, day, id, money, parseInput, tagIds } from '../server/input';

const inputSchema = z.object({
  name: z.string().trim().min(1, 'Give the deal a name').max(240),
  companyId: id.nullable().optional(),
  contactId: id.nullable().optional(),
  pipelineId: id.nullable().optional(),
  stageId: id.nullable().optional(),
  ownerId: id.nullable().optional(),
  amount: money.nullable().optional(),
  closeDate: day.nullable().optional(),
  type: z.enum(DEAL_TYPES).nullable().optional(),
  source: z.string().max(120).nullable().optional(),
  probability: z.number().min(0).max(100).nullable().optional(),
  forecastCategory: z.enum(FORECAST_CATEGORIES).nullable().optional(),
  description: z.string().max(20_000).nullable().optional(),
  tagIds: tagIds.optional(),
  customFields: customValues.optional(),
  /** Optional first task, so a new deal starts with a next step. */
  nextTask: z.object({ title: z.string().trim().min(1).max(240), dueDate: day.nullable().optional(), type: z.enum(['To-do', 'Call', 'Email', 'Meeting', 'LinkedIn']).optional() }).nullable().optional(),
});

export default createEndpoint({
  description: 'Create a deal (optionally with its first task)',
  authenticated: true,
  inputSchema,
  outputSchema: z.object({ id: z.string() }),
  execute: async ({ input, context }) => {
    const data = parseInput(inputSchema, input);
    const actor = await getActor(context);
    assertCan(actor, 'records.edit');
    const dealId = await createDeal(actor, data);
    if (data.nextTask) {
      await createTask(actor, { title: data.nextTask.title, dueDate: data.nextTask.dueDate ?? null, type: data.nextTask.type ?? 'To-do', dealId, ownerId: data.ownerId === undefined ? actor.id : data.ownerId });
    }
    return { id: dealId };
  },
});
