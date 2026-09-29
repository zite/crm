import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { assertCan, getActor } from '@project/shared/server/actor';
import { planDemoRemoval, removeDemoBatch, sampleLoaded, type DemoCount } from '@project/shared/server/demo';
import { logEvent } from '@project/shared/server/events';
import { getSettings } from '@project/shared/server/settings';
import { ORG } from '../seed/data';
import { parseInput } from '../server/input';

/**
 * Take the sample organization out of this workspace.
 *
 * `dryRun` reports exactly what would go, table by table, so the confirmation
 * can state real numbers instead of a warning. A real run deletes in batches,
 * children before parents, and returns `done: false` until there is nothing
 * left. The caller simply calls again, so a big workspace never runs into a
 * request timeout and an interrupted run resumes cleanly.
 */

const inputSchema = z.object({ dryRun: z.boolean().optional(), confirm: z.boolean().optional() });

const SAMPLE_ORG = { name: ORG.name, address: ORG.address, footer: ORG.footer, domain: ORG.domain };

/** Named so both branches return the same shape — an untyped `[]` would narrow the caller's type to never[]. */
const noCounts: DemoCount[] = [];

export default createEndpoint({
  description: 'Remove the seeded demo organization, or report what removing it would delete',
  authenticated: true,
  inputSchema,
  outputSchema: z.object({
    dryRun: z.boolean(),
    done: z.boolean(),
    seededAt: z.string().nullable(),
    cutoff: z.string().nullable(),
    total: z.number(),
    remaining: z.number(),
    deleted: z.number(),
    failed: z.number(),
    label: z.string().nullable(),
    keepsSettings: z.boolean(),
    counts: z.array(z.object({ table: z.string(), label: z.string(), count: z.number() })),
  }),
  execute: async ({ input, context }) => {
    const { dryRun, confirm } = parseInput(inputSchema, input);
    const actor = await getActor(context);
    assertCan(actor, 'settings.manage');

    const settings = await getSettings();
    if (!settings.seededAt) throw new ZiteError('The sample data was never loaded into this workspace', 'CONFLICT');

    if (dryRun !== false) {
      const plan = await planDemoRemoval(actor.id, SAMPLE_ORG);
      return { dryRun: true, done: plan.total === 0, seededAt: plan.seededAt, cutoff: plan.cutoff, total: plan.total, remaining: plan.total, deleted: 0, failed: 0, label: null, keepsSettings: plan.keepsSettings, counts: plan.counts };
    }

    if (!confirm) throw new ZiteError('Confirm the removal before it runs', 'BAD_REQUEST');
    if (!sampleLoaded(settings)) return { dryRun: false, done: true, seededAt: settings.seededAt, cutoff: null, total: 0, remaining: 0, deleted: 0, failed: 0, label: null, keepsSettings: true, counts: noCounts };

    const batch = await removeDemoBatch(actor.id, SAMPLE_ORG);
    if (batch.done) {
      await logEvent({ kind: 'settings.demo_removed', entity: { type: 'settings', id: settings.id }, actorId: actor.id, summary: 'removed the demo data from this workspace' });
    }
    return {
      dryRun: false,
      done: batch.done,
      seededAt: settings.seededAt,
      cutoff: null,
      total: batch.deleted + batch.remaining,
      remaining: batch.remaining,
      deleted: batch.deleted,
      failed: batch.failed,
      label: batch.label,
      keepsSettings: true,
      counts: noCounts,
    };
  },
});
