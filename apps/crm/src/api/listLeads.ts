import { z } from 'zod';
import { createEndpoint } from 'zitejs/backend';
import { getActor } from '@project/shared/server/actor';
import { getSettings } from '@project/shared/server/settings';
import { parseInput } from '../server/input';
import { LEAD_SORT_KEYS, leadFilterSchema, leadRowSchema, queryLeads } from '../features/leads/leadQuery';

const inputSchema = z.object({
  filters: leadFilterSchema.default({}),
  sort: z.object({ key: z.enum(LEAD_SORT_KEYS), dir: z.enum(['asc', 'desc']) }).optional(),
  limit: z.number().int().min(1).max(2000).optional(),
});

export default createEndpoint({
  description: 'List leads with filters and sorting, including each lead’s next step and speed to first response',
  authenticated: true,
  inputSchema,
  outputSchema: z.object({ leads: z.array(leadRowSchema), truncated: z.boolean(), responseHours: z.number() }),
  execute: async ({ input, context }) => {
    const { filters, sort, limit = 1000 } = parseInput(inputSchema, input);
    await getActor(context);
    const settings = await getSettings();
    const responseHours = settings.preferences.leadResponseHours;
    const result = await queryLeads(filters, sort, limit, { responseHours });
    return { ...result, responseHours };
  },
});
