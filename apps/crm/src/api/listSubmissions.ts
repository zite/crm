import { z } from 'zod';
import { createEndpoint } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { getActor } from '@project/shared/server/actor';
import { iso, json, Params, ref, str } from '@project/shared/server/sql';
import { SUBMISSION_OUTCOMES } from '@project/shared/constants';
import { id, parseInput } from '../server/input';
import { submissionRowSchema } from '../features/forms/formQuery';

const inputSchema = z.object({
  formId: id.optional(),
  leadId: id.optional(),
  contactId: id.optional(),
  outcomes: z.array(z.enum(SUBMISSION_OUTCOMES)).optional(),
  search: z.string().max(120).optional(),
  limit: z.number().int().min(1).max(500).optional(),
});

export default createEndpoint({
  description: 'List web form submissions with what each one became',
  authenticated: true,
  inputSchema,
  outputSchema: z.object({ submissions: z.array(submissionRowSchema), truncated: z.boolean() }),
  execute: async ({ input, context }) => {
    const { formId, leadId, contactId, outcomes, search, limit = 200 } = parseInput(inputSchema, input);
    await getActor(context);
    const p = new Params();
    const where: string[] = ['1 = 1'];
    if (formId) where.push(`s."formId" = ${p.add(formId)}`);
    if (leadId) where.push(`s."leadId" = ${p.add(leadId)}`);
    if (contactId) where.push(`s."contactId" = ${p.add(contactId)}`);
    if (outcomes?.length) where.push(`s."outcome" IN ${p.list(outcomes)}`);
    if (search?.trim()) {
      const like = p.add(`%${search.trim().toLowerCase()}%`);
      where.push(`(LOWER(COALESCE(s."email", '')) LIKE ${like} OR LOWER(COALESCE(s."name", '')) LIKE ${like})`);
    }
    const { rows, truncated } = await zite.sql({
      query: `SELECT s.*, f."name" AS "formName", l."name" AS "leadName", l."status" AS "leadStatus", c."name" AS "contactName"
        FROM "Submissions" s
        LEFT JOIN "Forms" f ON f.id::text = s."formId"
        LEFT JOIN "Leads" l ON l.id::text = s."leadId"
        LEFT JOIN "Contacts" c ON c.id::text = s."contactId"
        WHERE ${where.join(' AND ')}
        ORDER BY s."submittedAt" DESC NULLS LAST, s.created_at DESC
        LIMIT ${Math.min(limit, 500)}`,
      params: p.values,
    });
    return {
      submissions: rows.map(r => ({
        id: String(r.id),
        formId: str(r.formId) ?? '',
        formName: str(r.formName) || null,
        email: str(r.email) || null,
        name: str(r.name) || null,
        answers: json<Record<string, unknown>>(r.answers, {}),
        leadId: ref(r.leadId),
        leadName: str(r.leadName) || null,
        leadStatus: str(r.leadStatus) || null,
        contactId: ref(r.contactId),
        contactName: str(r.contactName) || null,
        outcome: ((SUBMISSION_OUTCOMES as readonly string[]).includes(str(r.outcome) ?? '') ? str(r.outcome) : 'New Lead') as (typeof SUBMISSION_OUTCOMES)[number],
        submittedAt: iso(r.submittedAt) ?? iso(r.created_at),
        pageUrl: str(r.pageUrl) || null,
        referrer: str(r.referrer) || null,
        utm: r.utm ? json<Record<string, unknown>>(r.utm, {}) : null,
      })),
      truncated: Boolean(truncated),
    };
  },
});
