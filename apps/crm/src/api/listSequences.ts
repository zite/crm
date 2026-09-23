import { z } from 'zod';
import { createEndpoint } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { getActor } from '@project/shared/server/actor';
import { canManageAsset } from '@project/shared/roles';
import { parseSteps } from '@project/shared/server/sequencesEngine';
import { bool, iso, num, ref, str } from '@project/shared/server/sql';
import { parseInput } from '../server/input';

/**
 * Every sequence with the numbers that tell you whether it is working: how
 * many people are on it now, how many finished, and how many left because they
 * replied or booked a meeting.
 */
const inputSchema = z.object({ includeArchived: z.boolean().optional() });

const rowSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  ownerId: z.string().nullable(),
  status: z.string(),
  shared: z.boolean(),
  stepCount: z.number(),
  /** The cadence in days, e.g. 0, 2, 5 — enough to show its shape in a row. */
  days: z.array(z.number()),
  createdAt: z.string().nullable(),
  totalEnrolled: z.number(),
  active: z.number(),
  paused: z.number(),
  finished: z.number(),
  replied: z.number(),
  meetings: z.number(),
  canManage: z.boolean(),
});

export default createEndpoint({
  description: 'List sequences with enrollment counts and reply/meeting rates',
  authenticated: true,
  inputSchema,
  outputSchema: z.object({ sequences: z.array(rowSchema) }),
  execute: async ({ input, context }) => {
    const { includeArchived = true } = parseInput(inputSchema, input);
    const actor = await getActor(context);

    const { rows } = await zite.sql({
      query: `
        SELECT s.id, s."name", s."description", s."ownerId", s."status", s."shared", s."steps", s.created_at,
               COUNT(e.id) AS "totalEnrolled",
               COUNT(e.id) FILTER (WHERE e."status" = 'Active') AS "active",
               COUNT(e.id) FILTER (WHERE e."status" = 'Paused') AS "paused",
               COUNT(e.id) FILTER (WHERE e."status" = 'Finished') AS "finished",
               COUNT(e.id) FILTER (WHERE e."exitReason" = 'Replied') AS "replied",
               COUNT(e.id) FILTER (WHERE e."exitReason" = 'Meeting booked') AS "meetings"
        FROM "Sequences" s
        LEFT JOIN "Enrollments" e ON e."sequenceId" = s.id::text
        WHERE $1 OR s."status" <> 'Archived'
        GROUP BY s.id
        ORDER BY CASE s."status" WHEN 'Active' THEN 0 WHEN 'Paused' THEN 1 ELSE 2 END, LOWER(s."name") ASC`,
      params: [includeArchived],
    });

    return {
      sequences: rows.map(r => {
        const steps = parseSteps(r.steps);
        let day = 0;
        return {
          id: String(r.id),
          name: str(r.name) ?? '',
          description: str(r.description) ?? '',
          ownerId: ref(r.ownerId),
          status: str(r.status) || 'Active',
          shared: bool(r.shared),
          stepCount: steps.length,
          days: steps.map((step, i) => (day += i === 0 ? 0 : step.delayDays)),
          createdAt: iso(r.created_at),
          totalEnrolled: num(r.totalEnrolled),
          active: num(r.active),
          paused: num(r.paused),
          finished: num(r.finished),
          replied: num(r.replied),
          meetings: num(r.meetings),
          canManage: canManageAsset(actor.role, actor.id, ref(r.ownerId)),
        };
      }),
    };
  },
});
