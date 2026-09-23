import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { assertCan, getActor } from '@project/shared/server/actor';
import { ACTION_TYPES, CONDITION_FIELDS, CONDITION_OPS, SET_FIELDS, TRIGGERS } from '@project/shared/server/automationsEngine';
import { logEvent } from '@project/shared/server/events';
import { withRetry } from '@project/shared/server/sql';
import { TASK_PRIORITIES, TASK_TYPES } from '@project/shared/constants';
import { id, parseInput } from '../server/input';

/**
 * Create or change an automation.
 *
 * Conditions and actions are stored as JSON so a new kind can be added without
 * a schema change; the engine re-reads them defensively, and this endpoint
 * refuses the shapes it knows can't work — an action with nothing to do, or a
 * rule pointing at a template that has been deleted.
 */

const condition = z.object({
  field: z.enum(CONDITION_FIELDS),
  op: z.enum(CONDITION_OPS),
  value: z.string().trim().max(120),
});

const action = z.object({
  type: z.enum(ACTION_TYPES),
  title: z.string().trim().max(240).optional(),
  taskType: z.enum(TASK_TYPES).optional(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  dueInDays: z.number().int().min(0).max(365).optional(),
  memberId: z.string().trim().max(64).optional(),
  message: z.string().trim().max(240).optional(),
  templateId: z.string().trim().max(64).optional(),
  field: z.enum(SET_FIELDS).optional(),
  value: z.string().trim().max(120).optional(),
  sequenceId: z.string().trim().max(64).optional(),
});

const inputSchema = z.object({
  automationId: id.optional(),
  name: z.string().trim().min(1, 'Give the automation a name').max(120),
  description: z.string().trim().max(400).optional(),
  trigger: z.enum(TRIGGERS as [string, ...string[]]),
  conditions: z.array(condition).max(12),
  actions: z.array(action).min(1, 'An automation needs at least one action').max(8),
  active: z.boolean().optional(),
});

export default createEndpoint({
  description: 'Create or change an automation: its trigger, conditions, actions and whether it is switched on',
  authenticated: true,
  inputSchema,
  outputSchema: z.object({ automationId: z.string(), created: z.boolean() }),
  execute: async ({ input, context }) => {
    const parsed = parseInput(inputSchema, input);
    const actor = await getActor(context);
    assertCan(actor, 'settings.manage');

    for (const a of parsed.actions) {
      if (a.type === 'createTask' && !a.title) throw new ZiteError('Give the task a title', 'BAD_REQUEST');
      if (a.type === 'sendEmail') {
        if (!a.templateId) throw new ZiteError('Choose the email template to send', 'BAD_REQUEST');
        const template = await zite.emailTemplates.findOne({ id: a.templateId });
        if (!template) throw new ZiteError('That email template no longer exists', 'BAD_REQUEST');
      }
      if (a.type === 'enrollSequence') {
        if (!a.sequenceId) throw new ZiteError('Choose the sequence to enroll them in', 'BAD_REQUEST');
        const sequence = await zite.sequences.findOne({ id: a.sequenceId });
        if (!sequence) throw new ZiteError('That sequence no longer exists', 'BAD_REQUEST');
      }
      if (a.type === 'setField') {
        if (!a.field) throw new ZiteError('Choose the field to set', 'BAD_REQUEST');
        if (a.field !== 'owner' && !a.value) throw new ZiteError('Choose the value to set', 'BAD_REQUEST');
      }
    }

    const record = {
      name: parsed.name,
      description: parsed.description || null,
      trigger: parsed.trigger,
      conditions: JSON.stringify(parsed.conditions),
      actions: JSON.stringify(parsed.actions),
      active: parsed.active ?? true,
    };

    if (parsed.automationId) {
      const existing = await zite.automations.findOne({ id: parsed.automationId });
      if (!existing) throw new ZiteError('That automation no longer exists', 'NOT_FOUND');
      await withRetry(() => zite.automations.update({ id: parsed.automationId as string, record }));
      await logEvent({
        kind: 'automation.updated',
        entity: { type: 'settings', id: parsed.automationId },
        actorId: actor.id,
        summary: existing.active !== record.active ? `${record.active ? 'switched on' : 'switched off'} the automation “${parsed.name}”` : `changed the automation “${parsed.name}”`,
      });
      return { automationId: parsed.automationId, created: false };
    }

    const created = await withRetry(() => zite.automations.create({ record: { ...record, ownerId: actor.id, runCount: 0, lastRunAt: null } }));
    await logEvent({ kind: 'automation.created', entity: { type: 'settings', id: created.id }, actorId: actor.id, summary: `created the automation “${parsed.name}”` });
    return { automationId: created.id, created: true };
  },
});
