import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { assertCanManageAsset, getActor } from '@project/shared/server/actor';
import { num, withRetry } from '@project/shared/server/sql';
import { id, parseInput } from '../server/input';

/**
 * Delete a meeting link. The meetings people already booked through it stay on
 * their timelines — deleting the page only stops new bookings, and the endpoint
 * reports how many meetings are affected so the dialog can say so.
 *
 * A page with meetings still to come refuses unless the caller confirms, so
 * nobody quietly breaks the manage link in a buyer's inbox.
 */

const inputSchema = z.object({ id, confirmUpcoming: z.boolean().default(false) });

export default createEndpoint({
  description: 'Delete a meeting link (its past meetings stay on the timeline)',
  authenticated: true,
  inputSchema,
  outputSchema: z.object({ deleted: z.boolean(), keptBookings: z.number() }),
  execute: async ({ input, context }) => {
    const { id: pageId, confirmUpcoming } = parseInput(inputSchema, input);
    const actor = await getActor(context);
    const page = await zite.bookingPages.findOne({ id: pageId });
    if (!page) throw new ZiteError('That meeting link doesn’t exist or was deleted', 'NOT_FOUND');
    assertCanManageAsset(actor, page.ownerId || null, 'meeting link');

    const now = new Date().toISOString();
    const { rows } = await zite.sql({
      query: `SELECT COUNT(*) AS "bookingTotal", COUNT(*) FILTER (WHERE "occurredAt" >= $2 AND COALESCE("outcome", '') <> 'Canceled') AS "upcomingTotal"
        FROM "Activities" WHERE "bookingPageId" = $1`,
      params: [pageId, now],
    });
    const kept = num(rows[0]?.bookingTotal);
    const upcoming = num(rows[0]?.upcomingTotal);
    if (upcoming > 0 && !confirmUpcoming) {
      throw new ZiteError(`${upcoming === 1 ? 'One meeting is' : `${upcoming} meetings are`} still to come on this link. Confirm to delete it anyway.`, 'CONFLICT');
    }

    await withRetry(() => zite.bookingPages.delete({ id: pageId }));
    return { deleted: true, keptBookings: kept };
  },
});
