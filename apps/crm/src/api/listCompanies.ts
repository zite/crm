import { z } from 'zod';
import { createEndpoint } from 'zitejs/backend';
import { getActor } from '@project/shared/server/actor';
import { getSettings } from '@project/shared/server/settings';
import { todayIn } from '@project/shared/dates';
import { parseInput } from '../server/input';
import { COMPANY_SORT_KEYS, companyFilterSchema, companyRowSchema, queryCompanies } from '../server/companyQuery';

const inputSchema = z.object({
  filters: companyFilterSchema.default({}),
  sort: z.object({ key: z.enum(COMPANY_SORT_KEYS), dir: z.enum(['asc', 'desc']) }).optional(),
  limit: z.number().int().min(1).max(2000).optional(),
  today: z.string().optional(),
});

export default createEndpoint({
  description: 'List companies with filters and sorting, including contact, deal and pipeline counts',
  authenticated: true,
  inputSchema,
  outputSchema: z.object({ companies: z.array(companyRowSchema), truncated: z.boolean() }),
  execute: async ({ input, context }) => {
    const { filters, sort, limit = 1000, today: t } = parseInput(inputSchema, input);
    await getActor(context);
    const settings = await getSettings();
    const today = t && /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : todayIn(settings.timezone);
    return queryCompanies(filters, sort, limit, today);
  },
});
