import { z } from 'zod';
import { createEndpoint } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { capabilitiesFor, getActor } from '@project/shared/server/actor';
import { loadFieldDefs } from '@project/shared/server/customFields';
import { loadPipelines } from '@project/shared/server/deals';
import { hasOwnRecords, sampleLoaded } from '@project/shared/server/demo';
import { getSettings, updateSettings } from '@project/shared/server/settings';
import { ensureStartingPoint } from '@project/shared/server/starter';
import { bool, iso, json, num, ref, str } from '@project/shared/server/sql';
import { todayIn } from '@project/shared/dates';
import { parseInput } from '../server/input';

/**
 * Everything the app needs before the first screen: who you are, the org,
 * teammates, pipelines and stages, pick lists, tags, custom fields, saved
 * views, and the counts in the top bar. Records themselves load per page.
 *
 * A fresh install has none of it yet. The first call makes the Settings row
 * and the first person's Admin record (getSettings, getActor), and a starter
 * pipeline and pick lists when there are no pipelines at all, so a new admin
 * can create a deal straight away. Pipelines are archived, never deleted, so
 * that only happens once.
 */

const member = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  role: z.string(),
  status: z.string(),
  title: z.string().nullable(),
  teamId: z.string().nullable(),
  color: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  phone: z.string().nullable(),
  timezone: z.string().nullable(),
  lastSeenAt: z.string().nullable(),
});

