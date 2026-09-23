import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { assertCan, getActor } from '@project/shared/server/actor';
import { enrollContacts } from '@project/shared/server/sequences';
import { str } from '@project/shared/server/sql';
import { id, parseInput } from '../server/input';

/**
 * Put contacts on a sequence. Anyone who can't go on comes back with the
 * reason, so the dialog can say exactly who was left out and why rather than
 * quietly enrolling fewer people than you picked.
 */
const inputSchema = z.object({
  sequenceId: id,
  contactIds: z.array(id).min(1, 'Choose at least one contact').max(200),
  dealId: id.nullable().optional(),
  ownerId: id.nullable().optional(),
  /** Enroll demo addresses too. Their emails are recorded and never delivered. */
  includeUndeliverable: z.boolean().optional(),
});

export default createEndpoint({
  description: 'Enroll one or more contacts in a sequence',
  authenticated: true,
  inputSchema,
  outputSchema: z.object({
    enrolled: z.number(),
    sequenceName: z.string(),
    skipped: z.array(z.object({ contactId: z.string(), reason: z.string(), code: z.string() })),
  }),
  execute: async ({ input, context }) => {
    const data = parseInput(inputSchema, input);
    const actor = await getActor(context);
    assertCan(actor, 'outreach.send');

    const sequence = await zite.sequences.findOne({ id: data.sequenceId });
    if (!sequence) throw new ZiteError('That sequence no longer exists', 'NOT_FOUND');
    if (sequence.status === 'Archived') throw new ZiteError('That sequence is archived — restore it before enrolling anyone', 'CONFLICT');

    const result = await enrollContacts({
      actor,
      sequenceId: data.sequenceId,
      contactIds: data.contactIds,
      ownerId: data.ownerId ?? null,
      dealId: data.dealId ?? null,
      includeUndeliverable: data.includeUndeliverable,
    });
    return { enrolled: result.enrolled, sequenceName: str(sequence.name) ?? '', skipped: result.skipped };
  },
});
