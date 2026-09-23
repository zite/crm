import { z } from 'zod';
import { createEndpoint } from 'zitejs/backend';
import { getActor } from '@project/shared/server/actor';
import { searchRecords } from '@project/shared/server/search';
import { parseInput } from '../server/input';

const inputSchema = z.object({
  query: z.string().max(120),
  kinds: z.array(z.enum(['company', 'contact', 'deal', 'lead'])).optional(),
  limit: z.number().int().min(1).max(25).optional(),
});

export default createEndpoint({
  description: 'Search companies, contacts, deals and leads by name, email or domain',
  authenticated: true,
  inputSchema,
  outputSchema: z.object({ hits: z.array(z.object({ kind: z.string(), id: z.string(), title: z.string(), subtitle: z.string().nullable(), ownerId: z.string().nullable(), companyId: z.string().nullable() })) }),
  execute: async ({ input, context }) => {
    const { query, kinds, limit } = parseInput(inputSchema, input);
    await getActor(context);
    return { hits: await searchRecords(query, kinds ?? ['company', 'contact', 'deal', 'lead'], limit ?? 8) };
  },
});
