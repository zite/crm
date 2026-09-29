import { zite } from 'zitejs/db';
import { getSettings, updateSettings, type LeadRouting, type OrgSettings } from './settings';
import { num, withRetry } from './sql';
import { ensureStartingPoint } from './starter';

/**
 * Loading and removing the sample organization.
 *
 * A fresh install starts empty. An admin can load a made-up company from
 * Settings → Sample data to see the app with work in it, and take it out again
 * once they have seen enough. "Clean" is harder than "delete everything": by
 * the time they press the button they may have added a few real records of
 * their own, logged a call on a sample deal or renamed the organization.
 *
 * The rules, in one place:
 *
 *   - **When it can be loaded.** Only while it isn't already loaded and the
 *     workspace has no companies, contacts, deals or leads of its own.
 *   - **What counts as sample data.** The seed backdates business dates but not
 *     `created_at`, so every sample row is written in the minutes after
 *     `seededAt`. Anything created from a minute before `seededAt` (clock skew
 *     between the endpoint and the database) to fifteen minutes after it is
 *     sample data. Rows that existed before the sample was loaded stay.
 *   - **Children of sample parents go too**, whatever their own age: a note
 *     someone logged this morning on a sample deal is sample data, and a contact
 *     added under a sample company has nowhere to live once it is gone.
 *   - **Children before parents.** Each step only depends on tables that are
 *     still there, so an interrupted run picks up exactly where it stopped.
 *   - **Teammates are only removed** when their address is a reserved example
 *     domain, they were created in the window, and they are not the person
 *     doing the removing.
 *   - **Settings the admin has changed are kept.** The organization's name,
 *     address and footer are only cleared while they still read exactly what
 *     the sample wrote, and only if nobody has saved General settings since.
 */

const WINDOW_MINUTES = 15;
/** How far before `seededAt` a sample row may be stamped: clock skew between the endpoint and the database. */
const SKEW_MINUTES = 1;

/**
 * Addresses the template invents for its demo teammates: the reserved domains
 * RFC 2606 sets aside, which no real inbox can use. Bound as `$4`, in POSIX
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
 * The plan, as SQL. `$1` and `$2` are the window's start and end, `$3` the
 * acting admin's id. Every selector reads "rows the seed made, plus rows that
 * hang off one".
 */
