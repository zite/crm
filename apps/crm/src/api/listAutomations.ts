import { z } from 'zod';
import { createEndpoint } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { assertCan, getActor } from '@project/shared/server/actor';
import { loadAutomations } from '@project/shared/server/automationsEngine';
import { str } from '@project/shared/server/sql';
import { parseInput } from '../server/input';

/**
 * Every automation, with the names its builder needs to render itself as a
 * sentence: the templates and sequences its actions point at, so a rule can
 * read "…and enroll them in Founder outbound" rather than showing an id.
 */

const automation = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  trigger: z.string(),
  conditions: z.array(z.object({ field: z.string(), op: z.string(), value: z.string() })),
  actions: z.array(z.record(z.any())),
  active: z.boolean(),
  ownerId: z.string().nullable(),
  runCount: z.number(),
  lastRunAt: z.string().nullable(),
});

export default createEndpoint({
  description: 'List the organization’s automations, with the templates and sequences their actions can point at',
  authenticated: true,
  inputSchema: z.object({}),
  outputSchema: z.object({
    automations: z.array(automation),
    templates: z.array(z.object({ id: z.string(), name: z.string() })),
    sequences: z.array(z.object({ id: z.string(), name: z.string(), status: z.string() })),
    activeCount: z.number(),
  }),
  execute: async ({ input, context }) => {
    parseInput(z.object({}), input);
    const actor = await getActor(context);
    assertCan(actor, 'settings.manage');

    const [automations, templates, sequences] = await Promise.all([
      loadAutomations(),
      zite.sql({ query: `SELECT id, "name" FROM "EmailTemplates" WHERE COALESCE("archived", false) = false ORDER BY "name"`, params: [] }),
      zite.sql({ query: `SELECT id, "name", "status" FROM "Sequences" WHERE "status" <> 'Archived' ORDER BY "name"`, params: [] }),
    ]);

    return {
      automations: automations.map(a => ({
        id: a.id,
        name: a.name,
        description: a.description,
        trigger: a.trigger,
        conditions: a.conditions,
        actions: a.actions as unknown as Array<Record<string, unknown>>,
        active: a.active,
        ownerId: a.ownerId,
        runCount: a.runCount,
        lastRunAt: a.lastRunAt,
      })),
      templates: templates.rows.map(r => ({ id: String(r.id), name: str(r.name) ?? '' })),
      sequences: sequences.rows.map(r => ({ id: String(r.id), name: str(r.name) ?? '', status: str(r.status) || 'Active' })),
      activeCount: automations.filter(a => a.active).length,
    };
  },
});
