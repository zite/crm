import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { getActor } from '@project/shared/server/actor';
import { getSettings } from '@project/shared/server/settings';
import { seedContext, SEED_PHASES } from '../seed';
import { parseInput } from '../server/input';

/**
 * Loads the demo organization on first open, in phases so no single call runs
 * long. The client calls it until `done` is true. Every phase is idempotent,
 * so a repeated or interrupted run is safe.
 */
export default createEndpoint({
  description: 'Load the demo organization (runs in phases; call until done)',
  authenticated: true,
  inputSchema: z.object({}),
  outputSchema: z.object({ done: z.boolean(), phase: z.string().nullable(), label: z.string().nullable(), ran: z.array(z.string()) }),
  execute: async ({ input, context }) => {
    parseInput(z.object({}), input);
    const actor = await getActor(context);
    if (actor.role !== 'Admin') throw new ZiteError('Only an admin can load the demo data', 'FORBIDDEN');
    const settings = await getSettings();
    if (settings.demoRemovedAt) throw new ZiteError('The demo data was removed from this workspace', 'CONFLICT');

    const ctx = seedContext(actor, settings);
    const started = Date.now();
    const ran: string[] = [];
    for (const [index, phase] of SEED_PHASES.entries()) {
      await phase.run(ctx);
      ran.push(phase.key);
      const next = SEED_PHASES[index + 1];
      if (next && Date.now() - started > 18_000) return { done: false, phase: next.key, label: next.label, ran };
    }
    return { done: true, phase: null, label: null, ran };
  },
});
