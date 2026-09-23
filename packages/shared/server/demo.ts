import { zite } from 'zitejs/db';
import { DEFAULT_BRAND, getSettings, updateSettings, type LeadRouting } from './settings';
import { num, withRetry } from './sql';

/**
 * Taking the demo organization out of a real workspace.
 *
 * The template ships with a fake company so the app looks alive on the first
 * open. A team that decides to keep it needs a clean way out, and "clean" is
 * harder than "delete everything": by the time they press the button they have
 * usually added a few real records of their own, and may have logged a call on
 * a demo deal or renamed the organization.
 *
 * The rules, in one place:
 *
 *   - **What counts as demo.** The seed backdates business dates but not
 *     `created_at`, so every seeded row was written within a few minutes of
 *     `seededAt`. Anything with `created_at <= seededAt + 15 minutes` is demo.
 *   - **Children of demo parents go too**, whatever their own age — a note
 *     someone logged this morning on a demo deal is demo data, and a contact
 *     added under a demo company has nowhere to live once it is gone.
 *   - **Children before parents.** Each step only depends on tables that are
 *     still there, so an interrupted run picks up exactly where it stopped.
 *   - **Teammates are only removed** when their address is a reserved example
 *     domain, they were created in the window, and they are not the person
 *     doing the removing.
 *   - **Settings the admin has changed are kept.** Changing settings writes a
 *     `settings` event; if there is one after the window, the organization's
 *     own name, address, footer and brand colour stay as they are.
 */

const WINDOW_MINUTES = 15;

/**
 * Addresses the template invents for its demo teammates — the reserved domains
 * RFC 2606 sets aside, which no real inbox can use. Bound as `$3`, in POSIX
 * form for Postgres' `~*`.
 */
const RESERVED_EMAIL = '@([a-z0-9-]+\\.)?(example\\.(com|org|net)|[a-z0-9-]+\\.example|[a-z0-9-]+\\.test|[a-z0-9-]+\\.invalid|localhost)$';

export type DemoStep = { table: string; label: string; ids: string; client: keyof typeof CLIENTS };

const CLIENTS = {
  automationRuns: () => zite.automationRuns,
  enrollments: () => zite.enrollments,
  submissions: () => zite.submissions,
  lineItems: () => zite.lineItems,
  quotes: () => zite.quotes,
  dealContacts: () => zite.dealContacts,
  stageChanges: () => zite.stageChanges,
  activities: () => zite.activities,
  tasks: () => zite.tasks,
  events: () => zite.events,
  documents: () => zite.documents,
  notifications: () => zite.notifications,
  quotas: () => zite.quotas,
  views: () => zite.views,
  imports: () => zite.imports,
  deals: () => zite.deals,
  leads: () => zite.leads,
  contacts: () => zite.contacts,
  companies: () => zite.companies,
  automations: () => zite.automations,
  sequences: () => zite.sequences,
  emailTemplates: () => zite.emailTemplates,
  forms: () => zite.forms,
  bookingPages: () => zite.bookingPages,
  products: () => zite.products,
  stages: () => zite.stages,
  pipelines: () => zite.pipelines,
  customFields: () => zite.customFields,
  choices: () => zite.choices,
  tags: () => zite.tags,
  teams: () => zite.teams,
  members: () => zite.members,
} as const;

/**
 * The plan, as SQL. `$1` is the cutoff timestamp and `$2` the acting admin's
 * id. Every selector reads "rows the seed made, plus rows that hang off one".
 */
