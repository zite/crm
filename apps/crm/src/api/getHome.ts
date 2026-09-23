import { z } from 'zod';
import { createEndpoint } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { getActor } from '@project/shared/server/actor';
import { getSettings } from '@project/shared/server/settings';
import { toActivityRow } from '@project/shared/server/activities';
import { toTaskRow } from '@project/shared/server/tasks';
import { num, numOrNull, str } from '@project/shared/server/sql';
import { addDays, periodEnd, periodLabel, periodStart, todayIn } from '@project/shared/dates';
import { stalledBy } from '@project/shared/deals';
import { parseInput } from '../server/input';
import { queryDeals } from '../server/dealQuery';
import { activityRowSchema, taskRowSchema } from '../server/schemas';

/**
 * Home is a worklist, not a dashboard: what is due, who you are meeting, which
 * deals have gone quiet, and where the quarter stands — all for the signed-in
 * teammate, in one round trip.
 *
 * Meetings come back for a three-day window around `today` rather than a single
 * day, because "today" is the browser's local day and `occurredAt` is an
 * instant: the client buckets them by its own local day so a 7pm meeting never
 * lands on the wrong side of midnight.
 */

const dealBriefSchema = z.object({
  id: z.string(),
  name: z.string(),
  companyId: z.string().nullable(),
  companyName: z.string().nullable(),
  amount: z.number().nullable(),
  closeDate: z.string().nullable(),
  stageId: z.string(),
  pipelineId: z.string(),
  status: z.string(),
  ownerId: z.string().nullable(),
  lastActivityAt: z.string().nullable(),
  stalledDays: z.number(),
});

const inputSchema = z.object({ today: z.string().optional() });

