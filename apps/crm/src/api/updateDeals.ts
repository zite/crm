import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { assertCan, getActor } from '@project/shared/server/actor';
import { loadPipelines, updateDeal } from '@project/shared/server/deals';
import { getSettings } from '@project/shared/server/settings';
import { DEAL_TYPES, FORECAST_CATEGORIES } from '@project/shared/constants';
import { todayIn } from '@project/shared/dates';
import { customValues, day, id, money, parseInput, tagIds } from '../server/input';

const patchSchema = z
  .object({
    name: z.string().trim().min(1).max(240),
    companyId: id.nullable(),
    contactId: id.nullable(),
    pipelineId: id,
    stageId: id,
    ownerId: id.nullable(),
    amount: money.nullable(),
    closeDate: day.nullable(),
    probability: z.number().min(0).max(100).nullable(),
    forecastCategory: z.enum(FORECAST_CATEGORIES).nullable(),
    type: z.enum(DEAL_TYPES).nullable(),
    source: z.string().max(120).nullable(),
    nextStep: z.string().max(240).nullable(),
    description: z.string().max(20_000).nullable(),
    lostReason: z.string().max(120).nullable(),
    closeNote: z.string().max(5000).nullable(),
    tagIds: tagIds,
    /** Add/remove tags without replacing the list (bulk edits). */
    addTagIds: tagIds,
    removeTagIds: tagIds,
    customFields: customValues,
    position: z.number().finite(),
    archived: z.boolean(),
  })
  .partial();

const inputSchema = z.object({ ids: z.array(id).min(1).max(500), patch: patchSchema, today: z.string().optional() });

export default createEndpoint({
  description: 'Change one or more deals: stage (won/lost), owner, amount, dates, fields, tags, board position',
  authenticated: true,
  inputSchema,
  outputSchema: z.object({ updated: z.number(), failed: z.array(z.object({ id: z.string(), message: z.string() })) }),
  execute: async ({ input, context }) => {
    const { ids, patch, today: t } = parseInput(inputSchema, input);
    const actor = await getActor(context);
    assertCan(actor, 'records.edit');
    if (!Object.keys(patch).length) throw new ZiteError('Nothing to change', 'BAD_REQUEST');
    const settings = await getSettings();
    const pipelines = await loadPipelines();
    const today = t && /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : todayIn(settings.timezone);
    const failed: Array<{ id: string; message: string }> = [];
    let updated = 0;
    // Sequential: live Zite rate-limits bursts of parallel writes.
    for (const dealId of ids) {
      try {
        const { addTagIds, removeTagIds, ...rest } = patch;
        let tagPatch = rest.tagIds;
        if (addTagIds || removeTagIds) {
          const { zite } = await import('zitejs/db');
          const current = await zite.deals.findOne({ id: dealId });
          const set = new Set<string>((() => { try { return JSON.parse(current?.tagIds || '[]'); } catch { return []; } })());
          addTagIds?.forEach(x => set.add(x));
          removeTagIds?.forEach(x => set.delete(x));
          tagPatch = [...set];
        }
        await updateDeal(actor, dealId, { ...rest, ...(tagPatch ? { tagIds: tagPatch } : {}) }, { today, settings, pipelines });
        updated++;
      } catch (e) {
        if (ids.length === 1) throw e;
        failed.push({ id: dealId, message: e instanceof Error ? e.message : 'Couldn’t update this deal' });
      }
    }
    return { updated, failed };
  },
});