function steps(): DemoStep[] {
  const seeded = (table: string) => `SELECT id::text FROM "${table}" WHERE created_at <= $1`;
  const companies = seeded('Companies');
  const contacts = `SELECT id::text FROM "Contacts" WHERE created_at <= $1 OR "companyId" IN (${companies})`;
  const leads = seeded('Leads');
  const deals = `SELECT id::text FROM "Deals" WHERE created_at <= $1 OR "companyId" IN (${companies}) OR "contactId" IN (${contacts})`;
  const quotes = `SELECT id::text FROM "Quotes" WHERE created_at <= $1 OR "dealId" IN (${deals})`;
  const sequences = seeded('Sequences');
  const forms = seeded('Forms');
  const automations = seeded('Automations');
  const pipelines = seeded('Pipelines');
  const members = `SELECT id::text FROM "Members" WHERE created_at <= $1 AND id::text <> $2 AND "email" ~* $3`;
  const linked = (prefix = '') =>
    `${prefix}"dealId" IN (${deals}) OR ${prefix}"contactId" IN (${contacts}) OR ${prefix}"companyId" IN (${companies}) OR ${prefix}"leadId" IN (${leads})`;

  return [
    { table: 'AutomationRuns', label: 'automation runs', client: 'automationRuns', ids: `SELECT id::text FROM "AutomationRuns" WHERE created_at <= $1 OR "automationId" IN (${automations})` },
    { table: 'Enrollments', label: 'sequence enrollments', client: 'enrollments', ids: `SELECT id::text FROM "Enrollments" WHERE created_at <= $1 OR "sequenceId" IN (${sequences}) OR "contactId" IN (${contacts}) OR "dealId" IN (${deals})` },
    { table: 'Submissions', label: 'form submissions', client: 'submissions', ids: `SELECT id::text FROM "Submissions" WHERE created_at <= $1 OR "formId" IN (${forms}) OR "leadId" IN (${leads}) OR "contactId" IN (${contacts})` },
    { table: 'LineItems', label: 'line items', client: 'lineItems', ids: `SELECT id::text FROM "LineItems" WHERE created_at <= $1 OR "dealId" IN (${deals})` },
    { table: 'Quotes', label: 'quotes', client: 'quotes', ids: quotes },
    { table: 'DealContacts', label: 'deal contacts', client: 'dealContacts', ids: `SELECT id::text FROM "DealContacts" WHERE created_at <= $1 OR "dealId" IN (${deals}) OR "contactId" IN (${contacts})` },
    { table: 'StageChanges', label: 'stage history', client: 'stageChanges', ids: `SELECT id::text FROM "StageChanges" WHERE created_at <= $1 OR "dealId" IN (${deals})` },
    { table: 'Activities', label: 'activities', client: 'activities', ids: `SELECT id::text FROM "Activities" WHERE created_at <= $1 OR ${linked()}` },
    { table: 'Tasks', label: 'tasks', client: 'tasks', ids: `SELECT id::text FROM "Tasks" WHERE created_at <= $1 OR ${linked()}` },
    // `settings.updated` events are exempt: they are how we know the admin has
    // made the organization their own, and the run below re-reads them after
    // deleting. Purging them would make the answer change mid-removal.
    { table: 'Events', label: 'record history', client: 'events', ids: `SELECT id::text FROM "Events" WHERE "kind" <> 'settings.updated' AND (created_at <= $1 OR ${linked()})` },
    { table: 'Documents', label: 'files', client: 'documents', ids: `SELECT id::text FROM "Documents" WHERE created_at <= $1 OR ${linked()}` },
    {
      table: 'Notifications',
      label: 'inbox items',
      client: 'notifications',
      ids: `SELECT id::text FROM "Notifications" WHERE created_at <= $1 OR "recipientId" IN (${members}) OR "entityId" IN (${deals}) OR "entityId" IN (${leads}) OR "entityId" IN (${contacts}) OR "entityId" IN (${companies})`,
    },
    { table: 'Quotas', label: 'quotas', client: 'quotas', ids: `SELECT id::text FROM "Quotas" WHERE created_at <= $1 OR "memberId" IN (${members})` },
    { table: 'Views', label: 'saved views', client: 'views', ids: seeded('Views') },
    { table: 'Imports', label: 'import history', client: 'imports', ids: seeded('Imports') },
    { table: 'Deals', label: 'deals', client: 'deals', ids: deals },
    { table: 'Leads', label: 'leads', client: 'leads', ids: leads },
    { table: 'Contacts', label: 'contacts', client: 'contacts', ids: contacts },
    { table: 'Companies', label: 'companies', client: 'companies', ids: companies },
    { table: 'Automations', label: 'automations', client: 'automations', ids: automations },
    { table: 'Sequences', label: 'sequences', client: 'sequences', ids: sequences },
    { table: 'EmailTemplates', label: 'email templates', client: 'emailTemplates', ids: seeded('EmailTemplates') },
    { table: 'Forms', label: 'forms', client: 'forms', ids: forms },
    { table: 'BookingPages', label: 'meeting links', client: 'bookingPages', ids: seeded('BookingPages') },
    { table: 'Products', label: 'products', client: 'products', ids: seeded('Products') },
    { table: 'Stages', label: 'stages', client: 'stages', ids: `SELECT id::text FROM "Stages" WHERE created_at <= $1 OR "pipelineId" IN (${pipelines})` },
    { table: 'Pipelines', label: 'pipelines', client: 'pipelines', ids: pipelines },
    { table: 'CustomFields', label: 'custom fields', client: 'customFields', ids: seeded('CustomFields') },
    { table: 'Choices', label: 'list values', client: 'choices', ids: seeded('Choices') },
    { table: 'Tags', label: 'tags', client: 'tags', ids: seeded('Tags') },
    { table: 'Teams', label: 'teams', client: 'teams', ids: seeded('Teams') },
    { table: 'Members', label: 'demo teammates', client: 'members', ids: members },
  ];
}

