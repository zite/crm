import { z } from 'zod';
import { createEndpoint } from 'zitejs/backend';
import { assertCan, getActor } from '@project/shared/server/actor';
import { createActivity } from '@project/shared/server/activities';
import { createTask } from '@project/shared/server/tasks';
import { ACTIVITY_KINDS, ACTIVITY_OUTCOMES, DIRECTIONS } from '@project/shared/constants';
import { day, id, isoDateTime, parseInput } from '../server/input';

const inputSchema = z.object({
  kind: z.enum(ACTIVITY_KINDS),
  subject: z.string().max(240).nullable().optional(),
  body: z.string().max(20_000).nullable().optional(),
  occurredAt: isoDateTime.optional(),
  endsAt: isoDateTime.nullable().optional(),
  durationMinutes: z.number().int().min(0).max(24 * 60).nullable().optional(),
  outcome: z.enum(ACTIVITY_OUTCOMES).nullable().optional(),
  direction: z.enum(DIRECTIONS).nullable().optional(),
  location: z.string().max(500).nullable().optional(),
  attendees: z.array(z.object({ name: z.string().max(160), email: z.string().max(200).nullable().optional(), contactId: id.nullable().optional(), memberId: id.nullable().optional() })).max(30).optional(),
  emailTo: z.string().max(500).nullable().optional(),
  companyId: id.nullable().optional(),
  contactId: id.nullable().optional(),
  dealId: id.nullable().optional(),
  leadId: id.nullable().optional(),
  /** Create a follow-up task in the same step. */
  followUp: z.object({ title: z.string().trim().min(1).max(240), dueDate: day.nullable().optional(), type: z.enum(['To-do', 'Call', 'Email', 'Meeting', 'LinkedIn']).optional() }).nullable().optional(),
});

export default createEndpoint({
  description: 'Log a note, call, email or meeting on a record, optionally with a follow-up task',
  authenticated: true,
  inputSchema,
  outputSchema: z.object({ id: z.string(), taskId: z.string().nullable() }),
  execute: async ({ input, context }) => {
    const data = parseInput(inputSchema, input);
    const actor = await getActor(context);
    assertCan(actor, 'records.edit');
    const activityId = await createActivity(actor, { ...data, delivery: data.kind === 'Email' ? 'Logged' : null });
    let taskId: string | null = null;
    if (data.followUp) {
      taskId = await createTask(actor, {
        title: data.followUp.title,
        dueDate: data.followUp.dueDate ?? null,
        type: data.followUp.type ?? 'To-do',
        companyId: data.companyId ?? null,
        contactId: data.contactId ?? null,
        dealId: data.dealId ?? null,
        leadId: data.leadId ?? null,
      });
    }
    return { id: activityId, taskId };
  },
});
