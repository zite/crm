import { z } from 'zod';
import { createEndpoint } from 'zitejs/backend';
import { getActor } from '@project/shared/server/actor';
import { getSettings } from '@project/shared/server/settings';
import { todayIn } from '@project/shared/dates';
import { parseInput } from '../server/input';
import { dealFilterSchema, dealRowSchema } from '../server/schemas';
import { DEAL_SORT_KEYS, queryDeals } from '../server/dealQuery';

const inputSchema = z.object({
  filters: dealFilterSchema.default({}),
  sort: z.object({ key: z.enum(DEAL_SORT_KEYS), dir: z.enum(['asc', 'desc']) }).optional(),
  limit: z.number().int().min(1).max(2000).optional(),
  today: z.string().optional(),
});

export default createEndpoint({
  description: 'List deals with filters and sorting, including each deal’s next step',
  authenticated: true,
  inputSchema,
  outputSchema: z.object({ deals: z.array(dealRowSchema), truncated: z.boolean() }),
  execute: async ({ input, context }) => {
    const { filters, sort, limit = 1000, today: t } = parseInput(inputSchema, input);
    await getActor(context);
    const settings = await getSettings();
    const today = t && /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : todayIn(settings.timezone);
    return queryDeals(filters, sort, limit, today);
  },
});