/** Only the teammate selector binds the actor and the reserved-domain pattern; the rest take the cutoff alone. */
const paramsFor = (sql: string, cutoff: string, actorId: string) => (sql.includes('$2') ? [cutoff, actorId, RESERVED_EMAIL] : [cutoff]);

export type DemoCount = { table: string; label: string; count: number };
export type DemoPlan = { seededAt: string | null; cutoff: string | null; counts: DemoCount[]; total: number; keepsSettings: boolean };

export function cutoffFrom(seededAt: string | null) {
  if (!seededAt) return null;
  const t = Date.parse(seededAt);
  return Number.isNaN(t) ? null : new Date(t + WINDOW_MINUTES * 60_000).toISOString();
}

/**
 * Has anyone changed the organization's own settings since the demo was loaded?
 * Only `settings.updated` counts — adding a pipeline or exporting a list also
 * writes against the settings entity, and neither means "this name is ours now".
 */
async function settingsChangedSince(cutoff: string) {
  const { rows } = await zite.sql({ query: `SELECT 1 FROM "Events" WHERE "kind" = 'settings.updated' AND "occurredAt" > $1 LIMIT 1`, params: [cutoff] });
  return rows.length > 0;
}

/** What a removal would delete, table by table. Nothing is written. */
export async function planDemoRemoval(actorId: string): Promise<DemoPlan> {
  const settings = await getSettings();
  const cutoff = cutoffFrom(settings.seededAt);
  if (!cutoff) return { seededAt: settings.seededAt, cutoff: null, counts: [], total: 0, keepsSettings: true };
  const counts: DemoCount[] = [];
  let total = 0;
  for (const step of steps()) {
    const { rows } = await zite.sql({ query: `SELECT COUNT(*) AS "n" FROM (${step.ids}) AS demo_rows`, params: paramsFor(step.ids, cutoff, actorId) });
    const n = num(rows[0]?.n);
    total += n;
    if (n > 0) counts.push({ table: step.table, label: step.label, count: n });
  }
  return { seededAt: settings.seededAt, cutoff, counts, total, keepsSettings: await settingsChangedSince(cutoff) };
}

export type DemoBatch = { done: boolean; deleted: number; remaining: number; label: string | null; failed: number };

/**
 * Delete up to `budget` demo rows, children first, and report what is left.
 * The caller repeats until `done`, so a slow workspace never hits a timeout
 * and an interrupted run resumes without orphaning anything.
 */
