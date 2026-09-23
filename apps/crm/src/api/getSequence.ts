import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { getActor } from '@project/shared/server/actor';
import { canManageAsset } from '@project/shared/roles';
import { parseSequenceSettings, parseSteps, STEP_KINDS } from '@project/shared/server/sequencesEngine';
import { getSettings } from '@project/shared/server/settings';
import { bool, iso, num, ref, str } from '@project/shared/server/sql';
import { id, parseInput } from '../server/input';

/** One sequence: its steps, its rules, and how the people on it are doing. */
const inputSchema = z.object({ id });

const stepSchema = z.object({
  id: z.string(),
  kind: z.enum(STEP_KINDS),
  delayDays: z.number(),
  subject: z.string(),
  body: z.string(),
  note: z.string(),
});

const sequenceSettingsSchema = z.object({
  weekdaysOnly: z.boolean(),
  sendWindow: z.object({ start: z.string(), end: z.string() }),
  exitOnReply: z.boolean(),
  exitOnMeeting: z.boolean(),
  exitOnDeal: z.boolean(),
});

export default createEndpoint({
  description: 'One sequence with its steps, settings and enrollment stats',
  authenticated: true,
  inputSchema,
  outputSchema: z.object({
    sequence: z.object({
      id: z.string(),
      name: z.string(),
      description: z.string(),
      ownerId: z.string().nullable(),
      status: z.string(),
      shared: z.boolean(),
      steps: z.array(stepSchema),
      settings: sequenceSettingsSchema,
      createdAt: z.string().nullable(),
    }),
    stats: z.object({ total: z.number(), active: z.number(), paused: z.number(), finished: z.number(), exited: z.number(), replied: z.number(), meetings: z.number(), emailsSent: z.number(), openTasks: z.number() }),
    canManage: z.boolean(),
    timezone: z.string(),
  }),
  execute: async ({ input, context }) => {
    const data = parseInput(inputSchema, input);
    const actor = await getActor(context);
    const settings = await getSettings();

    const { rows } = await zite.sql({
      query: `SELECT id, "name", "description", "ownerId", "status", "shared", "steps", "settings", created_at FROM "Sequences" WHERE id::text = $1 LIMIT 1`,
      params: [data.id],
    });
    const r = rows[0];
    if (!r) throw new ZiteError('That sequence no longer exists', 'NOT_FOUND');

    const { rows: statRows } = await zite.sql({
      query: `
        SELECT COUNT(*) AS "total",
               COUNT(*) FILTER (WHERE "status" = 'Active') AS "active",
               COUNT(*) FILTER (WHERE "status" = 'Paused') AS "paused",
               COUNT(*) FILTER (WHERE "status" = 'Finished') AS "finished",
               COUNT(*) FILTER (WHERE "status" = 'Exited') AS "exited",
               COUNT(*) FILTER (WHERE "exitReason" = 'Replied') AS "replied",
               COUNT(*) FILTER (WHERE "exitReason" = 'Meeting booked') AS "meetings"
        FROM "Enrollments" WHERE "sequenceId" = $1`,
      params: [data.id],
    });
    const { rows: workRows } = await zite.sql({
      query: `
        SELECT
          (SELECT COUNT(*) FROM "Activities" a JOIN "Enrollments" e ON e.id::text = a."enrollmentId" WHERE e."sequenceId" = $1 AND a."kind" = 'Email') AS "emailsSent",
          (SELECT COUNT(*) FROM "Tasks" t JOIN "Enrollments" e ON e.id::text = t."enrollmentId" WHERE e."sequenceId" = $1 AND t."status" = 'Open') AS "openTasks"`,
      params: [data.id],
    });

    const s = statRows[0] ?? {};
    const w = workRows[0] ?? {};
    return {
      sequence: {
        id: String(r.id),
        name: str(r.name) ?? '',
        description: str(r.description) ?? '',
        ownerId: ref(r.ownerId),
        status: str(r.status) || 'Active',
        shared: bool(r.shared),
        steps: parseSteps(r.steps),
        settings: parseSequenceSettings(r.settings),
        createdAt: iso(r.created_at),
      },
      stats: {
        total: num(s.total),
        active: num(s.active),
        paused: num(s.paused),
        finished: num(s.finished),
        exited: num(s.exited),
        replied: num(s.replied),
        meetings: num(s.meetings),
        emailsSent: num(w.emailsSent),
        openTasks: num(w.openTasks),
      },
      canManage: canManageAsset(actor.role, actor.id, ref(r.ownerId)),
      timezone: settings.timezone,
    };
  },
});
