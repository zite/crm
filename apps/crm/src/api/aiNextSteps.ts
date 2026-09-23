import { z } from 'zod';
import { createEndpoint } from 'zitejs/backend';
import { getActor } from '@project/shared/server/actor';
import { AI_VOICE, askForJson } from '../server/ai';
import { id, parseInput } from '../server/input';

/**
 * Turn the notes someone just typed after a call into next steps they can
 * accept with one click. Nothing is written here — the composer creates the
 * tasks the rep keeps.
 *
 * Without an Anthropic connection it falls back to reading the obvious action
 * lines out of the notes (bullets, "I'll …", "send …", "follow up …").
 */
const inputSchema = z.object({ text: z.string().trim().min(10, 'Write a little more first').max(8000), dealId: id.nullable().optional() });

const schema = {
  type: 'object',
  properties: {
    tasks: {
      type: 'array',
      maxItems: 5,
      items: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'An action starting with a verb, under 60 characters.' },
          dueInDays: { type: 'integer', description: 'Days from today, 0 for today.' },
        },
        required: ['title', 'dueInDays'],
        additionalProperties: false,
      },
    },
  },
  required: ['tasks'],
  additionalProperties: false,
};

const VERBS = /^(?:[-*]\s*)?(?:i'?ll\s+|we'?ll\s+|need to\s+|todo:?\s*|action:?\s*)?(send|share|book|schedule|call|email|follow up|check|confirm|draft|prepare|introduce|loop|set up|ask|chase|review)\b/i;

export default createEndpoint({
  description: 'Suggest follow-up tasks from meeting or call notes',
  authenticated: true,
  inputSchema,
  outputSchema: z.object({ tasks: z.array(z.object({ title: z.string(), dueInDays: z.number() })), aiGenerated: z.boolean() }),
  execute: async ({ input, context }) => {
    const { text } = parseInput(inputSchema, input);
    await getActor(context);

    const ai = await askForJson<{ tasks: Array<{ title: string; dueInDays: number }> }>({
      system: `${AI_VOICE} Pull out only actions the rep committed to or clearly owes. If there are none, return an empty list rather than inventing one.`,
      prompt: `Notes from a call or meeting:\n\n${text}`,
      schema,
      maxTokens: 600,
    });
    if (ai) return { tasks: ai.tasks.slice(0, 5).map(t => ({ title: t.title.slice(0, 200), dueInDays: Math.max(0, Math.min(90, Math.round(t.dueInDays))) })), aiGenerated: true };

    const tasks = text
      .split(/\n|(?<=\.)\s+/)
      .map(line => line.trim())
      .filter(line => VERBS.test(line))
      .slice(0, 5)
      .map(line => ({ title: line.replace(/^[-*]\s*/, '').replace(/^(i'?ll|we'?ll|need to|todo:?|action:?)\s*/i, '').replace(/\.$/, '').slice(0, 120), dueInDays: 2 }));
    return { tasks, aiGenerated: false };
  },
});
