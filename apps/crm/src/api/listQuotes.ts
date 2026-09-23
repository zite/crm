import { z } from 'zod';
import { createEndpoint } from 'zitejs/backend';
import { getActor } from '@project/shared/server/actor';
import { getSettings } from '@project/shared/server/settings';
import { todayIn } from '@project/shared/dates';
import { parseInput, today as todayInput } from '../server/input';
import { QUOTE_SORT_KEYS, queryQuotes, quoteFilterSchema, quoteRowSchema } from '../server/quotes';

const inputSchema = z.object({
  filters: quoteFilterSchema.default({}),
  sort: z.object({ key: z.enum(QUOTE_SORT_KEYS), dir: z.enum(['asc', 'desc']) }).optional(),
  limit: z.number().int().min(1).max(2000).optional(),
  today: todayInput,
});

/** The quotes ledger: every quote with where it stands today. */
export default createEndpoint({
  description: 'List quotes with filters and sorting',
  authenticated: true,
  inputSchema,
  outputSchema: z.object({ quotes: z.array(quoteRowSchema), truncated: z.boolean() }),
  execute: async ({ input, context }) => {
    const { filters, sort, limit = 500, today: t } = parseInput(inputSchema, input);
    await getActor(context);
    const settings = await getSettings();
    return queryQuotes(filters, sort, limit, t ?? todayIn(settings.timezone));
  },
});
