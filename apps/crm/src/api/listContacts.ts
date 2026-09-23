import { z } from 'zod';
import { createEndpoint } from 'zitejs/backend';
import { getActor } from '@project/shared/server/actor';
import { getSettings } from '@project/shared/server/settings';
import { todayIn } from '@project/shared/dates';
import { parseInput } from '../server/input';
import { CONTACT_SORT_KEYS, contactFilterSchema, contactRowSchema, queryContacts } from '../server/contactQuery';

const inputSchema = z.object({
  filters: contactFilterSchema.default({}),
  sort: z.object({ key: z.enum(CONTACT_SORT_KEYS), dir: z.enum(['asc', 'desc']) }).optional(),
  limit: z.number().int().min(1).max(2000).optional(),
  today: z.string().optional(),
});

export default createEndpoint({
  description: 'List contacts with filters and sorting, including their company and open-deal counts',
  authenticated: true,
  inputSchema,
  outputSchema: z.object({ contacts: z.array(contactRowSchema), truncated: z.boolean() }),
  execute: async ({ input, context }) => {
    const { filters, sort, limit = 1000, today: t } = parseInput(inputSchema, input);
    await getActor(context);
    const settings = await getSettings();
    const today = t && /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : todayIn(settings.timezone);
    return queryContacts(filters, sort, limit, today);
  },
});