function steps(): DemoStep[] {
  const inWindow = `created_at >= $1 AND created_at <= $2`;
  const seeded = (table: string) => `SELECT id::text FROM "${table}" WHERE ${inWindow}`;
  const companies = seeded('Companies');
  const contacts = `SELECT id::text FROM "Contacts" WHERE (${inWindow}) OR "companyId" IN (${companies})`;
  const leads = seeded('Leads');
  const deals = `SELECT id::text FROM "Deals" WHERE (${inWindow}) OR "companyId" IN (${companies}) OR "contactId" IN (${contacts})`;
  const quotes = `SELECT id::text FROM "Quotes" WHERE (${inWindow}) OR "dealId" IN (${deals})`;
  const sequences = seeded('Sequences');
  const forms = seeded('Forms');
  const automations = seeded('Automations');
  const pipelines = seeded('Pipelines');
  const members = `SELECT id::text FROM "Members" WHERE ${inWindow} AND id::text <> $3 AND "email" ~* $4`;
  const linked = (prefix = '') =>
    `${prefix}"dealId" IN (${deals}) OR ${prefix}"contactId" IN (${contacts}) OR ${prefix}"companyId" IN (${companies}) OR ${prefix}"leadId" IN (${leads})`;

  return [
    { table: 'AutomationRuns', label: 'automation runs', client: 'automationRuns', ids: `SELECT id::text FROM "AutomationRuns" WHERE (${inWindow}) OR "automationId" IN (${automations})` },
    { table: 'Enrollments', label: 'sequence enrollments', client: 'enrollments', ids: `SELECT id::text FROM "Enrollments" WHERE (${inWindow}) OR "sequenceId" IN (${sequences}) OR "contactId" IN (${contacts}) OR "dealId" IN (${deals})` },
    { table: 'Submissions', label: 'form submissions', client: 'submissions', ids: `SELECT id::text FROM "Submissions" WHERE (${inWindow}) OR "formId" IN (${forms}) OR "leadId" IN (${leads}) OR "contactId" IN (${contacts})` },
    { table: 'LineItems', label: 'line items', client: 'lineItems', ids: `SELECT id::text FROM "LineItems" WHERE (${inWindow}) OR "dealId" IN (${deals})` },
    { table: 'Quotes', label: 'quotes', client: 'quotes', ids: quotes },
    { table: 'DealContacts', label: 'deal contacts', client: 'dealContacts', ids: `SELECT id::text FROM "DealContacts" WHERE (${inWindow}) OR "dealId" IN (${deals}) OR "contactId" IN (${contacts})` },
    { table: 'StageChanges', label: 'stage history', client: 'stageChanges', ids: `SELECT id::text FROM "StageChanges" WHERE (${inWindow}) OR "dealId" IN (${deals})` },
    { table: 'Activities', label: 'activities', client: 'activities', ids: `SELECT id::text FROM "Activities" WHERE (${inWindow}) OR ${linked()}` },
    { table: 'Tasks', label: 'tasks', client: 'tasks', ids: `SELECT id::text FROM "Tasks" WHERE (${inWindow}) OR ${linked()}` },
    // `settings.updated` events are exempt: they are how we know the admin has
    // made the organization their own, and the run below re-reads them after
    // deleting. Purging them would make the answer change mid-removal.
    { table: 'Events', label: 'record history', client: 'events', ids: `SELECT id::text FROM "Events" WHERE "kind" <> 'settings.updated' AND ((${inWindow}) OR ${linked()})` },
    { table: 'Documents', label: 'files', client: 'documents', ids: `SELECT id::text FROM "Documents" WHERE (${inWindow}) OR ${linked()}` },
    {
      table: 'Notifications',
      label: 'inbox items',
      client: 'notifications',
      ids: `SELECT id::text FROM "Notifications" WHERE (${inWindow}) OR "recipientId" IN (${members}) OR "entityId" IN (${deals}) OR "entityId" IN (${leads}) OR "entityId" IN (${contacts}) OR "entityId" IN (${companies})`,
    },
    { table: 'Quotas', label: 'quotas', client: 'quotas', ids: `SELECT id::text FROM "Quotas" WHERE (${inWindow}) OR "memberId" IN (${members})` },
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
    { table: 'Stages', label: 'stages', client: 'stages', ids: `SELECT id::text FROM "Stages" WHERE (${inWindow}) OR "pipelineId" IN (${pipelines})` },
    { table: 'Pipelines', label: 'pipelines', client: 'pipelines', ids: pipelines },
    { table: 'CustomFields', label: 'custom fields', client: 'customFields', ids: seeded('CustomFields') },
    { table: 'Choices', label: 'list values', client: 'choices', ids: seeded('Choices') },
    { table: 'Tags', label: 'tags', client: 'tags', ids: seeded('Tags') },
    { table: 'Teams', label: 'teams', client: 'teams', ids: seeded('Teams') },
    { table: 'Members', label: 'sample teammates', client: 'members', ids: members },
  ];
}

type Window = { from: string; to: string };

/** Only the teammate selector binds the actor and the reserved-domain pattern; the rest take the window alone. */
const paramsFor = (sql: string, window: Window, actorId: string) => (sql.includes('$3') ? [window.from, window.to, actorId, RESERVED_EMAIL] : [window.from, window.to]);

export type DemoCount = { table: string; label: string; count: number };
export type DemoPlan = { seededAt: string | null; cutoff: string | null; counts: DemoCount[]; total: number; keepsSettings: boolean };

/** The span of `created_at` that counts as sample data, or null if it was never loaded. */
export function windowFrom(seededAt: string | null): Window | null {
  if (!seededAt) return null;
  const t = Date.parse(seededAt);
  if (Number.isNaN(t)) return null;
  return { from: new Date(t - SKEW_MINUTES * 60_000).toISOString(), to: new Date(t + WINDOW_MINUTES * 60_000).toISOString() };
}

/**
 * The moment to stamp as `seededAt` when a load starts. Usually now. But a row
 * written in the minute before (the starter pipeline a fresh install makes on
 * its first open, a tag added a moment ago) would sit inside the window's
 * allowance for clock skew and be taken for sample data. So the stamp moves
 * past it, to a minute after the newest row already here, and everything that
 * existed before the load stays out of the window.
 */