export async function removeDemoBatch(actorId: string, budget = 300): Promise<DemoBatch> {
  const settings = await getSettings();
  const cutoff = cutoffFrom(settings.seededAt);
  if (!cutoff) return { done: true, deleted: 0, remaining: 0, label: null, failed: 0 };

  const plan = steps();
  let deleted = 0;
  let failed = 0;
  let label: string | null = null;

  for (const step of plan) {
    if (deleted >= budget) break;
    const { rows } = await zite.sql({ query: `${step.ids} LIMIT ${Math.max(1, budget - deleted)}`, params: paramsFor(step.ids, cutoff, actorId) });
    if (!rows.length) continue;
    label = step.label;
    const client = CLIENTS[step.client]();
    // Sequential on purpose: live Zite rate-limits bursts of parallel writes.
    for (const row of rows) {
      try {
        await withRetry(() => client.delete({ id: String(row.id) }));
        deleted++;
      } catch (err) {
        failed++;
        console.error(`demo removal: ${step.table} ${row.id}`, err instanceof Error ? err.message : err);
      }
    }
  }

  // What is still there after this pass — so the caller can show progress.
  let remaining = 0;
  for (const step of plan) {
    const { rows } = await zite.sql({ query: `SELECT COUNT(*) AS "n" FROM (${step.ids}) AS demo_rows`, params: paramsFor(step.ids, cutoff, actorId) });
    remaining += num(rows[0]?.n);
  }

  if (remaining <= failed) {
    await leaveAStartingPoint();
    await finishRemoval(actorId, cutoff);
    return { done: true, deleted, remaining, label, failed };
  }
  return { done: false, deleted, remaining, label, failed };
}

/**
 * A workspace with no pipeline can't hold a deal, and with no lost reasons
 * can't close one. The demo's pipelines and lists go with the demo, so a plain
 * starter set goes back in their place — the app is never left unusable.
 */
async function leaveAStartingPoint() {
  const { rows: pipes } = await zite.sql({ query: `SELECT COUNT(*) AS "n" FROM "Pipelines"`, params: [] });
  if (num(pipes[0]?.n) === 0) {
    const pipeline = await withRetry(() => zite.pipelines.create({ record: { name: 'Sales', description: 'Your first pipeline — rename its stages to match how you sell.', position: 0, isDefault: true, archived: false } }));
    await zite.stages.bulkCreate({
      records: [
        { name: 'Qualify', pipelineId: pipeline.id, position: 0, probability: 20, kind: 'Open', rottingDays: 14, guidance: 'What are they trying to fix, and what happens if they don’t?', archived: false },
        { name: 'Proposal', pipelineId: pipeline.id, position: 1, probability: 50, kind: 'Open', rottingDays: 14, guidance: 'Who signs, and what do they need to see first?', archived: false },
        { name: 'Negotiation', pipelineId: pipeline.id, position: 2, probability: 75, kind: 'Open', rottingDays: 10, guidance: 'Agree the terms and the start date.', archived: false },
        { name: 'Won', pipelineId: pipeline.id, position: 3, probability: 100, kind: 'Won', rottingDays: null, guidance: null, archived: false },
        { name: 'Lost', pipelineId: pipeline.id, position: 4, probability: 0, kind: 'Lost', rottingDays: null, guidance: null, archived: false },
      ],
    });
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

/** Stamp the workspace and put back the settings that only existed to dress the demo. */
async function finishRemoval(actorId: string, cutoff: string) {
  const settings = await getSettings();
  const keep = await settingsChangedSince(cutoff);
  const routing: LeadRouting = { ...settings.leadRouting, memberIds: [], memberId: null, cursor: 0 };
  // Anyone in the round-robin pool may have just been deleted, so the pool is rebuilt from who is left.
  const { rows } = await zite.sql({ query: `SELECT id FROM "Members" WHERE "status" <> 'Deactivated'`, params: [] });
  const live = new Set(rows.map(r => String(r.id)));
  routing.memberIds = settings.leadRouting.memberIds.filter(id => live.has(id));
  routing.memberId = settings.leadRouting.memberId && live.has(settings.leadRouting.memberId) ? settings.leadRouting.memberId : null;
  if (!routing.memberIds.length) routing.memberIds = [actorId];

  await updateSettings(settings.id, {
    demoRemovedAt: new Date().toISOString(),
    leadRouting: routing,
    ...(keep
      ? {}
      : {
          organizationName: 'Your organization',
          logoUrl: null,
          brandColor: DEFAULT_BRAND,
          mailingAddress: '',
          emailFooter: '',
          nextQuoteNumber: 1001,
        }),
  });
}
