import { z } from 'zod';
import { createEndpoint } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { num, numOrNull, Params, str } from '@project/shared/server/sql';
import { addDays, startOfWeek } from '@project/shared/dates';
import { parseInput } from '../server/input';
import { membersInScope, ownerClause, reportMemberSchema, reportScopeOutput, reportScopeSchema, resolveScope, scopeOutput } from '../server/reports/common';

/**
 * The coaching screen: what each person logged, week by week, plus the two
 * numbers a manager actually acts on — meetings booked and how fast new leads
 * get an answer. It counts work, not worth, so it never ranks anyone.
 */

const inputSchema = reportScopeSchema;

export default createEndpoint({
  description: 'Activity logged per person per week, meetings booked and first-response time on leads',
  authenticated: true,
  inputSchema,
  outputSchema: z.object({
    scope: reportScopeOutput,
    weeks: z.array(z.object({ week: z.string(), label: z.string() })),
    people: z.array(
      z.object({
        member: reportMemberSchema,
        memberId: z.string(),
        name: z.string(),
        calls: z.number(),
        emails: z.number(),
        meetings: z.number(),
        notes: z.number(),
        total: z.number(),
        upcomingMeetings: z.number(),
        leadsReceived: z.number(),
        leadsResponded: z.number(),
        avgResponseHours: z.number().nullable(),
        withinTarget: z.number(),
      }),
    ),
    cells: z.array(z.object({ memberId: z.string(), week: z.string(), calls: z.number(), emails: z.number(), meetings: z.number(), notes: z.number(), total: z.number() })),
    targetHours: z.number(),
  }),
  execute: async ({ input, context }) => {
    const parsed = parseInput(inputSchema, input);
    const r = await resolveScope(parsed, context);
    const targetHours = r.settings.preferences.leadResponseHours;

    // Whole weeks, Monday first, covering every day of the period.
    const firstWeek = startOfWeek(r.from);
    const weeks: string[] = [];
    for (let day = firstWeek; day <= r.to; day = addDays(day, 7)) weeks.push(day);

    const ap = new Params();
    const af = ap.add(firstWeek);
    const at = ap.add(r.to);
    const aOwner = ownerClause(ap, parsed, 'a."ownerId"');
    const { rows: activityRows } = await zite.sql({
      query: `SELECT a."ownerId" AS owner_id, to_char(date_trunc('week', a."occurredAt"), 'YYYY-MM-DD') AS week, a."kind" AS kind, COUNT(*) AS logged
              FROM "Activities" a
              WHERE a."occurredAt" >= ${af}::date AND a."occurredAt" < (${at}::date + 1) AND COALESCE(a."ownerId", '') <> ''${aOwner ? ` AND ${aOwner}` : ''}
              GROUP BY 1, 2, 3`,
      params: ap.values,
    });

    const up = new Params();
    const uToday = up.add(r.today);
    const uOwner = ownerClause(up, parsed, 'a."ownerId"');
    const { rows: upcomingRows } = await zite.sql({
      query: `SELECT a."ownerId" AS owner_id, COUNT(*) AS meetings
              FROM "Activities" a
              WHERE a."kind" = 'Meeting' AND a."occurredAt" >= ${uToday}::date AND COALESCE(a."ownerId", '') <> ''${uOwner ? ` AND ${uOwner}` : ''}
              GROUP BY 1`,
      params: up.values,
    });

    const lp = new Params();
    const lf = lp.add(r.from);
    const lt = lp.add(r.to);
    const lTarget = lp.add(targetHours);
    const lOwner = ownerClause(lp, parsed, 'l."ownerId"');
    const received = `COALESCE(l."receivedAt", l.created_at)`;
    const { rows: leadRows } = await zite.sql({
      query: `SELECT l."ownerId" AS owner_id,
                     COUNT(*) AS received,
                     COUNT(*) FILTER (WHERE l."firstResponseAt" IS NOT NULL) AS responded,
                     AVG(EXTRACT(EPOCH FROM (l."firstResponseAt" - ${received})) / 3600.0) FILTER (WHERE l."firstResponseAt" IS NOT NULL AND l."firstResponseAt" >= ${received}) AS avg_hours,
                     COUNT(*) FILTER (WHERE l."firstResponseAt" IS NOT NULL AND EXTRACT(EPOCH FROM (l."firstResponseAt" - ${received})) / 3600.0 <= ${lTarget}) AS within_target
              FROM "Leads" l
              WHERE ${received} >= ${lf}::date AND ${received} < (${lt}::date + 1) AND COALESCE(l."ownerId", '') <> ''${lOwner ? ` AND ${lOwner}` : ''}
              GROUP BY 1`,
      params: lp.values,
    });

    const members = await membersInScope(parsed);
    const known = new Set(members.map(m => m.id));
    const upcoming = new Map(upcomingRows.map(row => [String(row.owner_id), num(row.meetings)]));
    const leads = new Map(leadRows.map(row => [String(row.owner_id), row]));

    type Tally = { calls: number; emails: number; meetings: number; notes: number; total: number };
    const blank = (): Tally => ({ calls: 0, emails: 0, meetings: 0, notes: 0, total: 0 });
    const KEY: Record<string, keyof Tally> = { Call: 'calls', Email: 'emails', Meeting: 'meetings', Note: 'notes' };

    const perPerson = new Map<string, Tally>();
    const perCell = new Map<string, Tally>();
    for (const row of activityRows) {
      const memberId = String(row.owner_id);
      if (!known.has(memberId)) continue;
      const week = str(row.week) ?? '';
      const key = KEY[str(row.kind) ?? ''];
      if (!key) continue;
      const count = num(row.logged);
      const person = perPerson.get(memberId) ?? blank();
      person[key] += count;
      person.total += count;
      perPerson.set(memberId, person);
      const cellKey = `${memberId}|${week}`;
      const cell = perCell.get(cellKey) ?? blank();
      cell[key] += count;
      cell.total += count;
      perCell.set(cellKey, cell);
    }

    const people = members
      .map(member => {
        const tally = perPerson.get(member.id) ?? blank();
        const lead = leads.get(member.id);
        const avg = numOrNull(lead?.avg_hours);
        return {
          member,
          memberId: member.id,
          name: member.name,
          ...tally,
          upcomingMeetings: upcoming.get(member.id) ?? 0,
          leadsReceived: num(lead?.received),
          leadsResponded: num(lead?.responded),
          avgResponseHours: avg == null ? null : Math.round(avg * 10) / 10,
          withinTarget: num(lead?.within_target),
        };
      })
      .filter(person => person.total > 0 || person.leadsReceived > 0 || person.upcomingMeetings > 0)
      .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));

    const cells = [...perCell.entries()].map(([key, tally]) => {
      const [memberId, week] = key.split('|');
      return { memberId, week, ...tally };
    });

    return {
      scope: scopeOutput(r),
      weeks: weeks.map(week => ({ week, label: weekLabel(week) })),
      people,
      cells,
      targetHours,
    };
  },
});

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 'Sep 7' — the Monday a week starts on. */
function weekLabel(week: string) {
  const month = MONTHS[Number(week.slice(5, 7)) - 1] ?? '';
  return `${month} ${Number(week.slice(8, 10))}`;
}
