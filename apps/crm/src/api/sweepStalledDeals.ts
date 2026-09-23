import { z } from 'zod';
import { createEndpoint } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { runTrigger } from '@project/shared/server/automations';
import { getSettings } from '@project/shared/server/settings';
import { num } from '@project/shared/server/sql';
import { todayIn } from '@project/shared/dates';
import { parseInput, today as todayInput } from '../server/input';

/**
 * The one trigger nothing else can fire: a deal that has sat in the same stage
 * past that stage's rotting days.
 *
 * It runs every morning before the team starts, finds the open deals that
 * crossed the line, and fires `deal.stalled` once per deal. Firing it again
 * tomorrow is harmless: every task an automation creates carries a systemKey
 * stamped with the day the deal entered its stage, so the same stall can only
 * ever leave one task behind.
 *
 * `context.user` is null on a scheduled run, so this endpoint never asks who
 * is acting — it acts as the workspace.
 */

const inputSchema = z.object({ today: todayInput, limit: z.number().int().min(1).max(500).optional() });

export default createEndpoint({
  description: 'Find open deals past their stage’s rotting days and fire the stalled trigger for each',
  authenticated: false,
  schedule: { scheduleType: 'recurring', schedule: { frequency: 'daily', interval: 1, times: ['07:00'] }, timezone: 'America/Los_Angeles' },
  inputSchema,
  outputSchema: z.object({ checked: z.number(), stalled: z.number(), skipped: z.string().nullable() }),
  execute: async ({ input }) => {
    const parsed = parseInput(inputSchema, input);
    const settings = await getSettings();
    if (!settings.preferences.stalledEnabled) return { checked: 0, stalled: 0, skipped: 'Stalled deals are switched off in Settings → General' };
    const today = parsed.today ?? todayIn(settings.timezone);

    // `stageEnteredAt` is a timestamp; cast the day before subtracting or the
    // comparison silently never matches live.
    const { rows } = await zite.sql({
      query: `
        SELECT d.id, d."name"
        FROM "Deals" d
        JOIN "Stages" s ON s.id::text = d."stageId"
        WHERE d."status" = 'Open'
          AND COALESCE(d."archived", false) = false
          AND s."kind" = 'Open'
          AND COALESCE(s."rottingDays", 0) > 0
          AND d."stageEnteredAt" IS NOT NULL
          AND d."stageEnteredAt"::date <= ($1::date - s."rottingDays"::int)
        ORDER BY d."stageEnteredAt" ASC
        LIMIT $2`,
      params: [today, parsed.limit ?? 200],
    });

    let stalled = 0;
    // Sequential on purpose: each trigger writes, and live Zite rate-limits bursts.
    for (const row of rows) {
      await runTrigger('deal.stalled', { entityType: 'deal', entityId: String(row.id), actorId: null });
      stalled++;
    }
    return { checked: num(rows.length), stalled, skipped: null };
  },
});
