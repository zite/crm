import { z } from 'zod';
import { ZiteError } from 'zitejs/backend';

/**
 * Zite does NOT enforce an endpoint's inputSchema before `execute` runs, so
 * every endpoint re-parses its input here and turns the first problem into a
 * sentence a person can read.
 */
export function parseInput<T extends z.ZodTypeAny>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input ?? {});
  if (result.success) return result.data;
  const issue = result.error.issues[0];
  const field = issue?.path?.length ? String(issue.path[issue.path.length - 1]) : '';
  const label = field.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  const msg = issue?.message && !/^(Required|Expected|Invalid)/.test(issue.message) ? issue.message : `Check the ${label || 'input'} and try again`;
  throw new ZiteError(msg, 'BAD_REQUEST');
}

export const id = z.string().min(1).max(64);
export const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a YYYY-MM-DD date');
export const isoDateTime = z.string().refine(v => !Number.isNaN(Date.parse(v)), 'Use a valid date and time');
export const money = z.number().finite().min(0, 'Amounts can’t be negative').max(1_000_000_000_000);
export const today = day.optional();
export const tagIds = z.array(id).max(50);
export const customValues = z.record(z.any());

/** The actor's local day, from the browser, else the org timezone's. */
export function localToday(input: { today?: string | null }, fallback: string) {
  return input.today && /^\d{4}-\d{2}-\d{2}$/.test(input.today) ? input.today : fallback;
}