export async function nextSeededAt() {
  const tables = [...new Set(steps().map(s => s.table))];
  const { rows } = await zite.sql({
    // Epoch milliseconds, rounded up, so the answer doesn't depend on how a timestamp is printed.
    query: `SELECT CEIL(EXTRACT(EPOCH FROM MAX("at")) * 1000) AS "newest" FROM (${tables.map(t => `SELECT MAX(created_at) AS "at" FROM "${t}"`).join(' UNION ALL ')}) AS latest`,
    params: [],
  });
  const newest = num(rows[0]?.newest, 0);
  return new Date(Math.max(Date.now(), newest + SKEW_MINUTES * 60_000 + 1)).toISOString();
}

/** A phased load has to finish inside the window, or its last rows could not be told apart from real ones. */
export const LOAD_DEADLINE_MS = (WINDOW_MINUTES - 5) * 60_000;

/** The sample is loaded from the moment `seededAt` is stamped until a removal finishes after it. */
export function sampleLoaded(settings: Pick<OrgSettings, 'seededAt' | 'demoRemovedAt'>) {
  if (!settings.seededAt) return false;
  if (!settings.demoRemovedAt) return true;
  return Date.parse(settings.demoRemovedAt) < Date.parse(settings.seededAt);
}

/** Companies, contacts, deals and leads are the records that make a workspace someone's own. */
export async function hasOwnRecords() {
  const { rows } = await zite.sql({
    query: `SELECT
      CASE WHEN EXISTS (SELECT 1 FROM "Companies") OR EXISTS (SELECT 1 FROM "Contacts") OR EXISTS (SELECT 1 FROM "Deals") OR EXISTS (SELECT 1 FROM "Leads") THEN 1 ELSE 0 END AS "has"`,
    params: [],
  });
  return num(rows[0]?.has) === 1;
}

