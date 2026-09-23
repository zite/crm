import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { getSettings } from '@project/shared/server/settings';
import { parseInput } from '../server/input';

/**
 * The unsubscribe page, as a stranger sees it. Public and unauthenticated, so
 * it returns the organization's branding and one fact — whether this link's
 * contact is currently unsubscribed. Never their name, address, owner or
 * anything else about them: the token is the only secret, and a leaked token
 * must not become a lookup tool.
 *
 * A token that doesn't exist and a token that isn't theirs get the same answer.
 */
const inputSchema = z.object({ token: z.string().min(16).max(64) });

export default createEndpoint({
  description: 'Branding and current email preference for an unsubscribe link',
  inputSchema,
  outputSchema: z.object({
    organizationName: z.string(),
    logoUrl: z.string().nullable(),
    brandColor: z.string(),
    mailingAddress: z.string(),
    unsubscribed: z.boolean(),
  }),
  execute: async ({ input }) => {
    const { token } = parseInput(inputSchema, input);
    const { rows } = await zite.sql({ query: `SELECT "unsubscribedAt" FROM "Contacts" WHERE "unsubscribeToken" = $1 LIMIT 1`, params: [token] });
    if (!rows[0]) throw new ZiteError('This link isn’t valid any more', 'NOT_FOUND');
    const settings = await getSettings();
    return {
      organizationName: settings.organizationName,
      logoUrl: settings.logoUrl,
      brandColor: settings.brandColor,
      mailingAddress: settings.mailingAddress,
      unsubscribed: Boolean(rows[0].unsubscribedAt),
    };
  },
});
