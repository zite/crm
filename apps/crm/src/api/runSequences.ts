import { z } from 'zod';
import { createEndpoint } from 'zitejs/backend';
import { assertCan, getActor } from '@project/shared/server/actor';
import { runDueSteps } from '@project/shared/server/sequences';

/**
 * The sender. Every half hour it walks the enrollments whose next step is due,
 * sends what should be sent, creates the tasks a person has to do by hand, and
 * moves each enrollment on. It respects each sequence's weekday and
 * send-window rules, and caps how much one run will do, so a backlog drains
 * over several runs instead of melting one.
 *
 * `context.user` is null on a scheduled run, so this endpoint is open: when
 * someone IS signed in (the "Run due steps now" button) they must be able to
 * manage outreach. It only performs steps that were already due.
 */
export default createEndpoint({
  description: 'Send the sequence steps that are due and create the ones a person has to do',
  inputSchema: z.object({}),
  outputSchema: z.object({
    considered: z.number(),
    sent: z.number(),
    notSent: z.number(),
    tasks: z.number(),
    failed: z.number(),
    exited: z.number(),
    finished: z.number(),
    ranAt: z.string(),
  }),
  schedule: {
    scheduleType: 'recurring',
    schedule: { frequency: 'minutely', interval: 30 },
    timezone: 'America/Los_Angeles',
  },
  execute: async ({ context }) => {
    if (context.user?.email) {
      const actor = await getActor(context);
      assertCan(actor, 'outreach.manage');
    }
    const result = await runDueSteps({ now: new Date() });
    return { ...result, ranAt: new Date().toISOString() };
  },
});
