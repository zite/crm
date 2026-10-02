import { zite } from 'zitejs/db';
import { isDemo } from './demoPreview';
import { num, withRetry } from './sql';

/**
 * The minimum a workspace needs to be usable: one pipeline to hold a deal, and
 * the lost, disqualify and lead-source lists that closing a deal or a lead
 * asks for.
 *
 * A fresh install gets this on its first bootstrap, and removing the sample
 * data puts it back if the sample's own pipelines and lists were all that was
 * there. Each part is only written when its table is empty, so running it
 * again changes nothing.
 */
export async function ensureStartingPoint() {
  if (isDemo()) return;
  const { rows: pipes } = await zite.sql({ query: `SELECT COUNT(*) AS "n" FROM "Pipelines"`, params: [] });
  if (num(pipes[0]?.n) === 0) {
    const pipeline = await withRetry(() => zite.pipelines.create({ record: { name: 'Sales', description: 'Your first pipeline. Rename its stages to match how you sell.', position: 0, isDefault: true, archived: false } }));
    await zite.stages.bulkCreate({
      records: [
        { name: 'Qualify', pipelineId: pipeline.id, position: 0, probability: 20, kind: 'Open', rottingDays: 14, guidance: 'What are they trying to fix, and what happens if they don’t?', archived: false },
        { name: 'Proposal', pipelineId: pipeline.id, position: 1, probability: 50, kind: 'Open', rottingDays: 14, guidance: 'Who signs, and what do they need to see first?', archived: false },
        { name: 'Negotiation', pipelineId: pipeline.id, position: 2, probability: 75, kind: 'Open', rottingDays: 10, guidance: 'Agree the terms and the start date.', archived: false },
        { name: 'Won', pipelineId: pipeline.id, position: 3, probability: 100, kind: 'Won', rottingDays: null, guidance: null, archived: false },
        { name: 'Lost', pipelineId: pipeline.id, position: 4, probability: 0, kind: 'Lost', rottingDays: null, guidance: null, archived: false },
      ],
    });
  } else {
    // A pipeline set with no default (the default went with the sample data)
    // falls back to the first one, so make that explicit where it is shown.
    const { rows: defaults } = await zite.sql({ query: `SELECT 1 FROM "Pipelines" WHERE COALESCE("isDefault", false) = true AND COALESCE("archived", false) = false LIMIT 1`, params: [] });
    if (!defaults.length) {
      const { rows: first } = await zite.sql({ query: `SELECT id FROM "Pipelines" WHERE COALESCE("archived", false) = false ORDER BY COALESCE("position", 0), created_at LIMIT 1`, params: [] });
      if (first[0]) await withRetry(() => zite.pipelines.update({ id: String(first[0].id), record: { isDefault: true } }));
    }
  }

  const { rows: choices } = await zite.sql({ query: `SELECT COUNT(*) AS "n" FROM "Choices"`, params: [] });
  if (num(choices[0]?.n) === 0) {
    await zite.choices.bulkCreate({
      records: [
        ...['Price', 'Chose a competitor', 'No budget', 'No decision', 'Bad timing'].map((label, i) => ({ label, list: 'Lost Reason', position: i, archived: false })),
        ...['Not a fit', 'No budget', 'Duplicate', 'Spam', 'Unresponsive'].map((label, i) => ({ label, list: 'Disqualify Reason', position: i, archived: false })),
        ...['Website form', 'Referral', 'Event', 'Outbound', 'Partner'].map((label, i) => ({ label, list: 'Lead Source', position: i, archived: false })),
      ],
    });
  }
}
