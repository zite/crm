import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { assertCan, getActor, memberById } from '@project/shared/server/actor';
import { mergeContext } from '@project/shared/server/email';
import { getSettings } from '@project/shared/server/settings';
import { iso, str } from '@project/shared/server/sql';
import { AI_VOICE, askForJson, historyLines } from '../server/ai';
import { id, parseInput } from '../server/input';

/**
 * Draft an email from what the record already knows. The draft is never sent:
 * it lands in the composer for the rep to edit.
 *
 * Without an Anthropic connection it returns a short, honest starter draft
 * built from the same context, so the button still does something useful.
 */
const INTENTS = ['follow_up', 'recap', 'pricing', 'check_in', 'intro', 'custom'] as const;

const inputSchema = z.object({
  intent: z.enum(INTENTS),
  dealId: id.nullable().optional(),
  contactId: id.nullable().optional(),
  leadId: id.nullable().optional(),
  instructions: z.string().max(600).optional(),
});

const schema = {
  type: 'object',
  properties: {
    subject: { type: 'string', description: 'A specific subject line, under 60 characters, no colons-as-branding.' },
    body: { type: 'string', description: 'The email body. Short paragraphs, one clear ask at the end, signed with the sender first name.' },
  },
  required: ['subject', 'body'],
  additionalProperties: false,
};

const FALLBACKS: Record<(typeof INTENTS)[number], (ctx: { first: string; company: string; sender: string; deal: string }) => { subject: string; body: string }> = {
  follow_up: c => ({ subject: `Following up${c.company ? ` on ${c.company}` : ''}`, body: `Hi ${c.first},\n\nThanks for the time this week. I wanted to follow up with the next step we talked about.\n\nIs there anything you need from me before then?\n\n${c.sender}` }),
  recap: c => ({ subject: 'Notes from our call', body: `Hi ${c.first},\n\nA quick recap of what we covered, so we have it in writing:\n\n- \n- \n\nI'll pick up the next step from here.\n\n${c.sender}` }),
  pricing: c => ({ subject: 'Pricing, as promised', body: `Hi ${c.first},\n\nHere's the pricing we discussed${c.deal ? ` for ${c.deal}` : ''}. I've kept it to the scope we agreed.\n\nHappy to walk through it with whoever else needs to see it.\n\n${c.sender}` }),
  check_in: c => ({ subject: 'Quick check-in', body: `Hi ${c.first},\n\nChecking in — I know things get busy. Is this still worth pursuing on your side this quarter?\n\nIf the timing has moved, tell me when to come back.\n\n${c.sender}` }),
  intro: c => ({ subject: `${c.company || 'Quick intro'}`, body: `Hi ${c.first},\n\nI work with operations teams that are running warehouses on spreadsheets and handovers on whiteboards.\n\nWorth a short call to see whether that's your situation too?\n\n${c.sender}` }),
  custom: c => ({ subject: 'Quick note', body: `Hi ${c.first},\n\n\n\n${c.sender}` }),
};

export default createEndpoint({
  description: 'Draft an email for a contact, lead or deal — the rep edits and sends it',
  authenticated: true,
  inputSchema,
  outputSchema: z.object({ subject: z.string(), body: z.string(), aiGenerated: z.boolean() }),
  execute: async ({ input, context }) => {
    const data = parseInput(inputSchema, input);
    const actor = await getActor(context);
    assertCan(actor, 'outreach.send');
    if (!data.dealId && !data.contactId && !data.leadId) throw new ZiteError('Pick who this email is for', 'BAD_REQUEST');
    const settings = await getSettings();
    const sender = await memberById(actor.id);
    const ctx = await mergeContext({ settings, sender, contactId: data.contactId ?? null, dealId: data.dealId ?? null });

    let first = String(ctx['contact.first_name'] ?? '');
    let company = String(ctx['company.name'] ?? '');
    if (data.leadId) {
      const lead = await zite.leads.findOne({ id: data.leadId });
      first = first || (lead?.firstName ?? '');
      company = company || (lead?.companyName ?? '');
    }
    const fallbackContext = { first: first || 'there', company, sender: sender?.name.split(' ')[0] ?? actor.name.split(' ')[0], deal: String(ctx['deal.name'] ?? '') };

    const { rows: activities } = data.dealId || data.contactId || data.leadId
      ? await zite.sql({
          query: `SELECT "kind", "subject", "body", "outcome", COALESCE("occurredAt", created_at) AS "occurredAt" FROM "Activities"
            WHERE ${data.dealId ? '"dealId"' : data.contactId ? '"contactId"' : '"leadId"'} = $1
            ORDER BY COALESCE("occurredAt", created_at) DESC LIMIT 12`,
          params: [data.dealId ?? data.contactId ?? data.leadId],
        })
      : { rows: [] };

    const intentLine = {
      follow_up: 'Follow up on the last conversation and ask for the next step.',
      recap: 'Recap the last meeting in writing, with what each side agreed to do.',
      pricing: 'Send pricing for what was discussed and offer to walk anyone else through it.',
      check_in: 'Check in on a deal that has gone quiet, and make it easy to say the timing has moved.',
      intro: 'A first email to someone we have not spoken to. One sentence on the problem we solve, and a small ask.',
      custom: data.instructions ?? 'Write a short, useful email.',
    }[data.intent];

    const ai = await askForJson<{ subject: string; body: string }>({
      system: `${AI_VOICE} You are drafting an email the rep will edit before sending. Sign off with the sender's first name only. Never promise anything the history does not support.`,
      prompt: [
        `Sender: ${sender?.name ?? actor.name}${sender?.title ? `, ${sender.title}` : ''} at ${settings.organizationName}`,
        `Recipient: ${first || 'unknown'}${ctx['contact.title'] ? `, ${ctx['contact.title']}` : ''}${company ? ` at ${company}` : ''}`,
        ctx['deal.name'] ? `Deal: ${ctx['deal.name']} (${ctx['deal.amount'] ?? 'no amount'}, closing ${ctx['deal.close_date'] ?? 'unknown'})` : '',
        `What this email should do: ${intentLine}`,
        data.instructions ? `Extra instructions from the rep: ${data.instructions}` : '',
        '',
        'Recent history (newest first):',
        historyLines(activities as never, 12) || 'Nothing logged yet.',
      ]
        .filter(Boolean)
        .join('\n'),
      schema,
      maxTokens: 900,
    });

    if (ai) return { subject: ai.subject.slice(0, 200), body: ai.body, aiGenerated: true };
    const fallback = FALLBACKS[data.intent](fallbackContext);
    return { ...fallback, aiGenerated: false };
  },
});
