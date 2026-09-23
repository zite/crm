import { z } from 'zod';
import { createEndpoint } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { getActor } from '@project/shared/server/actor';
import { getSettings } from '@project/shared/server/settings';
import { Params, str } from '@project/shared/server/sql';
import { toTaskRow } from '@project/shared/server/tasks';
import { todayIn } from '@project/shared/dates';
import { TASK_PRIORITIES, TASK_TYPES } from '@project/shared/constants';
import { day, id, parseInput } from '../server/input';
import { taskRowSchema } from '../server/schemas';

const filters = z.object({
  ownerIds: z.array(z.string()).optional(),
  teamId: id.optional(),
  status: z.enum(['Open', 'Done', 'All']).optional(),
  types: z.array(z.enum(TASK_TYPES)).optional(),
  priorities: z.array(z.enum(TASK_PRIORITIES)).optional(),
  dueFrom: day.optional(),
  dueTo: day.optional(),
  /** Open and due before today. */
  overdue: z.boolean().optional(),
  noDueDate: z.boolean().optional(),
  companyId: id.optional(),
  contactId: id.optional(),
  dealId: id.optional(),
  leadId: id.optional(),
  search: z.string().max(120).optional(),
});

const inputSchema = z.object({
  filters: filters.default({}),
  sort: z.object({ key: z.enum(['dueDate', 'created', 'priority', 'title']), dir: z.enum(['asc', 'desc']) }).optional(),
  limit: z.number().int().min(1).max(2000).optional(),
  today: z.string().optional(),
});

export default createEndpoint({
  description: 'List tasks with filters (mine, team, overdue, by record)',
  authenticated: true,
  inputSchema,
  outputSchema: z.object({ tasks: z.array(taskRowSchema), counts: z.object({ overdue: z.number(), today: z.number(), upcoming: z.number(), unscheduled: z.number(), done: z.number(), team: z.number() }) }),
  execute: async ({ input, context }) => {
    const { filters: f, sort, limit = 500, today: t } = parseInput(inputSchema, input);
    const actor = await getActor(context);
    const settings = await getSettings();
    const today = t && /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : todayIn(settings.timezone);

    const p = new Params();
    const where: string[] = [];
    if (f.status === 'Open' || !f.status) where.push(`t."status" = 'Open'`);
    else if (f.status === 'Done') where.push(`t."status" = 'Done'`);
    if (f.ownerIds?.length) {
      const real = f.ownerIds.filter(o => o !== 'none');
      const parts: string[] = [];
      if (real.length) parts.push(`t."ownerId" IN ${p.list(real)}`);
      if (f.ownerIds.includes('none')) parts.push(`COALESCE(t."ownerId", '') = ''`);
      where.push(`(${parts.join(' OR ')})`);
    }
    if (f.teamId) where.push(`t."ownerId" IN (SELECT id::text FROM "Members" WHERE "teamId" = ${p.add(f.teamId)})`);
    if (f.types?.length) where.push(`t."type" IN ${p.list(f.types)}`);
    if (f.priorities?.length) where.push(`t."priority" IN ${p.list(f.priorities)}`);
    if (f.dueFrom) where.push(`t."dueDate" >= ${p.add(f.dueFrom)}::date`);
    if (f.dueTo) where.push(`t."dueDate" <= ${p.add(f.dueTo)}::date`);
    if (f.overdue) where.push(`t."status" = 'Open' AND t."dueDate" < ${p.add(today)}::date`);
    if (f.noDueDate) where.push(`t."dueDate" IS NULL`);
    for (const [key, value] of [['companyId', f.companyId], ['contactId', f.contactId], ['dealId', f.dealId], ['leadId', f.leadId]] as const) {
      if (value) where.push(`t."${key}" = ${p.add(value)}`);
    }
    if (f.search?.trim()) {
      const like = p.add(`%${f.search.trim().toLowerCase()}%`);
      where.push(`(LOWER(t."title") LIKE ${like} OR LOWER(t."notes") LIKE ${like})`);
    }
    const dir = sort?.dir === 'desc' ? 'DESC' : 'ASC';
    const order =
      {
        dueDate: `t."dueDate" ${dir} NULLS LAST, COALESCE(NULLIF(t."dueTime", ''), '99:99') ${dir}`,
        created: `t.created_at ${dir}`,
        priority: `CASE t."priority" WHEN 'High' THEN 0 WHEN 'Normal' THEN 1 ELSE 2 END ${dir}, t."dueDate" ASC NULLS LAST`,
        title: `LOWER(t."title") ${dir}`,
      }[sort?.key ?? 'dueDate'] ?? `t."dueDate" ASC NULLS LAST`;

    const [{ rows }, countRes] = await Promise.all([
      zite.sql({
        query: `SELECT t.*, co."name" AS "companyName", ct."name" AS "contactName", dl."name" AS "dealName", ld."name" AS "leadName"
          FROM "Tasks" t
          LEFT JOIN "Companies" co ON co.id::text = t."companyId"
          LEFT JOIN "Contacts" ct ON ct.id::text = t."contactId"
          LEFT JOIN "Deals" dl ON dl.id::text = t."dealId"
          LEFT JOIN "Leads" ld ON ld.id::text = t."leadId"
          ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
          ORDER BY ${order}, t.created_at DESC
          LIMIT ${limit}`,
        params: p.values,
      }),
      zite.sql({
        query: `SELECT
          COUNT(*) FILTER (WHERE "status" = 'Open' AND "dueDate" < $2::date) AS "overdueTotal",
          COUNT(*) FILTER (WHERE "status" = 'Open' AND "dueDate" = $2::date) AS "todayTotal",
          COUNT(*) FILTER (WHERE "status" = 'Open' AND "dueDate" > $2::date) AS "upcomingTotal",
          COUNT(*) FILTER (WHERE "status" = 'Open' AND "dueDate" IS NULL) AS "unscheduledTotal",
          COUNT(*) FILTER (WHERE "status" = 'Done') AS "doneTotal",
          (SELECT COUNT(*) FROM "Tasks" WHERE "status" = 'Open') AS "teamTotal"
          FROM "Tasks" WHERE "ownerId" = $1`,
        params: [f.ownerIds?.length === 1 && f.ownerIds[0] !== 'none' ? f.ownerIds[0] : actor.id, today],
      }),
    ]);
    const c = countRes.rows[0] ?? {};
    return {
      tasks: rows.map(r => ({ ...toTaskRow(r), companyName: str(r.companyName) || null, contactName: str(r.contactName) || null, dealName: str(r.dealName) || null, leadName: str(r.leadName) || null })),
      counts: {
        overdue: Number(c.overdueTotal ?? 0),
        today: Number(c.todayTotal ?? 0),
        upcoming: Number(c.upcomingTotal ?? 0),
        unscheduled: Number(c.unscheduledTotal ?? 0),
        done: Number(c.doneTotal ?? 0),
        // Every open task in the organization — what the Tasks page's Team tab shows.
        team: Number(c.teamTotal ?? 0),
      },
    };
  },
});
