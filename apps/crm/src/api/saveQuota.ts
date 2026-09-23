import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { assertCan, getActor } from '@project/shared/server/actor';
import { getSettings } from '@project/shared/server/settings';
import { logEvent } from '@project/shared/server/events';
import { Params, withRetry } from '@project/shared/server/sql';
import { periodStart, todayIn } from '@project/shared/dates';
import { parseInput } from '../server/input';
import { QUOTA_METRIC } from '../server/reports/common';

/**
 * Set quotas for one period and metric. Takes several teammates at once so
 * "copy last period" is one call; a target of null clears the quota rather than
 * storing a zero nobody meant.
 *
 * Writes go one at a time — the platform rate-limits bursts.
 */

const inputSchema = z.object({
  period: z.enum(['Month', 'Quarter', 'Year']),
  periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a YYYY-MM-DD date').optional(),
  metric: QUOTA_METRIC.default('Revenue'),
  entries: z
    .array(z.object({ memberId: z.string().min(1).max(64), target: z.number().finite().min(0, 'A quota can’t be negative').max(1_000_000_000_000).nullable() }))
    .min(1, 'Pick at least one teammate')
    .max(200),
  today: z.string().optional(),
});

export default createEndpoint({
  description: 'Set or clear quota targets for teammates in one period',
  authenticated: true,
  inputSchema,
  outputSchema: z.object({ saved: z.number(), cleared: z.number(), periodStart: z.string() }),
  execute: async ({ input, context }) => {
    const parsed = parseInput(inputSchema, input);
    const actor = await getActor(context);
    assertCan(actor, 'quotas.manage');
    const settings = await getSettings();
    const today = parsed.today && /^\d{4}-\d{2}-\d{2}$/.test(parsed.today) ? parsed.today : todayIn(settings.timezone);
    const start = periodStart(parsed.periodStart ?? today, parsed.period, settings.fiscalYearStartMonth);

    const ids = [...new Set(parsed.entries.map(entry => entry.memberId))];
    const mp = new Params();
    const { rows: memberRows } = await zite.sql({
      query: `SELECT id FROM "Members" WHERE id::text IN ${mp.list(ids)} AND "status" <> 'Deactivated'`,
      params: mp.values,
    });
    const known = new Set(memberRows.map(row => String(row.id)));
    const missing = ids.find(id => !known.has(id));
    if (missing) throw new ZiteError('One of those teammates isn’t active any more. Reload the page and try again.', 'BAD_REQUEST');

    const qp = new Params();
    const metric = qp.add(parsed.metric);
    const period = qp.add(parsed.period);
    const startParam = qp.add(start);
    const { rows: existingRows } = await zite.sql({
      query: `SELECT id, "memberId" FROM "Quotas" WHERE "metric" = ${metric} AND "period" = ${period} AND "periodStart" = ${startParam}::date AND "memberId" IN ${qp.list(ids)}`,
      params: qp.values,
    });
    const existing = new Map(existingRows.map(row => [String(row.memberId), String(row.id)]));

    let saved = 0;
    let cleared = 0;
    for (const entry of parsed.entries) {
      const current = existing.get(entry.memberId);
      if (entry.target == null) {
        if (current) {
          await withRetry(() => zite.quotas.delete({ id: current }));
          cleared += 1;
        }
        continue;
      }
      if (current) await withRetry(() => zite.quotas.update({ id: current, record: { target: entry.target } as never }));
      else await withRetry(() => zite.quotas.create({ record: { memberId: entry.memberId, period: parsed.period, periodStart: start, metric: parsed.metric, target: entry.target } as never }));
      saved += 1;
    }

    await logEvent({
      kind: 'quota.set',
      entity: { type: 'member', id: parsed.entries[0].memberId },
      actorId: actor.id,
      summary: `set ${parsed.metric.toLowerCase()} quotas for ${parsed.entries.length === 1 ? '1 teammate' : `${parsed.entries.length} teammates`}`,
      data: { period: parsed.period, periodStart: start, metric: parsed.metric },
    });

    return { saved, cleared, periodStart: start };
  },
});
