import { z } from 'zod';
import { createEndpoint } from 'zitejs/backend';
import { isDemo } from '@project/shared/server/demoPreview';
import { getSettings, updateSettings } from '@project/shared/server/settings';
import { parseInput } from '../server/input';

/**
 * The organization as a buyer sees it: name, logo, brand colour. Public, so it
 * returns nothing but branding.
 *
 * It also records this app's own URL the first time someone opens it, so the
 * CRM's emails can link to forms, quotes and meeting pages without anyone
 * pasting a URL into settings.
 */
const inputSchema = z.object({ pagesUrl: z.string().max(300).optional() });

export default createEndpoint({
  description: 'Branding for the public pages, and remember this app’s URL',
  inputSchema,
  outputSchema: z.object({
    organizationName: z.string(),
    logoUrl: z.string().nullable(),
    brandColor: z.string(),
    timezone: z.string(),
    currency: z.string(),
    mailingAddress: z.string(),
  }),
  execute: async ({ input }) => {
    const { pagesUrl } = parseInput(inputSchema, input);
    const settings = await getSettings();
    if (pagesUrl && !isDemo() && /^https?:\/\/[^\s]+$/i.test(pagesUrl) && pagesUrl.replace(/\/+$/, '') !== (settings.pagesUrl ?? '')) {
      await updateSettings(settings.id, { pagesUrl: pagesUrl.replace(/\/+$/, '') }).catch(() => undefined);
    }
    return {
      organizationName: settings.organizationName,
      logoUrl: settings.logoUrl,
      brandColor: settings.brandColor,
      timezone: settings.timezone,
      currency: settings.currency,
      mailingAddress: settings.mailingAddress,
    };
  },
});
