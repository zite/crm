import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { assertCan, getActor } from '@project/shared/server/actor';
import { logEvent } from '@project/shared/server/events';
import { str, withRetry } from '@project/shared/server/sql';
import { id, parseInput } from '../server/input';

const inputSchema = z.object({ ids: z.array(id).min(1, 'Choose a quote to void').max(100), reason: z.string().trim().max(240).optional() });

/**
 * Withdraw quotes. A voided quote keeps its number and its record of what was
 * offered; the buyer's link shows that it has been withdrawn. An accepted
 * quote is an answer already given, so it can't be voided.
 */
export default createEndpoint({
  description: 'Void one or more quotes so the buyer’s link shows them as withdrawn',
  authenticated: true,
  inputSchema,
  outputSchema: z.object({ voided: z.number(), failed: z.array(z.object({ id: z.string(), message: z.string() })) }),
  execute: async ({ input, context }) => {
    const { ids, reason } = parseInput(inputSchema, input);
    const actor = await getActor(context);
    assertCan(actor, 'quotes.manage');

    let voided = 0;
    const failed: Array<{ id: string; message: string }> = [];
    // Sequential: live Zite rate-limits a burst of parallel writes.
    for (const quoteId of ids) {
      const quote = await zite.quotes.findOne({ id: quoteId });
      if (!quote) {
        failed.push({ id: quoteId, message: 'That quote no longer exists' });
        continue;
      }
      const status = quote.status ?? 'Draft';
      if (status === 'Void') continue;
      if (status === 'Accepted') {
        failed.push({ id: quoteId, message: `${quote.number ?? 'That quote'} was accepted, so it can’t be voided` });
        continue;
      }
      await withRetry(() => zite.quotes.update({ id: quoteId, record: { status: 'Void' } as never }));
      await logEvent({
        kind: 'quote.voided',
        entity: { type: 'quote', id: quoteId },
        actorId: actor.id,
        summary: `voided quote ${str(quote.number) ?? ''}${reason ? ` — ${reason}` : ''}`.replace(/\s+/g, ' ').trim(),
        dealId: quote.dealId || null,
        companyId: quote.companyId || null,
        contactId: quote.contactId || null,
      });
      voided += 1;
    }
    if (!voided && failed.length === ids.length) throw new ZiteError(failed[0].message, 'CONFLICT');
    return { voided, failed };
  },
});
