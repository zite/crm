import Anthropic from '@anthropic-ai/sdk';

/**
 * Claude, used for three small jobs a rep would otherwise do by hand: reading
 * a deal's history back to them, drafting an email, and turning meeting notes
 * into next steps.
 *
 * Every feature ships a non-AI path. `isConfigured()` is false when the
 * workspace has no Anthropic connection, and each endpoint then returns a
 * written-by-rules version instead of failing — a template that breaks without
 * an integration looks broken to whoever installed it.
 *
 * The SDK's zod helper cannot be used here: it calls `z.toJSONSchema`, which is
 * zod v4 only, and endpoints are pinned to zod 3. Schemas are written by hand
 * and passed as `output_config.format` — that shape, with no `name` key, is the
 * entire accepted form.
 */

export const isConfigured = () => Boolean(process.env.ZITE_ANTHROPIC_ACCESS_TOKEN);

const MODEL = 'claude-opus-5';

type JsonSchema = Record<string, unknown>;

/**
 * Ask for a typed answer. Returns null when AI isn't configured, the model
 * declines, or anything goes wrong — callers fall back rather than throw.
 */
export async function askForJson<T>(input: { system: string; prompt: string; schema: JsonSchema; maxTokens?: number }): Promise<T | null> {
  if (!isConfigured()) return null;
  try {
    const client = new Anthropic({ apiKey: process.env.ZITE_ANTHROPIC_ACCESS_TOKEN });
    const response = await client.messages.parse({
      model: MODEL,
      max_tokens: input.maxTokens ?? 1200,
      system: input.system,
      messages: [{ role: 'user', content: input.prompt }],
      output_config: { effort: 'low', format: { type: 'json_schema', schema: input.schema } },
    } as never);
    const result = response as unknown as { stop_reason?: string; parsed_output?: T };
    if (result.stop_reason === 'refusal') return null;
    return result.parsed_output ?? null;
  } catch (error) {
    console.error('AI request failed', error instanceof Error ? error.message : error);
    return null;
  }
}

export const AI_VOICE =
  'You are helping a salesperson at a B2B software company. Write the way a good colleague talks: plain, specific, and short. No marketing language, no exclamation marks, no "I hope this email finds you well". Never invent facts — if the history does not say something, leave it out.';

/** Trim a record's history to something worth sending, newest first. */
export function historyLines(items: Array<{ occurredAt: string; kind: string; subject: string; body?: string | null; outcome?: string | null }>, limit = 18) {
  return items
    .slice(0, limit)
    .map(item => {
      const day = String(item.occurredAt).slice(0, 10);
      const body = (item.body ?? '').replace(/@\[([^\]]+)\]\(member:[^)]+\)/g, '@$1').replace(/\s+/g, ' ').trim().slice(0, 400);
      return `${day} · ${item.kind}${item.outcome ? ` (${item.outcome})` : ''}: ${item.subject}${body ? ` — ${body}` : ''}`;
    })
    .join('\n');
}
