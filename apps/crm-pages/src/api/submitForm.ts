import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { recordSpam, submitFormEntry, toFormRecord, validateAnswers } from '@project/shared/server/leads';
import { getSettings } from '@project/shared/server/settings';
import { str } from '@project/shared/server/sql';
import { parseInput } from '../server/input';

/**
 * A web form submission. Unauthenticated and it writes, so everything it is
 * given is treated as hostile:
 *
 *   - the input is re-parsed here, not trusted from the client;
 *   - a hidden honeypot field must be empty, and a filled one is filed as spam
 *     and answered exactly like a success, so a bot learns nothing;
 *   - every value is size-capped before it reaches the database;
 *   - the same address submitting the same form twice inside ten minutes gets
 *     the first result back instead of a second lead.
 *
 * It never returns anything internal: no owner, no score, no lead id.
 */
const answerValue = z.union([z.string().max(5000), z.number().finite(), z.boolean()]);

const inputSchema = z.object({
  slug: z.string().trim().min(1).max(80),
  answers: z.record(answerValue),
  /** The hidden field. Anything in it and a person didn't type it. */
  honeypot: z.string().max(200).optional(),
  utm: z.object({ source: z.string().max(120).optional(), medium: z.string().max(120).optional(), campaign: z.string().max(120).optional() }).optional(),
  pageUrl: z.string().max(500).optional(),
  referrer: z.string().max(500).optional(),
});

export default createEndpoint({
  description: 'Submit a public web form: creates or updates a lead, or logs a note on an existing contact',
  inputSchema,
  outputSchema: z.object({
    ok: z.boolean(),
    successMessage: z.string(),
    redirectUrl: z.string().nullable(),
    /** Set only when a field is wrong, so the page can point at it. */
    fieldError: z.object({ key: z.string(), message: z.string() }).nullable(),
  }),
  execute: async ({ input }) => {
    const data = parseInput(inputSchema, input);
    if (Object.keys(data.answers).length > 40) throw new ZiteError('That’s more than this form asks for', 'BAD_REQUEST');

    const { rows } = await zite.sql({
      query: `SELECT * FROM "Forms" WHERE LOWER("slug") = $1 AND COALESCE("archived", false) = false LIMIT 1`,
      params: [data.slug.toLowerCase()],
    });
    const row = rows[0];
    if (!row) throw new ZiteError('This form isn’t taking submissions', 'NOT_FOUND');
    const form = toFormRecord(row);
    if (form.status !== 'Live') throw new ZiteError('This form isn’t taking submissions right now', 'NOT_FOUND');

    const successMessage = str(row.successMessage) || 'Thanks — we’ve got it.';
    const redirectUrl = str(row.redirectUrl) || null;

    // A robot filled the hidden field. Record it, answer like a success, move on.
    if (data.honeypot && data.honeypot.trim()) {
      await recordSpam(form, String(data.answers.email ?? ''), data.pageUrl ?? null);
      return { ok: true, successMessage, redirectUrl, fieldError: null };
    }

    const checked = validateAnswers(form.fields, data.answers);
    if ('error' in checked) return { ok: false, successMessage, redirectUrl, fieldError: checked.error };

    const settings = await getSettings();
    await submitFormEntry({
      form,
      answers: checked.answers,
      utm: { source: data.utm?.source ?? null, medium: data.utm?.medium ?? null, campaign: data.utm?.campaign ?? null },
      pageUrl: data.pageUrl ?? null,
      referrer: data.referrer ?? null,
      settings,
    });
    return { ok: true, successMessage, redirectUrl, fieldError: null };
  },
});
