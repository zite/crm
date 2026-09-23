import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { logEvent } from '@project/shared/server/events';
import { exitEnrollments } from '@project/shared/server/sequences';
import { str, withRetry } from '@project/shared/server/sql';
import { parseInput } from '../server/input';

/**
 * Change a contact's email preference from the link in an email's footer.
 * Public and unauthenticated: the token is the only credential, a missing and
 * a wrong token get the same answer, and a bot filling the hidden field is
 * refused.
 *
 * Unsubscribing also ends every sequence the contact is on, so the next
 * scheduled run can't send them anything, and writes a history line so the rep
 * can see what happened and when.
 */
const inputSchema = z.object({
  token: z.string().min(16).max(64),
  unsubscribed: z.boolean(),
  /** Honeypot: a person never sees this field, so anything in it is a bot. */
  website: z.string().max(200).optional(),
});

export default createEndpoint({
  description: 'Unsubscribe or resubscribe the contact behind an unsubscribe link',
  inputSchema,
  outputSchema: z.object({ unsubscribed: z.boolean() }),
  execute: async ({ input }) => {
    const data = parseInput(inputSchema, input);
    if (data.website?.trim()) throw new ZiteError('This link isn’t valid any more', 'NOT_FOUND');

    const { rows } = await zite.sql({ query: `SELECT id, "name", "unsubscribedAt" FROM "Contacts" WHERE "unsubscribeToken" = $1 LIMIT 1`, params: [data.token] });
    const row = rows[0];
    if (!row) throw new ZiteError('This link isn’t valid any more', 'NOT_FOUND');

    const contactId = String(row.id);
    const already = Boolean(row.unsubscribedAt);
    if (already === data.unsubscribed) return { unsubscribed: already };

    const at = new Date().toISOString();
    await withRetry(() => zite.contacts.update({ id: contactId, record: { unsubscribedAt: data.unsubscribed ? at : null } }));
    if (data.unsubscribed) await exitEnrollments({ contactId, reason: 'Unsubscribed' });

    await logEvent({
      kind: data.unsubscribed ? 'contact.unsubscribed' : 'contact.resubscribed',
      entity: { type: 'contact', id: contactId },
      actorId: null,
      summary: data.unsubscribed ? `${str(row.name) || 'This contact'} unsubscribed from email` : `${str(row.name) || 'This contact'} opted back in to email`,
      contactId,
      occurredAt: at,
    });

    return { unsubscribed: data.unsubscribed };
  },
});
