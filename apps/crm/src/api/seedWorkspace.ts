import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { getActor } from '@project/shared/server/actor';
import { hasOwnRecords, LOAD_DEADLINE_MS, nextSeededAt, sampleLoaded } from '@project/shared/server/demo';
import { getSettings, updateSettings } from '@project/shared/server/settings';
import { seedContext, SEED_PHASES } from '../seed';
import { parseInput } from '../server/input';

/**
 * Loads the sample organization when an admin asks for it from Settings →
 * Sample data. Nothing calls this on its own.
 *
 * It runs in phases so no single call runs long. The first call stamps
 * `seededAt` and returns it with the next phase; the client passes both back
 * as `resume` until `done` is true. A call without `resume` is refused once the
 * sample is loaded or the workspace has companies, contacts, deals or leads of
 * its own, so a stray second call can never load it twice or mix it into real
 * work.
 */

const inputSchema = z.object({ resume: z.object({ seededAt: z.string(), phase: z.string() }).optional() });

export default createEndpoint({
  description: 'Load the sample organization into an empty workspace (runs in phases; call until done)',
  authenticated: true,
  inputSchema,
  outputSchema: z.object({ done: z.boolean(), seededAt: z.string(), phase: z.string().nullable(), label: z.string().nullable(), ran: z.array(z.string()) }),
  execute: async ({ input, context }) => {
    const { resume } = parseInput(inputSchema, input);
    const actor = await getActor(context);
    if (actor.role !== 'Admin') throw new ZiteError('Only an admin can load the sample data', 'FORBIDDEN');
    let settings = await getSettings();

    let from = 0;
    if (resume) {
      // Carrying on a load this admin started: same stamp, still inside the window.
      const stamped = settings.seededAt ? Date.parse(settings.seededAt) : NaN;
      if (!sampleLoaded(settings) || Number.isNaN(stamped) || Math.abs(stamped - Date.parse(resume.seededAt)) > 1000) {
        throw new ZiteError('That sample data load is no longer running. Reload the page to see where it got to.', 'CONFLICT');
      }
      if (Date.now() - stamped > LOAD_DEADLINE_MS) {
        throw new ZiteError('Loading the sample data took too long to finish. Remove what was loaded from Settings → Sample data, then load it again.', 'CONFLICT');
      }
      from = SEED_PHASES.findIndex(p => p.key === resume.phase);
      if (from < 0) throw new ZiteError('That isn’t a step of the sample data', 'BAD_REQUEST');
    } else {
      if (sampleLoaded(settings)) throw new ZiteError('The sample data is already loaded. Remove it from Settings → Sample data before loading it again.', 'CONFLICT');
      if (await hasOwnRecords()) {
        throw new ZiteError('This workspace already has companies, contacts, deals or leads of its own, so the sample data can’t be loaded into it.', 'CONFLICT');
      }
      // The stamp comes first: every row the seed writes from here on falls
      // inside the window a later removal uses to find them, and every row
      // already here falls outside it.
      const seededAt = await nextSeededAt();
      await updateSettings(settings.id, { seededAt, demoRemovedAt: null });
      settings = { ...settings, seededAt, demoRemovedAt: null };
    }

    const seededAt = settings.seededAt as string;
    const ctx = seedContext(actor, settings);
    const started = Date.now();
    const ran: string[] = [];
    for (let index = from; index < SEED_PHASES.length; index++) {
      const phase = SEED_PHASES[index];
      await phase.run(ctx);
      ran.push(phase.key);
      const next = SEED_PHASES[index + 1];
      if (next && Date.now() - started > 18_000) return { done: false, seededAt, phase: next.key, label: next.label, ran };
    }
    return { done: true, seededAt, phase: null, label: null, ran };
  },
});
