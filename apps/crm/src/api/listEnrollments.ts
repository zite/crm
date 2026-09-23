import { z } from 'zod';
import { createEndpoint } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { getActor } from '@project/shared/server/actor';
import { ENROLLMENT_STATUSES } from '@project/shared/constants';
import { parseSteps } from '@project/shared/server/sequencesEngine';
import { iso, num, ref, str, Params } from '@project/shared/server/sql';
import { id, parseInput } from '../server/input';

/**
 * Who is on a sequence: what step they are on, when the next one runs, and how
 * it ended for the people who are finished. Also answers "what is this contact
 * enrolled in" for a contact page.
 */
const inputSchema = z.object({
  sequenceId: id.optional(),
  contactId: id.optional(),
  ownerIds: z.array(z.string().max(64)).max(50).optional(),
  statuses: z.array(z.enum(ENROLLMENT_STATUSES)).optional(),
  search: z.string().max(120).optional(),
  limit: z.number().int().min(1).max(1000).optional(),
});

const rowSchema = z.object({
  id: z.string(),
  sequenceId: z.string(),
  sequenceName: z.string(),
  stepCount: z.number(),
  contactId: z.string().nullable(),
  contactName: z.string(),
  contactEmail: z.string(),
  companyId: z.string().nullable(),
  companyName: z.string(),
  dealId: z.string().nullable(),
  ownerId: z.string().nullable(),
  status: z.string(),
  stepIndex: z.number(),
  nextRunAt: z.string().nullable(),
  enrolledAt: z.string().nullable(),
  lastStepAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  exitReason: z.string(),
  enrolledById: z.string().nullable(),
});

export default createEndpoint({
  description: 'List sequence enrollments, filtered by sequence, contact, owner or status',
  authenticated: true,
  inputSchema,
  outputSchema: z.object({ enrollments: z.array(rowSchema), truncated: z.boolean() }),
  execute: async ({ input, context }) => {
    const data = parseInput(inputSchema, input);
    await getActor(context);

    const p = new Params();
    const where: string[] = [];
    if (data.sequenceId) where.push(`e."sequenceId" = ${p.add(data.sequenceId)}`);
    if (data.contactId) where.push(`e."contactId" = ${p.add(data.contactId)}`);
    if (data.statuses?.length) where.push(`e."status" IN ${p.list(data.statuses)}`);
    if (data.ownerIds?.length) {
      const real = data.ownerIds.filter(v => v !== 'none');
      const parts: string[] = [];
      if (real.length) parts.push(`e."ownerId" IN ${p.list(real)}`);
      if (data.ownerIds.includes('none')) parts.push(`COALESCE(e."ownerId", '') = ''`);
      if (parts.length) where.push(`(${parts.join(' OR ')})`);
    }
    if (data.search?.trim()) {
      const term = `%${data.search.trim()}%`;
      where.push(`(c."name" ILIKE ${p.add(term)} OR c."email" ILIKE ${p.add(term)} OR co."name" ILIKE ${p.add(term)})`);
    }
    const limit = data.limit ?? 500;

    const { rows, truncated } = await zite.sql({
      query: `
        SELECT e.id, e."sequenceId", e."contactId", e."dealId", e."ownerId", e."status", e."stepIndex",
               e."nextRunAt", e."enrolledAt", e."lastStepAt", e."finishedAt", e."exitReason", e."enrolledById",
               s."name" AS "sequenceName", s."steps",
               c."name" AS "contactName", c."email" AS "contactEmail", c."companyId",
               co."name" AS "companyName"
        FROM "Enrollments" e
        LEFT JOIN "Sequences" s ON s.id::text = e."sequenceId"
        LEFT JOIN "Contacts" c ON c.id::text = e."contactId"
        LEFT JOIN "Companies" co ON co.id::text = c."companyId"
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY CASE e."status" WHEN 'Active' THEN 0 WHEN 'Paused' THEN 1 WHEN 'Finished' THEN 2 ELSE 3 END,
                 e."nextRunAt" ASC NULLS LAST, e."enrolledAt" DESC NULLS LAST
        LIMIT ${limit}`,
      params: p.values,
    });

    return {
      truncated,
      enrollments: rows.map(r => ({
        id: String(r.id),
        sequenceId: str(r.sequenceId) ?? '',
        sequenceName: str(r.sequenceName) ?? 'Deleted sequence',
        stepCount: parseSteps(r.steps).length,
        contactId: ref(r.contactId),
        contactName: str(r.contactName) ?? '',
        contactEmail: str(r.contactEmail) ?? '',
        companyId: ref(r.companyId),
        companyName: str(r.companyName) ?? '',
        dealId: ref(r.dealId),
        ownerId: ref(r.ownerId),
        status: str(r.status) || 'Active',
        stepIndex: num(r.stepIndex),
        nextRunAt: iso(r.nextRunAt),
        enrolledAt: iso(r.enrolledAt),
        lastStepAt: iso(r.lastStepAt),
        finishedAt: iso(r.finishedAt),
        exitReason: str(r.exitReason) ?? '',
        enrolledById: ref(r.enrolledById),
      })),
    };
  },
});