export default createEndpoint({
  description: 'Everything Home shows: today’s tasks and meetings, deals needing attention, and quarter-to-date progress',
  authenticated: true,
  inputSchema,
  outputSchema: z.object({
    today: z.string(),
    tasks: z.array(taskRowSchema),
    meetings: z.array(activityRowSchema),
    counts: z.object({ dueToday: z.number(), overdue: z.number(), upcoming: z.number(), unscheduled: z.number(), newLeads: z.number(), myOpenLeads: z.number() }),
    attention: z.object({
      stalled: z.array(dealBriefSchema),
      noNextStep: z.array(dealBriefSchema),
      closingSoon: z.array(dealBriefSchema),
      counts: z.object({ stalled: z.number(), noNextStep: z.number(), closingSoon: z.number() }),
    }),
    quarter: z.object({
      label: z.string(),
      start: z.string(),
      end: z.string(),
      target: z.number().nullable(),
      won: z.number(),
      wonCount: z.number(),
      open: z.number(),
      openCount: z.number(),
      weighted: z.number(),
    }),
  }),
  execute: async ({ input, context }) => {
    const parsed = parseInput(inputSchema, input);
    const actor = await getActor(context);
    const settings = await getSettings();
    const today = parsed.today && /^\d{4}-\d{2}-\d{2}$/.test(parsed.today) ? parsed.today : todayIn(settings.timezone);

    const qStart = periodStart(today, 'Quarter', settings.fiscalYearStartMonth);
    const qEnd = periodEnd(qStart, 'Quarter');
    const closingHorizon = addDays(today, 14);
    const names = `
      LEFT JOIN "Companies" co ON co.id::text = a."companyId"
      LEFT JOIN "Contacts" ct ON ct.id::text = a."contactId"
      LEFT JOIN "Deals" dl ON dl.id::text = a."dealId"
      LEFT JOIN "Leads" ld ON ld.id::text = a."leadId"`;

    const [taskRes, meetingRes, countRes, quarterRes, quotaRes, stalledRes, noNextStepRes, closingRes] = await Promise.all([
      // Open work that is already on the clock: overdue first, then today.
      zite.sql({
        query: `SELECT t.*, co."name" AS "companyName", ct."name" AS "contactName", dl."name" AS "dealName", ld."name" AS "leadName"
          FROM "Tasks" t
          LEFT JOIN "Companies" co ON co.id::text = t."companyId"
          LEFT JOIN "Contacts" ct ON ct.id::text = t."contactId"
          LEFT JOIN "Deals" dl ON dl.id::text = t."dealId"
          LEFT JOIN "Leads" ld ON ld.id::text = t."leadId"
          WHERE t."ownerId" = $1 AND t."status" = 'Open' AND t."dueDate" <= $2::date
          ORDER BY t."dueDate" ASC, COALESCE(NULLIF(t."dueTime", ''), '99:99') ASC, t.created_at ASC
          LIMIT 60`,
        params: [actor.id, today],
      }),
      zite.sql({
        query: `SELECT a.*, co."name" AS "companyName", ct."name" AS "contactName", dl."name" AS "dealName", ld."name" AS "leadName"
          FROM "Activities" a ${names}
          WHERE a."kind" = 'Meeting' AND a."ownerId" = $1 AND a."occurredAt" >= $2::date AND a."occurredAt" < ($3::date + 1)
          ORDER BY a."occurredAt" ASC
          LIMIT 40`,
        params: [actor.id, addDays(today, -1), addDays(today, 2)],
      }),
      zite.sql({
        query: `SELECT
          (SELECT COUNT(*) FROM "Tasks" WHERE "ownerId" = $1 AND "status" = 'Open' AND "dueDate" = $2::date) AS "dueTodayTotal",
          (SELECT COUNT(*) FROM "Tasks" WHERE "ownerId" = $1 AND "status" = 'Open' AND "dueDate" < $2::date) AS "overdueTotal",
          (SELECT COUNT(*) FROM "Tasks" WHERE "ownerId" = $1 AND "status" = 'Open' AND "dueDate" > $2::date) AS "upcomingTotal",
          (SELECT COUNT(*) FROM "Tasks" WHERE "ownerId" = $1 AND "status" = 'Open' AND "dueDate" IS NULL) AS "unscheduledTotal",
          (SELECT COUNT(*) FROM "Leads" WHERE "status" = 'New') AS "newLeadTotal",
          (SELECT COUNT(*) FROM "Leads" WHERE "ownerId" = $1 AND "status" IN ('New', 'Working')) AS "myLeadTotal"`,
        params: [actor.id, today],
      }),
      zite.sql({
        query: `SELECT
            COALESCE(SUM(d."amount") FILTER (WHERE d."status" = 'Won' AND d."closedAt" >= $2::date AND d."closedAt" < ($3::date + 1)), 0) AS "wonAmount",
            COUNT(*) FILTER (WHERE d."status" = 'Won' AND d."closedAt" >= $2::date AND d."closedAt" < ($3::date + 1)) AS "wonTotal",
            COALESCE(SUM(d."amount") FILTER (WHERE d."status" = 'Open'), 0) AS "openAmount",
            COUNT(*) FILTER (WHERE d."status" = 'Open') AS "openTotal",
            COALESCE(SUM(COALESCE(d."amount", 0) * COALESCE(d."probability", s."probability", 0) / 100.0) FILTER (WHERE d."status" = 'Open'), 0) AS "weightedAmount"
          FROM "Deals" d
          LEFT JOIN "Stages" s ON s.id::text = d."stageId"
          WHERE COALESCE(d."archived", false) = false AND d."ownerId" = $1`,
        params: [actor.id, qStart, qEnd],
      }),
      zite.sql({
        query: `SELECT "target" FROM "Quotas" WHERE "memberId" = $1 AND "period" = 'Quarter' AND "metric" = 'Revenue' AND "periodStart" = $2::date ORDER BY created_at DESC LIMIT 1`,
        params: [actor.id, qStart],
      }),
      queryDeals({ status: ['Open'], ownerIds: [actor.id], stalled: true }, { key: 'lastActivityAt', dir: 'asc' }, 50, today),
      queryDeals({ status: ['Open'], ownerIds: [actor.id], noNextStep: true }, { key: 'lastActivityAt', dir: 'asc' }, 50, today),
      queryDeals({ status: ['Open'], ownerIds: [actor.id], closeFrom: today, closeTo: closingHorizon }, { key: 'closeDate', dir: 'asc' }, 50, today),
    ]);

    const stageById = new Map<string, { rottingDays: number | null }>();
    const { rows: stageRows } = await zite.sql({ query: `SELECT id, "rottingDays" FROM "Stages"`, params: [] });
    for (const r of stageRows) stageById.set(String(r.id), { rottingDays: numOrNull(r.rottingDays) });

    type DealRow = (typeof stalledRes)['deals'][number];
    const brief = (d: DealRow) => ({
      id: d.id,
      name: d.name,
      companyId: d.companyId,
      companyName: d.companyName,
      amount: d.amount,
      closeDate: d.closeDate,
      stageId: d.stageId,
      pipelineId: d.pipelineId,
      status: d.status as string,
      ownerId: d.ownerId,
      lastActivityAt: d.lastActivityAt,
      stalledDays: settings.preferences.stalledEnabled ? stalledBy(d.status, d.stageEnteredAt, stageById.get(d.stageId) ?? null, today) : 0,
    });

    const stalled = stalledRes.deals.map(brief).sort((a, b) => b.stalledDays - a.stalledDays);
    const noNextStep = noNextStepRes.deals.map(brief);
    const closingSoon = closingRes.deals.map(brief);

    const c = countRes.rows[0] ?? {};
    const q = quarterRes.rows[0] ?? {};
    const target = quotaRes.rows[0] ? numOrNull(quotaRes.rows[0].target) : null;

    return {
      today,
      tasks: taskRes.rows.map(r => ({
        ...toTaskRow(r),
        companyName: str(r.companyName) || null,
        contactName: str(r.contactName) || null,
        dealName: str(r.dealName) || null,
        leadName: str(r.leadName) || null,
      })),
      meetings: meetingRes.rows.map(r => ({
        ...toActivityRow(r),
        companyName: str(r.companyName) || null,
        contactName: str(r.contactName) || null,
        dealName: str(r.dealName) || null,
        leadName: str(r.leadName) || null,
      })),
      counts: {
        dueToday: num(c.dueTodayTotal),
        overdue: num(c.overdueTotal),
        upcoming: num(c.upcomingTotal),
        unscheduled: num(c.unscheduledTotal),
        newLeads: num(c.newLeadTotal),
        myOpenLeads: num(c.myLeadTotal),
      },
      attention: {
        stalled: stalled.slice(0, 5),
        noNextStep: noNextStep.slice(0, 5),
        closingSoon: closingSoon.slice(0, 5),
        counts: { stalled: stalled.length, noNextStep: noNextStep.length, closingSoon: closingSoon.length },
      },
      quarter: {
        label: periodLabel(qStart, 'Quarter', settings.fiscalYearStartMonth),
        start: qStart,
        end: qEnd,
        target,
        won: num(q.wonAmount),
        wonCount: num(q.wonTotal),
        open: num(q.openAmount),
        openCount: num(q.openTotal),
        weighted: Math.round(num(q.weightedAmount)),
      },
    };
  },
});
