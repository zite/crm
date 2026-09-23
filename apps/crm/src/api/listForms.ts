import { z } from 'zod';
import { createEndpoint } from 'zitejs/backend';
import { getActor } from '@project/shared/server/actor';
import { getSettings } from '@project/shared/server/settings';
import { parseInput } from '../server/input';
import { formRowSchema, queryForms } from '../features/forms/formQuery';

const inputSchema = z.object({ includeArchived: z.boolean().optional() });

export default createEndpoint({
  description: 'List web forms with their live status, submission counts and conversion',
  authenticated: true,
  inputSchema,
  outputSchema: z.object({ forms: z.array(formRowSchema), pagesUrl: z.string().nullable() }),
  execute: async ({ input, context }) => {
    const { includeArchived } = parseInput(inputSchema, input);
    await getActor(context);
    const [forms, settings] = await Promise.all([queryForms({ includeArchived }), getSettings()]);
    return { forms, pagesUrl: settings.pagesUrl };
  },
});
