import { z } from 'zod';
import { createEndpoint } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { FORM_FIELD_TYPES, HONEYPOT_FIELD, toFormRecord } from '@project/shared/server/leads';
import { str } from '@project/shared/server/sql';
import { parseInput } from '../server/input';

/**
 * A web form as a visitor sees it. Public, so it returns only what has to be
 * rendered — never the routing, the notify list or the counters.
 *
 * A form that is paused or gone is not an error: it answers with `state` and
 * the page shows a calm notice instead of a stack trace.
 */
const inputSchema = z.object({ slug: z.string().trim().min(1).max(80) });

const fieldSchema = z.object({
  id: z.string(),
  key: z.string(),
  type: z.enum(FORM_FIELD_TYPES),
  label: z.string(),
  required: z.boolean(),
  placeholder: z.string().nullable(),
  help: z.string().nullable(),
  options: z.array(z.string()),
});

export default createEndpoint({
  description: 'Load a public web form by its slug',
  inputSchema,
  outputSchema: z.object({
    state: z.enum(['live', 'paused', 'missing']),
    honeypotField: z.string(),
    form: z
      .object({
        id: z.string(),
        name: z.string(),
        slug: z.string(),
        intro: z.string().nullable(),
        submitLabel: z.string(),
        fields: z.array(fieldSchema),
      })
      .nullable(),
  }),
  execute: async ({ input }) => {
    const { slug } = parseInput(inputSchema, input);
    const { rows } = await zite.sql({
      query: `SELECT * FROM "Forms" WHERE LOWER("slug") = $1 AND COALESCE("archived", false) = false LIMIT 1`,
      params: [slug.toLowerCase()],
    });
    const row = rows[0];
    if (!row) return { state: 'missing' as const, honeypotField: HONEYPOT_FIELD, form: null };
    const form = toFormRecord(row);
    if (form.status !== 'Live') return { state: 'paused' as const, honeypotField: HONEYPOT_FIELD, form: null };
    return {
      state: 'live' as const,
      honeypotField: HONEYPOT_FIELD,
      form: {
        id: form.id,
        name: form.name,
        slug: form.slug,
        intro: str(row.intro) || null,
        submitLabel: str(row.submitLabel) || 'Send',
        fields: form.fields,
      },
    };
  },
});
