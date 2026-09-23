import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { assertCan, assertCanManageAsset, assertMember, getActor } from '@project/shared/server/actor';
import { logEvent } from '@project/shared/server/events';
import { SEQUENCE_STATUSES } from '@project/shared/constants';
import { parseSequenceSettings, parseSteps, STEP_KINDS } from '@project/shared/server/sequencesEngine';
import { ref, withRetry } from '@project/shared/server/sql';
import { id, parseInput } from '../server/input';

/**
 * Create or change a sequence. The steps column is a JSON array; it is parsed
 * and repaired by the engine before it is stored, so a malformed step can
 * never reach the sender.
 */
const stepSchema = z.object({
  id: z.string().max(40).optional(),
  kind: z.enum(STEP_KINDS),
  delayDays: z.number().int().min(0).max(120).default(0),
  subject: z.string().max(200).default(''),
  body: z.string().max(20_000).default(''),
  note: z.string().max(2000).default(''),
});

const settingsSchema = z.object({
  weekdaysOnly: z.boolean(),
  sendWindow: z.object({ start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a time like 08:00'), end: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a time like 17:00') }),
  exitOnReply: z.boolean(),
  exitOnMeeting: z.boolean(),
  exitOnDeal: z.boolean(),
});

const inputSchema = z.object({
  id: id.optional(),
  name: z.string().trim().min(1, 'Give the sequence a name').max(120),
  description: z.string().max(2000).default(''),
  status: z.enum(SEQUENCE_STATUSES).optional(),
  shared: z.boolean().optional(),
  ownerId: id.nullable().optional(),
  steps: z.array(stepSchema).max(40).optional(),
  settings: settingsSchema.optional(),
});

export default createEndpoint({
  description: 'Create or update a sequence: its steps, schedule rules and status',
  authenticated: true,
  inputSchema,
  outputSchema: z.object({ id: z.string(), created: z.boolean() }),
  execute: async ({ input, context }) => {
    const data = parseInput(inputSchema, input);
    const actor = await getActor(context);
    assertCan(actor, 'outreach.send');

    // Round-trip through the engine's parser so what is stored is exactly what
    // the sender will read back: ids filled in, day 0 forced on the first step.
    const steps = data.steps ? parseSteps(data.steps.map((s, i) => ({ ...s, id: s.id || `s${i + 1}` }))) : undefined;
    const settings = data.settings ? parseSequenceSettings(data.settings) : undefined;
    const ownerId = data.ownerId === undefined ? undefined : data.ownerId === null ? null : await assertMember(data.ownerId, 'owner');

    const fields = {
      name: data.name,
      description: data.description,
      ...(data.status ? { status: data.status } : {}),
      ...(data.shared === undefined ? {} : { shared: data.shared }),
      ...(steps ? { steps: JSON.stringify(steps) } : {}),
      ...(settings ? { settings: JSON.stringify(settings) } : {}),
      ...(ownerId === undefined ? {} : { ownerId }),
    };

    if (data.id) {
      const existing = await zite.sequences.findOne({ id: data.id });
      if (!existing) throw new ZiteError('That sequence no longer exists', 'NOT_FOUND');
      assertCanManageAsset(actor, ref(existing.ownerId), 'sequence');
      await withRetry(() => zite.sequences.update({ id: data.id as string, record: fields }));
      const changedStatus = data.status && data.status !== existing.status;
      await logEvent({
        kind: changedStatus ? 'sequence.status_changed' : 'sequence.updated',
        entity: { type: 'sequence', id: data.id },
        actorId: actor.id,
        summary: changedStatus ? `set “${data.name}” to ${String(data.status).toLowerCase()}` : `updated the sequence “${data.name}”`,
      });
      return { id: data.id, created: false };
    }

    const created = await withRetry(() =>
      zite.sequences.create({
        record: {
          ...fields,
          status: data.status ?? 'Paused',
          shared: data.shared ?? true,
          ownerId: ownerId ?? actor.id,
          steps: JSON.stringify(steps ?? []),
          settings: JSON.stringify(settings ?? parseSequenceSettings(null)),
        },
      }),
    );
    await logEvent({ kind: 'sequence.created', entity: { type: 'sequence', id: created.id }, actorId: actor.id, summary: `created the sequence “${data.name}”` });
    return { id: created.id, created: true };
  },
});