/** What the Sample data settings page may offer: remove it while loaded, load it while the workspace is still empty. */
export async function sampleState(settings: Pick<OrgSettings, 'seededAt' | 'demoRemovedAt'>) {
  const loaded = sampleLoaded(settings);
  return { loaded, canLoad: !loaded && !(await hasOwnRecords()) };
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

/**
 * What the seed writes that a removal needs to recognise: the organization's
 * details, so they can be told from the admin's own, and the domain of its
 * sample teammates.
 */
export type SampleOrg = { name: string; address: string; footer: string; domain: string };

/**
 * When the load really began. Workspaces set up before the sample became
 * optional ran the seed on first open, and that seed re-stamped `seededAt` on
 * every phased call, so the stamp can sit a minute or more after the first rows
 * it wrote. Its sample teammates are always the first rows a load writes, so
 * the earliest of them marks the start. A load made since never trips this:
 * its teammates are written after the stamp.
 */
async function loadStart(seededAt: string | null, sampleOrg: SampleOrg): Promise<string | null> {
  const window = windowFrom(seededAt);
  if (!window) return seededAt;
  const { rows } = await zite.sql({
    // Only a few minutes back: that seed never ran longer, and a teammate left
    // over from an earlier load and removal must not stretch this one's window.
    query: `SELECT FLOOR(EXTRACT(EPOCH FROM MIN(created_at)) * 1000) AS "first" FROM "Members" WHERE LOWER("email") LIKE $1 AND created_at < $2 AND created_at >= $3`,
    params: [`%@${sampleOrg.domain.toLowerCase()}`, window.from, new Date(Date.parse(window.from) - WINDOW_MINUTES * 60_000).toISOString()],
  });
  const first = rows[0]?.first;
  return first == null || first === '' ? seededAt : new Date(Number(first)).toISOString();
}

/** What a removal would delete, table by table. Nothing is written. */
export async function planDemoRemoval(actorId: string, sampleOrg: SampleOrg): Promise<DemoPlan> {
  const settings = await getSettings();
  const seededAt = await loadStart(settings.seededAt, sampleOrg);
  const window = windowFrom(seededAt);
  if (!window) return { seededAt, cutoff: null, counts: [], total: 0, keepsSettings: true };
  const counts: DemoCount[] = [];
  let total = 0;
  for (const step of steps()) {
    const { rows } = await zite.sql({ query: `SELECT COUNT(*) AS "n" FROM (${step.ids}) AS demo_rows`, params: paramsFor(step.ids, window, actorId) });
    const n = num(rows[0]?.n);
    total += n;
    if (n > 0) counts.push({ table: step.table, label: step.label, count: n });
  }
  return { seededAt, cutoff: window.to, counts, total, keepsSettings: await settingsChangedSince(window.to) };
}

export type DemoBatch = { done: boolean; deleted: number; remaining: number; label: string | null; failed: number };


/**
 * Delete up to `budget` demo rows, children first, and report what is left.
 * The caller repeats until `done`, so a slow workspace never hits a timeout
 * and an interrupted run resumes without orphaning anything.
 */
export async function removeDemoBatch(actorId: string, sampleOrg: SampleOrg, budget = 300): Promise<DemoBatch> {
  const settings = await getSettings();
  const seededAt = await loadStart(settings.seededAt, sampleOrg);
  const window = windowFrom(seededAt);
  if (!window) return { done: true, deleted: 0, remaining: 0, label: null, failed: 0 };
  // Keep the corrected start, so every later batch uses the same window even
  // once the sample teammates that revealed it are gone.
  if (seededAt && seededAt !== settings.seededAt) await updateSettings(settings.id, { seededAt });

  const plan = steps();
  let deleted = 0;
  let failed = 0;
  let label: string | null = null;

  for (const step of plan) {
    if (deleted >= budget) break;
    const { rows } = await zite.sql({ query: `${step.ids} LIMIT ${Math.max(1, budget - deleted)}`, params: paramsFor(step.ids, window, actorId) });
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
    const { rows } = await zite.sql({ query: `SELECT COUNT(*) AS "n" FROM (${step.ids}) AS demo_rows`, params: paramsFor(step.ids, window, actorId) });
    remaining += num(rows[0]?.n);
  }

  if (remaining <= failed) {
    // The sample's pipelines and lists go with it; a workspace that had nothing
    // else gets the plain starter set back, so it is never left unusable.
    await ensureStartingPoint();
    await finishRemoval(actorId, window.to, sampleOrg);
    return { done: true, deleted, remaining, label, failed };
  }
  return { done: false, deleted, remaining, label, failed };
}

/** Stamp the workspace and put back the settings that only existed to dress the sample. */
async function finishRemoval(actorId: string, cutoff: string, sampleOrg: SampleOrg) {
  const settings = await getSettings();
  const keep = await settingsChangedSince(cutoff);
  const routing: LeadRouting = { ...settings.leadRouting, memberIds: [], memberId: null, cursor: 0 };
  // Anyone in the round-robin pool may have just been deleted, so the pool is rebuilt from who is left.
  const { rows } = await zite.sql({ query: `SELECT id FROM "Members" WHERE "status" <> 'Deactivated'`, params: [] });
  const live = new Set(rows.map(r => String(r.id)));
  routing.memberIds = settings.leadRouting.memberIds.filter(id => live.has(id));
  routing.memberId = settings.leadRouting.memberId && live.has(settings.leadRouting.memberId) ? settings.leadRouting.memberId : null;
  if (!routing.memberIds.length) routing.memberIds = [actorId];

  // The seed numbers its quotes from the counter; with every quote gone the
  // first real one can be the first number again, and never collide.
  const { rows: quotes } = await zite.sql({ query: `SELECT COUNT(*) AS "n" FROM "Quotes"`, params: [] });

  // Never earlier than the stamp (which can sit a little ahead of the clock, see
  // nextSeededAt), or the sample would still read as loaded.
  const seeded = settings.seededAt ? Date.parse(settings.seededAt) : NaN;
  await updateSettings(settings.id, {
    demoRemovedAt: new Date(Number.isNaN(seeded) ? Date.now() : Math.max(Date.now(), seeded + 1)).toISOString(),
    leadRouting: routing,
    // Only what still reads exactly as the sample wrote it: the seed never
    // overwrites details the admin had already set, so neither does this.
    ...(!keep && settings.organizationName === sampleOrg.name ? { organizationName: 'Your organization' } : {}),
    ...(!keep && settings.mailingAddress === sampleOrg.address ? { mailingAddress: '' } : {}),
    ...(!keep && settings.emailFooter === sampleOrg.footer ? { emailFooter: '' } : {}),
    ...(num(quotes[0]?.n) === 0 ? { nextQuoteNumber: 1001 } : {}),
  });
}
