import { zite } from 'zitejs/db';
import type { SeedPhase } from './core';

/**
 * Three automations a real team would keep, switched on, plus enough of a run
 * log that the page isn't an empty table on the first open.
 *
 * They are deliberately the boring, useful kind: a handoff task when a deal is
 * won, a same-day call when a good lead comes in through a form, and a nudge
 * to send the quote when a deal reaches Proposal. Nothing here emails a
 * stranger — the demo data must never generate real mail.
 */

const AUTOMATIONS = [
  {
    name: 'Hand off every win',
    description: 'A won deal needs someone to pick it up before the buyer wonders what happens next.',
    trigger: 'deal.won',
    conditions: [] as Array<Record<string, unknown>>,
    actions: [{ type: 'createTask', title: 'Hand off to onboarding', taskType: 'To-do', priority: 'High', dueInDays: 1, memberId: 'owner' }],
  },
  {
    name: 'Call a hot form lead today',
    description: 'A lead who scores 65 or more gets a call the same day, and their owner hears about it.',
    trigger: 'form.submitted',
    conditions: [{ field: 'leadScore', op: 'gte', value: '65' }],
    actions: [
      { type: 'notify', memberId: 'owner', message: 'A form lead worth calling today came in' },
      { type: 'createTask', title: 'Call the new lead today', taskType: 'Call', priority: 'High', dueInDays: 0, memberId: 'owner' },
    ],
  },
  {
    name: 'Send the quote at Proposal',
    description: 'A deal that reaches Proposal without a quote is a deal that stalls there.',
    trigger: 'deal.stage_changed',
    conditions: [] as Array<Record<string, unknown>>,
    actions: [{ type: 'createTask', title: 'Send the quote', taskType: 'Email', priority: 'Normal', dueInDays: 1, memberId: 'owner' }],
  },
];

export const seedAutomations: SeedPhase = {
  key: 'automations',
  label: 'automations',
  run: async ({ actor }) => {
    const existing = await zite.automations.findAll({ limit: 1 });
    if (existing.records.length) return;

    // The third rule only fires on one stage, so it needs that stage's id.
    const { rows: stages } = await zite.sql({
      query: `SELECT s.id FROM "Stages" s JOIN "Pipelines" p ON p.id::text = s."pipelineId" WHERE s."name" = 'Proposal' AND COALESCE(p."isDefault", false) = true LIMIT 1`,
      params: [],
    });
    const proposalStageId = stages[0] ? String(stages[0].id) : null;

    const records = AUTOMATIONS.map(a => ({
      name: a.name,
      description: a.description,
      trigger: a.trigger,
      conditions: JSON.stringify(a.name === 'Send the quote at Proposal' && proposalStageId ? [{ field: 'stage', op: 'is', value: proposalStageId }] : a.conditions),
      actions: JSON.stringify(a.actions),
      active: true,
      ownerId: actor.id,
      runCount: 0,
      lastRunAt: null,
    }));
    // The Proposal rule needs a stage to watch; without one it would fire on every move.
    const usable = records.filter(r => r.name !== 'Send the quote at Proposal' || proposalStageId);
    const created = await zite.automations.bulkCreate({ records: usable });

    /* A short run log, so the page opens on something rather than an empty state. */
    const wonRule = created.records.find((_, i) => usable[i].trigger === 'deal.won');
    if (!wonRule) return;
    const { rows: wins } = await zite.sql({
      query: `SELECT d.id, d."name" FROM "Deals" d WHERE d."status" = 'Won' ORDER BY d."closedAt" DESC NULLS LAST LIMIT 2`,
      params: [],
    });
    if (!wins.length) return;
    const runs = wins.map((w, i) => ({
      automationId: wonRule.id,
      entityType: 'deal',
      entityId: String(w.id),
      status: 'Succeeded',
      detail: `${String(w.name)}: created the task “Hand off to onboarding”`,
      // Deterministic: two and five days back, not a random walk.
      ranAt: new Date(Date.now() - (i === 0 ? 2 : 5) * 86_400_000).toISOString(),
    }));
    await zite.automationRuns.bulkCreate({ records: runs });
    await zite.automations.update({ id: wonRule.id, record: { runCount: runs.length, lastRunAt: runs[0].ranAt } });
  },
};

/** Demo data for the settings area. Owned by that area — see BRIEF.md. */
export const SETTINGS_PHASES: SeedPhase[] = [seedAutomations];
