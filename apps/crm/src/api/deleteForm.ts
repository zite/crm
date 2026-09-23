import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { assertCanManageAsset, getActor } from '@project/shared/server/actor';
import { logEvent } from '@project/shared/server/events';
import { ref, str, withRetry } from '@project/shared/server/sql';
import { id, parseInput } from '../server/input';

const inputSchema = z.object({ id });

/**
 * Deleting a form removes its submission records. The leads and contacts those
 * submissions made stay exactly where they are — they simply stop naming a form
 * that no longer exists.
 */
export default createEndpoint({
  description: 'Delete a web form and its submission records, keeping the leads it produced',
  authenticated: true,
  inputSchema,
  outputSchema: z.object({ deleted: z.number(), submissions: z.number() }),
  execute: async ({ input, context }) => {
    const { id: formId } = parseInput(inputSchema, input);
    const actor = await getActor(context);
    const form = await zite.forms.findOne({ id: formId });
    if (!form) throw new ZiteError('That form no longer exists', 'NOT_FOUND');
    assertCanManageAsset(actor, ref(form.ownerId), 'form');

    const { rows: submissions } = await zite.sql({ query: `SELECT id FROM "Submissions" WHERE "formId" = $1`, params: [formId] });
    for (const s of submissions) await withRetry(() => zite.submissions.delete({ id: String(s.id) }));
    const { rows: leads } = await zite.sql({ query: `SELECT id FROM "Leads" WHERE "formId" = $1`, params: [formId] });
    for (const l of leads) await withRetry(() => zite.leads.update({ id: String(l.id), record: { formId: null } }));

    await withRetry(() => zite.forms.delete({ id: formId }));
    await logEvent({ kind: 'form.deleted', entity: { type: 'form', id: formId }, actorId: actor.id, summary: `deleted the form “${str(form.name) ?? ''}”` });
    return { deleted: 1, submissions: submissions.length };
  },
});
