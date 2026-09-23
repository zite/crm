import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { getActor } from '@project/shared/server/actor';
import { getSettings } from '@project/shared/server/settings';
import { daysSince, todayIn } from '@project/shared/dates';
import { formatMoney } from '@project/shared/money';
import { day, iso, num, str } from '@project/shared/server/sql';
import { stalledBy } from '@project/shared/deals';
import { loadPipelines } from '@project/shared/server/deals';
import { AI_VOICE, askForJson, historyLines, isConfigured } from '../server/ai';
import { id, parseInput } from '../server/input';

/**
 * "Where does this deal stand?" — the answer a manager asks for in a pipeline
 * review, written from the deal's own history.
 *
 * Without an Anthropic connection it still answers, from the facts: stage,
 * time in stage, last contact, open tasks, who is involved and what is missing.
 */
const inputSchema = z.object({ id, today: z.string().optional() });

const schema = {
  type: 'object',
  properties: {
    summary: { type: 'string', description: 'Two or three sentences on where the deal stands. Under 90 words.' },
    risks: { type: 'array', items: { type: 'string' }, maxItems: 3, description: 'At most three specific risks, each one short sentence.' },
    nextSteps: { type: 'array', items: { type: 'string' }, maxItems: 3, description: 'At most three concrete next actions, each phrased as a task title.' },
  },
  required: ['summary', 'risks', 'nextSteps'],
  additionalProperties: false,
};

export default createEndpoint({
  description: 'Summarise where a deal stands, with risks and suggested next steps',
  authenticated: true,
  inputSchema,
  outputSchema: z.object({ summary: z.string(), risks: z.array(z.string()), nextSteps: z.array(z.string()), aiGenerated: z.boolean() }),
  execute: async ({ input, context }) => {
    const data = parseInput(inputSchema, input);
    await getActor(context);
    const settings = await getSettings();
    const today = data.today && /^\d{4}-\d{2}-\d{2}$/.test(data.today) ? data.today : todayIn(settings.timezone);

    const { rows } = await zite.sql({
      query: `SELECT d.*, co."name" AS "companyName", co."industry", co."employees", ct."name" AS "contactName", m."name" AS "ownerName"
        FROM "Deals" d
        LEFT JOIN "Companies" co ON co.id::text = d."companyId"
        LEFT JOIN "Contacts" ct ON ct.id::text = d."contactId"
        LEFT JOIN "Members" m ON m.id::text = d."ownerId"
        WHERE d.id::text = $1`,
      params: [data.id],
    });
    const deal = rows[0];
    if (!deal) throw new ZiteError('That deal no longer exists', 'NOT_FOUND');

    const [{ rows: activities }, { rows: tasks }, { rows: people }, pipelines] = await Promise.all([
      zite.sql({
        query: `SELECT "kind", "subject", "body", "outcome", COALESCE("occurredAt", created_at) AS "occurredAt" FROM "Activities" WHERE "dealId" = $1 ORDER BY COALESCE("occurredAt", created_at) DESC LIMIT 20`,
        params: [data.id],
      }),
      zite.sql({ query: `SELECT "title", "dueDate", "status" FROM "Tasks" WHERE "dealId" = $1 AND "status" = 'Open' ORDER BY "dueDate" ASC NULLS LAST LIMIT 10`, params: [data.id] }),
      zite.sql({ query: `SELECT c."name", c."title", dc."role" FROM "DealContacts" dc JOIN "Contacts" c ON c.id::text = dc."contactId" WHERE dc."dealId" = $1`, params: [data.id] }),
      loadPipelines(),
    ]);

    const stage = pipelines.stages.find(s => s.id === str(deal.stageId));
    const stageDays = daysSince(iso(deal.stageEnteredAt), today) ?? 0;
    const stalled = stalledBy((str(deal.status) || 'Open') as 'Open', iso(deal.stageEnteredAt), stage ? { rottingDays: stage.rottingDays } : null, today);
    const lastActivityDays = daysSince(iso(deal.lastActivityAt), today);
    const amount = formatMoney(num(deal.amount), settings.currency, { cents: false });

    const facts = [
      `Deal: ${str(deal.name)}`,
      `Company: ${str(deal.companyName) ?? 'none'}${deal.industry ? ` (${str(deal.industry)}, ${num(deal.employees)} employees)` : ''}`,
      `Amount: ${amount}. Stage: ${stage?.name ?? 'unknown'} for ${stageDays} days${stalled ? ` (${stalled} days past this stage's limit)` : ''}.`,
      `Close date: ${day(deal.closeDate) ?? 'not set'}. Owner: ${str(deal.ownerName) ?? 'unassigned'}. Status: ${str(deal.status)}.`,
      `Buying group: ${people.length ? people.map(p => `${str(p.name)}${p.title ? ` (${str(p.title)})` : ''}${p.role ? ` — ${str(p.role)}` : ''}`).join('; ') : 'nobody linked'}`,
      `Open tasks: ${tasks.length ? tasks.map(t => `${str(t.title)}${t.dueDate ? ` due ${day(t.dueDate)}` : ''}`).join('; ') : 'none'}`,
      `Last activity: ${lastActivityDays == null ? 'never' : `${lastActivityDays} days ago`}`,
    ].join('\n');

    const ai = await askForJson<{ summary: string; risks: string[]; nextSteps: string[] }>({
      system: `${AI_VOICE} You are briefing the deal's owner before a pipeline review. Base every sentence on the history you are given.`,
      prompt: `Here is a deal and its recent history. Write a brief.\n\n${facts}\n\nRecent activity (newest first):\n${historyLines(activities as never) || 'Nothing logged yet.'}`,
      schema,
    });
    if (ai) return { summary: ai.summary, risks: ai.risks.slice(0, 3), nextSteps: ai.nextSteps.slice(0, 3), aiGenerated: true };

    // Written from the facts when there is no AI connection.
    const risks: string[] = [];
    if (stalled > 0) risks.push(`It has sat in ${stage?.name ?? 'this stage'} for ${stageDays} days — ${stalled} past the limit.`);
    if (lastActivityDays != null && lastActivityDays > 14) risks.push(`Nobody has touched it in ${lastActivityDays} days.`);
    if (!tasks.length) risks.push('There is no next step scheduled.');
    if (!people.length) risks.push('No contacts are linked, so there is no named champion.');
    if (day(deal.closeDate) && (day(deal.closeDate) as string) < today && str(deal.status) === 'Open') risks.push('The close date has already passed.');

    const nextSteps: string[] = [];
    if (!tasks.length) nextSteps.push(`Book the next conversation with ${str(deal.contactName) ?? 'the buyer'}`);
    if (!people.length) nextSteps.push('Add the people involved to the buying group');
    if (day(deal.closeDate) && (day(deal.closeDate) as string) < today) nextSteps.push('Agree a realistic close date');
    if (!nextSteps.length && tasks[0]) nextSteps.push(String(tasks[0].title));

    const summary = [
      `${str(deal.name)} is ${amount} in ${stage?.name ?? 'an unknown stage'}, owned by ${str(deal.ownerName) ?? 'nobody'}.`,
      lastActivityDays == null ? 'Nothing has been logged against it yet.' : `The last activity was ${lastActivityDays} days ago.`,
      tasks.length ? `Next up: ${str(tasks[0].title)}.` : 'There is no next step.',
    ].join(' ');

    return { summary, risks: risks.slice(0, 3), nextSteps: nextSteps.slice(0, 3), aiGenerated: false };
  },
});
