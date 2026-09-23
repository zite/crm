import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { getActor } from '@project/shared/server/actor';
import { getSettings } from '@project/shared/server/settings';
import { iso, str } from '@project/shared/server/sql';
import { id, parseInput } from '../server/input';
import { formRowSchema, queryForms } from '../features/forms/formQuery';

const inputSchema = z.object({ id });

export default createEndpoint({
  description: 'Load one web form with its fields, counters and the sequences it can enroll into',
  authenticated: true,
  inputSchema,
  outputSchema: z.object({
    form: formRowSchema,
    pagesUrl: z.string().nullable(),
    sequences: z.array(z.object({ id: z.string(), name: z.string(), status: z.string() })),
    recent: z.array(z.object({ id: z.string(), name: z.string().nullable(), email: z.string().nullable(), outcome: z.string(), submittedAt: z.string().nullable() })),
  }),
  execute: async ({ input, context }) => {
    const { id: formId } = parseInput(inputSchema, input);
    await getActor(context);
    const [forms, settings, sequences, recent] = await Promise.all([
      queryForms({ id: formId, includeArchived: true }),
      getSettings(),
      zite.sql({ query: `SELECT id, "name", "status" FROM "Sequences" WHERE COALESCE("status", '') <> 'Archived' ORDER BY LOWER("name") LIMIT 100`, params: [] }),
      zite.sql({ query: `SELECT id, "name", "email", "outcome", "submittedAt" FROM "Submissions" WHERE "formId" = $1 ORDER BY "submittedAt" DESC LIMIT 5`, params: [formId] }),
    ]);
    const form = forms[0];
    if (!form) throw new ZiteError('That form doesn’t exist or was deleted', 'NOT_FOUND');
    return {
      form,
      pagesUrl: settings.pagesUrl,
      sequences: sequences.rows.map(r => ({ id: String(r.id), name: str(r.name) ?? '', status: str(r.status) || 'Active' })),
      recent: recent.rows.map(r => ({ id: String(r.id), name: str(r.name) || null, email: str(r.email) || null, outcome: str(r.outcome) || 'New Lead', submittedAt: iso(r.submittedAt) })),
    };
  },
});