export default createEndpoint({
  description: 'Load the signed-in teammate, organization settings and reference data',
  authenticated: true,
  inputSchema: z.object({ today: z.string().optional() }),
  outputSchema: z.object({
    me: member.extend({ signature: z.string().nullable(), preferences: z.record(z.any()) }),
    capabilities: z.array(z.string()),
    settings: z.object({
      organizationName: z.string(),
      currency: z.string(),
      timezone: z.string(),
      fiscalYearStartMonth: z.number(),
      logoUrl: z.string().nullable(),
      brandColor: z.string(),
      defaultRole: z.string(),
      pagesUrl: z.string().nullable(),
      emailFooter: z.string(),
      mailingAddress: z.string(),
      nextQuoteNumber: z.number(),
      leadRouting: z.object({ mode: z.string(), memberIds: z.array(z.string()), memberId: z.string().nullable(), cursor: z.number() }),
      quoteDefaults: z.object({ prefix: z.string(), terms: z.string(), taxRate: z.number(), expiryDays: z.number(), buyerNote: z.string() }),
      preferences: z.object({ stalledEnabled: z.boolean(), requireLostReason: z.boolean(), dailyDigest: z.boolean(), leadResponseHours: z.number() }),
      seededAt: z.string().nullable(),
      demoRemovedAt: z.string().nullable(),
    }),
    members: z.array(member),
    teams: z.array(z.object({ id: z.string(), name: z.string(), description: z.string().nullable(), leadId: z.string().nullable(), color: z.string().nullable() })),
    pipelines: z.array(z.object({ id: z.string(), name: z.string(), isDefault: z.boolean(), archived: z.boolean(), position: z.number() })),
    stages: z.array(z.object({ id: z.string(), name: z.string(), pipelineId: z.string(), position: z.number(), probability: z.number(), kind: z.string(), rottingDays: z.number().nullable(), archived: z.boolean() })),
    choices: z.array(z.object({ id: z.string(), label: z.string(), list: z.string(), position: z.number(), archived: z.boolean() })),
    tags: z.array(z.object({ id: z.string(), name: z.string(), color: z.string(), description: z.string().nullable() })),
    customFields: z.array(z.object({ id: z.string(), key: z.string(), label: z.string(), object: z.string(), type: z.string(), options: z.array(z.string()), helpText: z.string().nullable(), required: z.boolean(), position: z.number(), archived: z.boolean() })),
    views: z.array(z.object({ id: z.string(), name: z.string(), scope: z.string(), config: z.record(z.any()), ownerId: z.string().nullable(), shared: z.boolean(), position: z.number() })),
    counts: z.object({ unread: z.number(), newLeads: z.number(), myOpenLeads: z.number(), tasksDue: z.number(), overdue: z.number() }),
    integrations: z.object({ ai: z.boolean(), email: z.boolean() }),
    today: z.string(),
    /** Settings → Sample data: remove the sample while it is loaded, load it while the workspace is still empty. */
    sample: z.object({ loaded: z.boolean(), canLoad: z.boolean() }),
  }),
  execute: async ({ input, context }) => {
    const parsed = parseInput(z.object({ today: z.string().optional() }), input);
    const actor = await getActor(context);
    const settings = await getSettings();
    const today = parsed.today && /^\d{4}-\d{2}-\d{2}$/.test(parsed.today) ? parsed.today : todayIn(settings.timezone);

    const loadChoices = () => zite.sql({ query: `SELECT id, "label", "list", "position", "archived" FROM "Choices" ORDER BY "list", COALESCE("position", 0), "label"`, params: [] });
    const loaded = sampleLoaded(settings);
    const [membersRes, teamsRes, firstPipes, firstChoices, tagsRes, fields, viewsRes, countsRes, ownRecords] = await Promise.all([
      zite.sql({ query: `SELECT * FROM "Members" ORDER BY CASE WHEN "status" = 'Deactivated' THEN 1 ELSE 0 END, "name"`, params: [] }),
      zite.sql({ query: `SELECT id, "name", "description", "leadId", "color" FROM "Teams" ORDER BY "name"`, params: [] }),
      loadPipelines(),
      loadChoices(),
      zite.sql({ query: `SELECT id, "name", "color", "description" FROM "Tags" ORDER BY "name"`, params: [] }),
      loadFieldDefs(undefined, true),
      zite.sql({ query: `SELECT id, "name", "scope", "config", "ownerId", "shared", "position" FROM "Views" WHERE "ownerId" = $1 OR COALESCE("shared", false) = true ORDER BY COALESCE("position", 0), created_at`, params: [actor.id] }),
      zite.sql({
        query: `SELECT
          (SELECT COUNT(*) FROM "Notifications" WHERE "recipientId" = $1 AND "readAt" IS NULL) AS "unreadTotal",
          (SELECT COUNT(*) FROM "Leads" WHERE "status" = 'New') AS "newLeadTotal",
          (SELECT COUNT(*) FROM "Leads" WHERE "ownerId" = $1 AND "status" IN ('New', 'Working')) AS "myLeadTotal",
          (SELECT COUNT(*) FROM "Tasks" WHERE "ownerId" = $1 AND "status" = 'Open' AND "dueDate" <= $2::date) AS "dueTotal",
          (SELECT COUNT(*) FROM "Tasks" WHERE "ownerId" = $1 AND "status" = 'Open' AND "dueDate" < $2::date) AS "overdueTotal"`,
        params: [actor.id, today],
      }),
      // Only needed to decide whether the sample can be loaded, which it can't while it is.
      loaded ? Promise.resolve(true) : hasOwnRecords(),
    ]);

    let pipes = firstPipes;
    let choicesRes = firstChoices;
    if (!pipes.pipelines.length) {
      await ensureStartingPoint();
      [pipes, choicesRes] = await Promise.all([loadPipelines(), loadChoices()]);
      // Round robin with nobody in the rotation is an error on Settings → Lead
      // routing, so the first admin starts as the whole rotation.
      if (actor.role === 'Admin' && !settings.leadRouting.memberIds.length) {
        settings.leadRouting = { ...settings.leadRouting, memberIds: [actor.id] };
        await updateSettings(settings.id, { leadRouting: settings.leadRouting });
      }
    }

    const toMember = (r: Record<string, unknown>) => ({
      id: String(r.id),
      name: str(r.name) ?? '',
      email: str(r.email) ?? '',
      role: str(r.role) || 'Rep',
      status: str(r.status) || 'Active',
      title: str(r.title) || null,
      teamId: ref(r.teamId),
      color: str(r.color) || null,
      avatarUrl: str(r.avatarUrl) || null,
      phone: str(r.phone) || null,
      timezone: str(r.timezone) || null,
      lastSeenAt: iso(r.lastSeenAt),
    });
    const members = membersRes.rows.map(toMember);
    const meRow = membersRes.rows.find(r => String(r.id) === actor.id) ?? { id: actor.id, name: actor.name, email: actor.email, role: actor.role, status: 'Active' };
    const counts = countsRes.rows[0] ?? {};

    return {
      me: { ...toMember(meRow), signature: str(meRow.emailSignature) || null, preferences: json<Record<string, unknown>>(meRow.preferences, {}) },
      capabilities: capabilitiesFor(actor.role),
      settings: {
        organizationName: settings.organizationName,
        currency: settings.currency,
        timezone: settings.timezone,
        fiscalYearStartMonth: settings.fiscalYearStartMonth,
        logoUrl: settings.logoUrl,
        brandColor: settings.brandColor,
        defaultRole: settings.defaultRole,
        pagesUrl: settings.pagesUrl,
        emailFooter: settings.emailFooter,
        mailingAddress: settings.mailingAddress,
        nextQuoteNumber: settings.nextQuoteNumber,
        leadRouting: settings.leadRouting,
        quoteDefaults: settings.quoteDefaults,
        preferences: settings.preferences,
        seededAt: settings.seededAt,
        demoRemovedAt: settings.demoRemovedAt,
      },
      members,
      teams: teamsRes.rows.map(r => ({ id: String(r.id), name: str(r.name) ?? '', description: str(r.description) || null, leadId: ref(r.leadId), color: str(r.color) || null })),
      pipelines: pipes.pipelines,
      stages: pipes.stages,
      choices: choicesRes.rows.map(r => ({ id: String(r.id), label: str(r.label) ?? '', list: str(r.list) ?? '', position: num(r.position), archived: bool(r.archived) })),
      tags: tagsRes.rows.map(r => ({ id: String(r.id), name: str(r.name) ?? '', color: str(r.color) || 'slate', description: str(r.description) || null })),
      customFields: fields,
      views: viewsRes.rows.map(r => ({ id: String(r.id), name: str(r.name) ?? '', scope: str(r.scope) ?? 'Deals', config: json<Record<string, unknown>>(r.config, {}), ownerId: ref(r.ownerId), shared: bool(r.shared), position: num(r.position) })),
      counts: {
        unread: num(counts.unreadTotal),
        newLeads: num(counts.newLeadTotal),
        myOpenLeads: num(counts.myLeadTotal),
        tasksDue: num(counts.dueTotal),
        overdue: num(counts.overdueTotal),
      },
      integrations: { ai: Boolean(process.env.ZITE_ANTHROPIC_ACCESS_TOKEN), email: true },
      today,
      sample: { loaded, canLoad: !loaded && !ownRecords },
    };
  },
});
