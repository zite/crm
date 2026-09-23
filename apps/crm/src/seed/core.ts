import { zite } from 'zitejs/db';
import type { Actor } from '@project/shared/server/actor';
import { colorFor } from '@project/shared/server/actor';
import { getSettings, updateSettings, type OrgSettings } from '@project/shared/server/settings';
import { chunked, str, withRetry } from '@project/shared/server/sql';
import { periodStart, todayIn } from '@project/shared/dates';
import { scoreLead } from '@project/shared/leads';
import { randomToken, slugify } from '@project/shared/tokens';
import { addDays, chance, int, makeRng, pastIso, pick, pickWeighted, sample, type Rng } from './rng';
import {
  CALL_NOTES,
  COMPANIES,
  DISQUALIFY_REASONS,
  EMAIL_BODIES,
  EMAIL_SUBJECTS,
  FIRST_NAMES,
  INDUSTRIES,
  LAST_NAMES,
  LEAD_COMPANIES,
  LEAD_MESSAGES,
  LEAD_SOURCES,
  LEAD_TITLES,
  LOST_REASONS,
  MEETING_NOTES,
  MEMBERS,
  NOTE_BODIES,
  ORG,
  PIPELINES,
  PRODUCTS,
  TAGS,
  TASK_TITLES,
  TEAMS,
} from './data';

/**
 * The demo organization, built in phases so no single call runs long. Each
 * phase is idempotent: it looks for what it would create and returns early if
 * it is already there, so a seed can be resumed or re-run safely.
 *
 * Everything is generated from a fixed seed (see rng.ts) and dated relative to
 * today, so the board, the reports and the "due today" counts always look
 * alive. The person installing the template becomes the Admin and is given a
 * real slice of the work: deals, tasks due today, leads to triage and an inbox.
 */

export type SeedContext = { actor: Actor; today: string; settings: OrgSettings; rng: Rng };
export type SeedPhase = { key: string; label: string; run: (ctx: SeedContext) => Promise<void> };

const money = (n: number) => Math.round(n / 100) * 100;

async function memberMap() {
  const { rows } = await zite.sql({ query: `SELECT id, "email", "name" FROM "Members"`, params: [] });
  const byEmail = new Map(rows.map(r => [String(r.email).toLowerCase(), String(r.id)]));
  const out = new Map<string, string>();
  for (const m of MEMBERS) {
    const id = byEmail.get(m.email);
    if (id) out.set(m.key, id);
  }
  return out;
}

/** Everyone who can own work, with the installer standing in as one of the team. */
function ownerFor(key: string, members: Map<string, string>, actorId: string) {
  return members.get(key) ?? actorId;
}

export const seedOrg: SeedPhase = {
  key: 'org',
  label: 'organization',
  run: async ({ actor, today, settings, rng }) => {
    await updateSettings(settings.id, {
      organizationName: ORG.name,
      currency: ORG.currency,
      timezone: ORG.timezone,
      mailingAddress: ORG.address,
      emailFooter: ORG.footer,
      seededAt: new Date().toISOString(),
      preferences: settings.preferences,
    });

    const existing = await zite.members.findAll({ limit: 200 });
    const byEmail = new Map(existing.records.map(r => [String(r.email ?? '').toLowerCase(), r]));
    const toCreate = MEMBERS.filter(m => !byEmail.has(m.email)).map(m => ({
      name: m.name,
      email: m.email,
      role: m.role,
      status: 'Active',
      title: m.title,
      phone: m.phone,
      color: colorFor(m.email),
      timezone: ORG.timezone,
      emailSignature: `${m.name}\n${m.title} · ${ORG.name}\n${m.phone}`,
      lastSeenAt: pastIso(rng, today, int(rng, 0, 3)),
    }));
    if (toCreate.length) await chunked(toCreate, async batch => void (await zite.members.bulkCreate({ records: batch })));

    // The installer is the Admin, and is given a title so they look like a teammate.
    const me = (await zite.members.findOne({ id: actor.id })) ?? null;
    if (me && !me.title) {
      await withRetry(() => zite.members.update({ id: actor.id, record: { title: 'Head of Revenue', timezone: ORG.timezone, color: colorFor(actor.email), emailSignature: `${actor.name}\nHead of Revenue · ${ORG.name}` } }));
    }

    const members = await memberMap();
    const teams = await zite.teams.findAll({ limit: 20 });
    if (!teams.records.length) {
      const created = await zite.teams.bulkCreate({
        records: TEAMS.map(t => ({ name: t.name, description: t.description, leadId: members.get(t.lead) ?? null, color: null })),
      });
      const teamByKey = new Map(TEAMS.map((t, i) => [t.key, created.records[i].id]));
      for (const m of MEMBERS) {
        const id = members.get(m.key);
        if (id && m.team !== 'none') await withRetry(() => zite.members.update({ id, record: { teamId: teamByKey.get(m.team) ?? null } }));
      }
      if (teamByKey.get('ae')) await withRetry(() => zite.members.update({ id: actor.id, record: { teamId: teamByKey.get('ae') } }));
    }

    // Inbound leads rotate between the two SDRs, so a Round Robin form has a pool.
    const routingPool = [members.get('marcus'), members.get('aisha')].filter((id): id is string => Boolean(id));
    if (routingPool.length) {
      const current = await getSettings();
      if (!current.leadRouting.memberIds.length) {
        await updateSettings(current.id, { leadRouting: { mode: 'round_robin', memberIds: routingPool, memberId: null, cursor: 0 } });
      }
    }

    const choices = await zite.choices.findAll({ limit: 5 });
    if (!choices.records.length) {
      const records = [
        ...INDUSTRIES.map((label, i) => ({ label, list: 'Industry', position: i })),
        ...LEAD_SOURCES.map((label, i) => ({ label, list: 'Lead Source', position: i })),
        ...LOST_REASONS.map((label, i) => ({ label, list: 'Lost Reason', position: i })),
        ...DISQUALIFY_REASONS.map((label, i) => ({ label, list: 'Disqualify Reason', position: i })),
      ];
      await chunked(records, async batch => void (await zite.choices.bulkCreate({ records: batch })));
    }

    const tags = await zite.tags.findAll({ limit: 5 });
    if (!tags.records.length) await zite.tags.bulkCreate({ records: TAGS.map(t => ({ name: t.name, color: t.color, description: t.description })) });

    const fields = await zite.customFields.findAll({ limit: 5 });
    if (!fields.records.length) {
      await zite.customFields.bulkCreate({
        records: [
          { label: 'Sites', key: 'sites', object: 'Company', type: 'Number', position: 0, helpText: 'Warehouses, depots or yards they run' },
          { label: 'Current system', key: 'current_system', object: 'Company', type: 'Select', options: JSON.stringify(['Spreadsheets', 'Homegrown', 'Legacy WMS', 'Competitor', 'None']), position: 1 },
          { label: 'Competitor', key: 'competitor', object: 'Deal', type: 'Select', options: JSON.stringify(['None', 'Longhaul', 'Vantix', 'In-house build', 'Unknown']), position: 0, helpText: 'Who else they are looking at' },
          { label: 'Preferred channel', key: 'preferred_channel', object: 'Contact', type: 'Select', options: JSON.stringify(['Email', 'Phone', 'Text', 'LinkedIn']), position: 0 },
        ],
      });
    }

    const products = await zite.products.findAll({ limit: 3 });
    if (!products.records.length) {
      await zite.products.bulkCreate({ records: PRODUCTS.map(p => ({ name: p.name, sku: p.sku, description: p.description, unitPrice: p.price, billing: p.billing, category: p.category, active: true })) });
    }
  },
};

export const seedPipelines: SeedPhase = {
  key: 'pipelines',
  label: 'pipelines',
  run: async () => {
    const existing = await zite.pipelines.findAll({ limit: 5 });
    if (existing.records.length) return;
    for (const [i, p] of PIPELINES.entries()) {
      const pipeline = await zite.pipelines.create({ record: { name: p.name, description: p.description, position: i, isDefault: p.isDefault, archived: false } });
      await zite.stages.bulkCreate({
        records: p.stages.map((s, j) => ({ name: s.name, pipelineId: pipeline.id, position: j, probability: s.probability, kind: s.kind, rottingDays: s.rottingDays, guidance: s.guidance || null, archived: false })),
      });
    }
  },
};

export const seedCompanies: SeedPhase = {
  key: 'companies',
  label: 'companies and contacts',
  run: async ({ actor, today, rng }) => {
    const existing = await zite.companies.findAll({ limit: 1 });
    if (existing.records.length) return;
    const members = await memberMap();
    const { rows: tagRows } = await zite.sql({ query: `SELECT id, "name" FROM "Tags"`, params: [] });
    const tagByName = new Map(tagRows.map(r => [String(r.name), String(r.id)]));

    const companyRecords = COMPANIES.map((c, i) => {
      const tags: string[] = [];
      if (c.employees >= 1000 && tagByName.get('Enterprise')) tags.push(tagByName.get('Enterprise')!);
      if (chance(rng, 0.35) && tagByName.get('Multi-site')) tags.push(tagByName.get('Multi-site')!);
      if (c.type === 'Customer' && chance(rng, 0.5) && tagByName.get('Referenceable')) tags.push(tagByName.get('Referenceable')!);
      return {
        name: c.name,
        domain: c.domain,
        website: `https://www.${c.domain}`,
        industry: c.industry,
        type: c.type,
        employees: c.employees,
        annualRevenue: c.revenue,
        // Every fourth company goes to the installer, so their screen has work on it.
        ownerId: i % 4 === 0 ? actor.id : ownerFor(c.owner, members, actor.id),
        phone: `(${int(rng, 201, 989)}) 555-0${int(rng, 100, 199)}`,
        city: c.city,
        region: c.region,
        country: 'United States',
        description: c.description,
        source: pick(rng, LEAD_SOURCES),
        tagIds: tags.length ? JSON.stringify(tags) : null,
        customFields: JSON.stringify({ sites: int(rng, 1, 12), current_system: pick(rng, ['Spreadsheets', 'Homegrown', 'Legacy WMS', 'Competitor']) }),
        customerSince: c.type === 'Customer' ? addDays(today, -int(rng, 120, 900)) : null,
        lastActivityAt: pastIso(rng, today, int(rng, 0, 30)),
      };
    });
    const created: string[] = [];
    await chunked(companyRecords, async batch => {
      const res = await zite.companies.bulkCreate({ records: batch });
      created.push(...res.records.map(r => r.id));
    });

    // A few deliberate states, so the features that handle them aren't invisible
    // in the demo: a corporate group, an archived record, and a duplicate to merge.
    const parentId = created[0];
    for (const index of [10, 22]) {
      if (created[index]) await withRetry(() => zite.companies.update({ id: created[index], record: { parentCompanyId: parentId } }));
    }
    const archivedIndex = COMPANIES.findIndex(c => c.name === 'Summit Grain Handling');
    if (created[archivedIndex]) await withRetry(() => zite.companies.update({ id: created[archivedIndex], record: { archived: true } }));

    const twin = COMPANIES[0];
    await withRetry(() =>
      zite.companies.create({
        record: {
          name: `${twin.name} Ltd`,
          domain: twin.domain,
          website: `https://www.${twin.domain}`,
          industry: twin.industry,
          type: 'Prospect',
          employees: twin.employees,
          ownerId: actor.id,
          city: twin.city,
          region: twin.region,
          country: 'United States',
          description: 'Created by an import before anyone noticed we already had them — merge it into the original.',
          source: 'Outbound',
        },
      }),
    );

    const contactRecords: Array<Record<string, unknown>> = [];
    COMPANIES.forEach((c, i) => {
      const companyId = created[i];
      c.contacts.forEach((p, j) => {
        const name = `${p.first} ${p.last}`;
        contactRecords.push({
          name,
          firstName: p.first,
          lastName: p.last,
          email: `${slugify(p.first)}.${slugify(p.last)}@${c.domain}`,
          phone: `(${int(rng, 201, 989)}) 555-0${int(rng, 200, 299)}`,
          mobile: chance(rng, 0.4) ? `(${int(rng, 201, 989)}) 555-0${int(rng, 300, 399)}` : null,
          title: p.title,
          companyId,
          ownerId: companyRecords[i].ownerId,
          source: companyRecords[i].source,
          city: c.city,
          country: 'United States',
          linkedinUrl: chance(rng, 0.5) ? `https://www.linkedin.com/in/${slugify(name)}` : null,
          background: j === 0 && chance(rng, 0.5) ? pick(rng, NOTE_BODIES).replace('{first}', p.first) : null,
          customFields: JSON.stringify({ preferred_channel: pick(rng, ['Email', 'Phone', 'LinkedIn']) }),
          lastActivityAt: pastIso(rng, today, int(rng, 1, 40)),
          lastContactedAt: pastIso(rng, today, int(rng, 1, 40)),
          doNotContact: false,
        });
      });
    });
    const contactIds: string[] = [];
    await chunked(contactRecords, async batch => {
      const res = await zite.contacts.bulkCreate({ records: batch });
      contactIds.push(...res.records.map(r => r.id));
    });

    // Consent states a real database always has, and a contact who hasn't been
    // filed under a company yet.
    if (contactIds[4]) await withRetry(() => zite.contacts.update({ id: contactIds[4], record: { doNotContact: true } }));
    if (contactIds[9]) await withRetry(() => zite.contacts.update({ id: contactIds[9], record: { unsubscribedAt: pastIso(rng, today, 23), unsubscribeToken: randomToken(28) } }));
    await withRetry(() =>
      zite.contacts.create({
        record: {
          name: 'Rowan Whitfield',
          firstName: 'Rowan',
          lastName: 'Whitfield',
          email: 'rowan.whitfield@stillwater-ops.example',
          title: 'Operations Consultant',
          ownerId: actor.id,
          source: 'Referral',
          background: 'Met at the logistics summit. Consults for three operators — worth keeping warm even without a company on file.',
          country: 'United States',
        },
      }),
    );
  },
};

export const seedDeals: SeedPhase = {
  key: 'deals',
  label: 'deals',
  run: async ({ actor, today, rng }) => {
    const existing = await zite.deals.findAll({ limit: 1 });
    if (existing.records.length) return;
    const members = await memberMap();
    const [{ rows: companies }, { rows: stages }, { rows: pipelines }, { rows: contacts }, { rows: tagRows }, { rows: products }] = await Promise.all([
      zite.sql({ query: `SELECT id, "name", "type", "employees", "ownerId", "industry" FROM "Companies" ORDER BY created_at`, params: [] }),
      zite.sql({ query: `SELECT id, "name", "pipelineId", "position", "kind", "probability" FROM "Stages" ORDER BY "position"`, params: [] }),
      zite.sql({ query: `SELECT id, "name", "isDefault" FROM "Pipelines"`, params: [] }),
      zite.sql({ query: `SELECT id, "name", "companyId", "title" FROM "Contacts" ORDER BY created_at`, params: [] }),
      zite.sql({ query: `SELECT id, "name" FROM "Tags"`, params: [] }),
      zite.sql({ query: `SELECT id, "name", "unitPrice", "billing" FROM "Products" ORDER BY created_at`, params: [] }),
    ]);
    const newPipeline = pipelines.find(p => p.isDefault === true) ?? pipelines[0];
    const renewalPipeline = pipelines.find(p => String(p.id) !== String(newPipeline.id)) ?? newPipeline;
    const newStages = stages.filter(s => String(s.pipelineId) === String(newPipeline.id));
    const renewalStages = stages.filter(s => String(s.pipelineId) === String(renewalPipeline.id));
    const openNew = newStages.filter(s => s.kind === 'Open');
    const wonNew = newStages.find(s => s.kind === 'Won')!;
    const lostNew = newStages.find(s => s.kind === 'Lost')!;
    const openRenewal = renewalStages.filter(s => s.kind === 'Open');
    const wonRenewal = renewalStages.find(s => s.kind === 'Won')!;
    const contactsByCompany = new Map<string, Array<{ id: string; name: string; title: string }>>();
    for (const c of contacts) {
      const key = String(c.companyId);
      if (!contactsByCompany.has(key)) contactsByCompany.set(key, []);
      contactsByCompany.get(key)!.push({ id: String(c.id), name: String(c.name), title: String(c.title ?? '') });
    }
    const tagByName = new Map(tagRows.map(r => [String(r.name), String(r.id)]));

    type PendingDeal = { record: Record<string, unknown>; path: string[]; openedDaysAgo: number; companyId: string; contactId: string | null; lines: Array<Record<string, unknown>> };
    const pending: PendingDeal[] = [];

    companies.forEach((company, index) => {
      const companyId = String(company.id);
      const seedCompany = COMPANIES[index];
      const people = contactsByCompany.get(companyId) ?? [];
      const primary = people[0] ?? null;
      const base = money(Math.max(14_000, Number(company.employees ?? 200) * int(rng, 38, 62)));
      const ownerId = index % 4 === 0 ? actor.id : ownerFor(seedCompany?.owner ?? 'daniel', members, actor.id);
      const type = String(company.type ?? 'Prospect');

      const makeDeal = (opts: { name: string; stage: Record<string, unknown>; pipelineId: string; amount: number; openedDaysAgo: number; stageDaysAgo: number; closeDate: string; status: 'Open' | 'Won' | 'Lost'; closedAt?: string | null; lostReason?: string | null; path: string[]; dealType: 'New Business' | 'Expansion' | 'Renewal' }) => {
        const tagIds: string[] = [];
        if (chance(rng, 0.3) && tagByName.get('Champion found')) tagIds.push(tagByName.get('Champion found')!);
        if (chance(rng, 0.25) && tagByName.get('Security review')) tagIds.push(tagByName.get('Security review')!);
        if (chance(rng, 0.2) && tagByName.get('Competitive')) tagIds.push(tagByName.get('Competitive')!);
        // Deals far enough along to have been priced carry line items, and their
        // amount is the line items' total — the same rule the app enforces.
        const lines: Array<Record<string, unknown>> = [];
        let amount = opts.amount;
        if (products.length && chance(rng, 0.55)) {
          const tier = opts.amount > 120_000 ? 2 : opts.amount > 60_000 ? 1 : 0;
          const platform = products[tier];
          const discount = chance(rng, 0.4) ? int(rng, 5, 15) : 0;
          const implementation = products.find(pr => String(pr.name).startsWith(opts.amount > 120_000 ? 'Implementation — complex' : 'Implementation — standard'));
          lines.push({ name: String(platform.name), productId: String(platform.id), quantity: 1, unitPrice: Number(platform.unitPrice), discount, billing: String(platform.billing), termMonths: 12, position: 0 });
          let total = Math.round(Number(platform.unitPrice) * 12 * (1 - discount / 100));
          if (implementation) {
            lines.push({ name: String(implementation.name), productId: String(implementation.id), quantity: 1, unitPrice: Number(implementation.unitPrice), discount: 0, billing: 'One-time', termMonths: null, position: 1 });
            total += Number(implementation.unitPrice);
          }
          const sites = int(rng, 0, 4);
          const siteLicence = products.find(pr => String(pr.name).startsWith('Additional site'));
          if (sites > 0 && siteLicence) {
            lines.push({ name: String(siteLicence.name), productId: String(siteLicence.id), quantity: sites, unitPrice: Number(siteLicence.unitPrice), discount: 0, billing: 'Monthly', termMonths: 12, position: 2 });
            total += Math.round(Number(siteLicence.unitPrice) * sites * 12);
          }
          amount = total;
        }
        pending.push({
          companyId,
          contactId: primary?.id ?? null,
          openedDaysAgo: opts.openedDaysAgo,
          path: opts.path,
          lines,
          record: {
            name: opts.name,
            companyId,
            contactId: primary?.id ?? null,
            pipelineId: opts.pipelineId,
            stageId: String(opts.stage.id),
            ownerId,
            amount,
            closeDate: opts.closeDate,
            status: opts.status,
            type: opts.dealType,
            source: pick(rng, LEAD_SOURCES),
            probability: null,
            forecastCategory: null,
            nextStep: opts.status === 'Open' ? pick(rng, ['Confirm the pilot scope', 'Send the security pack', 'Get procurement on the call', 'Agree the start date', 'Walk the proposal with the CFO']) : null,
            description: opts.status === 'Open' && chance(rng, 0.5) ? `${seedCompany?.description ?? ''} Looking to replace their current process before their next peak season.` : null,
            lostReason: opts.lostReason ?? null,
            closeNote: opts.status === 'Won' ? 'Signed a two-year agreement; kickoff scheduled with their operations team.' : opts.status === 'Lost' ? 'Worth revisiting once their current contract is up.' : null,
            closedAt: opts.closedAt ?? null,
            stageEnteredAt: pastIso(rng, today, opts.stageDaysAgo),
            openedAt: pastIso(rng, today, opts.openedDaysAgo),
            position: (index + 1) * 1000,
            tagIds: tagIds.length ? JSON.stringify(tagIds) : null,
            customFields: JSON.stringify({ competitor: pick(rng, ['None', 'Longhaul', 'Vantix', 'In-house build', 'Unknown']) }),
            lastActivityAt: pastIso(rng, today, int(rng, 0, 14)),
          },
        });
      };

      if (type === 'Customer') {
        const isMine = index % 4 === 0;
        const wonDaysAgo = isMine ? int(rng, 6, 62) : int(rng, 20, 300);
        makeDeal({
          name: `${company.name} — Platform rollout`,
          stage: wonNew,
          pipelineId: String(newPipeline.id),
          amount: base,
          openedDaysAgo: wonDaysAgo + int(rng, 40, 90),
          stageDaysAgo: wonDaysAgo,
          closeDate: addDays(today, -wonDaysAgo),
          status: 'Won',
          closedAt: pastIso(rng, today, wonDaysAgo),
          path: openNew.map(s => String(s.id)),
          dealType: 'New Business',
        });
        if (chance(rng, 0.7)) {
          const stage = pick(rng, openRenewal);
          makeDeal({
            name: `${company.name} — Renewal`,
            stage,
            pipelineId: String(renewalPipeline.id),
            amount: money(base * (chance(rng, 0.5) ? 1.15 : 1)),
            openedDaysAgo: int(rng, 10, 60),
            stageDaysAgo: int(rng, 2, 30),
            closeDate: addDays(today, int(rng, 10, 80)),
            status: 'Open',
            path: [],
            dealType: 'Renewal',
          });
        } else if (chance(rng, 0.5)) {
          makeDeal({
            name: `${company.name} — Fleet module`,
            stage: pick(rng, openNew.slice(1)),
            pipelineId: String(newPipeline.id),
            amount: money(base * 0.35),
            openedDaysAgo: int(rng, 12, 70),
            stageDaysAgo: int(rng, 1, 26),
            closeDate: addDays(today, int(rng, -6, 60)),
            status: 'Open',
            path: [],
            dealType: 'Expansion',
          });
        }
      } else if (type === 'Former Customer') {
        const lostDaysAgo = int(rng, 30, 150);
        makeDeal({
          name: `${company.name} — Renewal`,
          stage: renewalStages.find(s => s.kind === 'Lost') ?? lostNew,
          pipelineId: String(renewalPipeline.id),
          amount: base,
          openedDaysAgo: lostDaysAgo + 60,
          stageDaysAgo: lostDaysAgo,
          closeDate: addDays(today, -lostDaysAgo),
          status: 'Lost',
          closedAt: pastIso(rng, today, lostDaysAgo),
          lostReason: 'Price',
          path: openRenewal.map(s => String(s.id)),
          dealType: 'Renewal',
        });
      } else {
        // Prospects: one live deal, and sometimes a second or a deal lost earlier.
        const stage = pickWeighted(rng, openNew.map((s, i) => [s, [5, 4, 4, 3, 2][i] ?? 2] as [Record<string, unknown>, number]));
        const stageIndex = openNew.findIndex(s => s.id === stage.id);
        const openedDaysAgo = int(rng, 8, 120);
        const stalls = chance(rng, 0.22);
        makeDeal({
          name: `${company.name} — ${pick(rng, ['Platform rollout', 'Operations platform', 'Multi-site rollout', 'Pilot + rollout'])}`,
          stage,
          pipelineId: String(newPipeline.id),
          amount: base,
          openedDaysAgo,
          stageDaysAgo: stalls ? int(rng, 26, 52) : int(rng, 1, 16),
          closeDate: addDays(today, chance(rng, 0.15) ? -int(rng, 1, 14) : int(rng, 4, 85)),
          status: 'Open',
          path: openNew.slice(0, Math.max(0, stageIndex)).map(s => String(s.id)),
          dealType: 'New Business',
        });
        if (chance(rng, 0.22)) {
          // An earlier win for this prospect: reports need more than a couple of
          // closed deals before a win rate or an average cycle means anything.
          const wonDaysAgo = int(rng, 10, 260);
          makeDeal({
            name: `${company.name} — ${pick(rng, ['Pilot', 'Single-site pilot', 'Starter rollout'])}`,
            stage: wonNew,
            pipelineId: String(newPipeline.id),
            amount: money(base * 0.45),
            openedDaysAgo: wonDaysAgo + int(rng, 35, 80),
            stageDaysAgo: wonDaysAgo,
            closeDate: addDays(today, -wonDaysAgo),
            status: 'Won',
            closedAt: pastIso(rng, today, wonDaysAgo),
            path: openNew.map(s => String(s.id)),
            dealType: 'New Business',
          });
        }
        // Most opportunities don't close — a demo that wins three quarters of its
        // deals teaches a sales team nothing.
        if (chance(rng, 0.55)) {
          const lostDaysAgo = int(rng, 15, 260);
          makeDeal({
            name: `${company.name} — ${pick(rng, ['Pilot', 'Warehouse pilot', 'Fleet module'])}`,
            stage: lostNew,
            pipelineId: String(newPipeline.id),
            amount: money(base * 0.6),
            openedDaysAgo: lostDaysAgo + int(rng, 30, 70),
            stageDaysAgo: lostDaysAgo,
            closeDate: addDays(today, -lostDaysAgo),
            status: 'Lost',
            closedAt: pastIso(rng, today, lostDaysAgo),
            lostReason: pick(rng, LOST_REASONS),
            path: openNew.slice(0, int(rng, 1, 4)).map(s => String(s.id)),
            dealType: 'New Business',
          });
        }
      }
    });

    const dealIds: string[] = [];
    await chunked(pending.map(p => p.record), async batch => {
      const res = await zite.deals.bulkCreate({ records: batch });
      dealIds.push(...res.records.map(r => r.id));
    });

    // Buying group and stage history.
    const dealContacts: Array<Record<string, unknown>> = [];
    const stageChanges: Array<Record<string, unknown>> = [];
    pending.forEach((p, i) => {
      const dealId = dealIds[i];
      const people = contactsByCompany.get(p.companyId) ?? [];
      people.slice(0, chance(rng, 0.6) ? 2 : 1).forEach((person, j) => {
        dealContacts.push({ dealId, contactId: person.id, role: j === 0 ? 'Decision Maker' : pick(rng, ['Champion', 'Influencer', 'Technical Evaluator', 'End User']) });
      });
      const walk = [...p.path, String(p.record.stageId)];
      const span = Math.max(1, p.openedDaysAgo - 1);
      walk.forEach((stageId, j) => {
        const daysAgo = Math.max(0, Math.round(p.openedDaysAgo - (span * j) / Math.max(1, walk.length - 1)));
        stageChanges.push({
          dealId,
          pipelineId: p.record.pipelineId,
          fromStageId: j === 0 ? null : walk[j - 1],
          toStageId: stageId,
          changedAt: pastIso(rng, today, daysAgo),
          actorId: p.record.ownerId,
          amount: p.record.amount,
        });
      });
    });
    await chunked(dealContacts, async batch => void (await zite.dealContacts.bulkCreate({ records: batch })));
    await chunked(stageChanges, async batch => void (await zite.stageChanges.bulkCreate({ records: batch })));

    const lineItems: Array<Record<string, unknown>> = [];
    pending.forEach((p, i) => {
      for (const line of p.lines) lineItems.push({ ...line, dealId: dealIds[i] });
    });
    await chunked(lineItems, async batch => void (await zite.lineItems.bulkCreate({ records: batch })));
  },
};

export const seedActivity: SeedPhase = {
  key: 'activity',
  label: 'activity and tasks',
  run: async ({ actor, today, rng }) => {
    const existing = await zite.activities.findAll({ limit: 1 });
    if (existing.records.length) return;
    const { rows: deals } = await zite.sql({
      query: `SELECT d.id, d."name", d."companyId", d."contactId", d."ownerId", d."status", d."openedAt", d."closedAt", co."name" AS "companyName", ct."name" AS "contactName", ct."firstName"
        FROM "Deals" d LEFT JOIN "Companies" co ON co.id::text = d."companyId" LEFT JOIN "Contacts" ct ON ct.id::text = d."contactId" ORDER BY d.created_at`,
      params: [],
    });
    const { rows: memberRows } = await zite.sql({ query: `SELECT id, "name" FROM "Members"`, params: [] });
    const memberName = new Map(memberRows.map(r => [String(r.id), String(r.name)]));

    const activities: Array<Record<string, unknown>> = [];
    const tasks: Array<Record<string, unknown>> = [];
    let meetingsBooked = 0;

    for (const deal of deals) {
      const ownerId = String(deal.ownerId ?? actor.id);
      const first = String(deal.firstName ?? deal.contactName ?? 'there').split(' ')[0];
      const companyName = String(deal.companyName ?? '');
      const sender = memberName.get(ownerId) ?? actor.name;
      const openedDaysAgo = deal.openedAt ? Math.max(1, Math.round((Date.now() - Date.parse(String(deal.openedAt))) / 86_400_000)) : 40;
      const closedDaysAgo = deal.closedAt ? Math.max(0, Math.round((Date.now() - Date.parse(String(deal.closedAt))) / 86_400_000)) : 0;
      const windowStart = openedDaysAgo;
      const windowEnd = deal.status === 'Open' ? 0 : closedDaysAgo;
      const count = deal.status === 'Open' ? int(rng, 3, 8) : int(rng, 4, 9);

      for (let i = 0; i < count; i++) {
        const daysAgo = Math.max(windowEnd, Math.round(windowStart - ((windowStart - windowEnd) * i) / count) - int(rng, 0, 2));
        const kind = pickWeighted(rng, [
          ['Email', 5],
          ['Call', 4],
          ['Meeting', 3],
          ['Note', 2],
        ] as Array<[string, number]>);
        const occurredAt = pastIso(rng, today, daysAgo);
        if (kind === 'Email') {
          const subject = EMAIL_SUBJECTS[(i + windowStart) % EMAIL_SUBJECTS.length].replace('{company}', companyName);
          activities.push({
            kind: 'Email',
            subject,
            body: EMAIL_BODIES[(i + windowStart) % EMAIL_BODIES.length].replace(/\{first\}/g, first).replace(/\{sender\}/g, sender),
            occurredAt,
            direction: chance(rng, 0.25) ? 'Inbound' : 'Outbound',
            delivery: 'Sent',
            emailFrom: sender,
            emailTo: String(deal.contactName ?? ''),
            ownerId,
            createdById: ownerId,
            companyId: deal.companyId,
            contactId: deal.contactId,
            dealId: deal.id,
          });
        } else if (kind === 'Call') {
          const outcome = pickWeighted(rng, [
            ['Connected', 6],
            ['Left Voicemail', 3],
            ['No Answer', 2],
          ] as Array<[string, number]>);
          activities.push({
            kind: 'Call',
            subject: `Call · ${outcome}`,
            body: outcome === 'Connected' ? CALL_NOTES[(i + openedDaysAgo) % CALL_NOTES.length].replace('{first}', first) : null,
            occurredAt,
            outcome,
            direction: chance(rng, 0.15) ? 'Inbound' : 'Outbound',
            durationMinutes: outcome === 'Connected' ? int(rng, 6, 34) : 1,
            ownerId,
            createdById: ownerId,
            companyId: deal.companyId,
            contactId: deal.contactId,
            dealId: deal.id,
          });
        } else if (kind === 'Meeting') {
          const duration = pick(rng, [30, 45, 60]);
          activities.push({
            kind: 'Meeting',
            subject: pick(rng, ['Discovery call', 'Product demo', 'Proposal review', 'Technical deep dive', 'Quarterly review']),
            body: MEETING_NOTES[(i + count) % MEETING_NOTES.length].replace('{first}', first),
            occurredAt,
            endsAt: new Date(Date.parse(occurredAt) + duration * 60_000).toISOString(),
            durationMinutes: duration,
            outcome: 'Completed',
            location: chance(rng, 0.8) ? 'Video call' : `${companyName} · site visit`,
            attendees: JSON.stringify([{ name: String(deal.contactName ?? ''), contactId: deal.contactId ?? null }, { name: sender, memberId: ownerId }]),
            ownerId,
            createdById: ownerId,
            companyId: deal.companyId,
            contactId: deal.contactId,
            dealId: deal.id,
          });
        } else {
          activities.push({
            kind: 'Note',
            subject: 'Note',
            body: NOTE_BODIES[(i + openedDaysAgo) % NOTE_BODIES.length].replace('{first}', first),
            occurredAt,
            ownerId,
            createdById: ownerId,
            companyId: deal.companyId,
            contactId: deal.contactId,
            dealId: deal.id,
          });
        }
      }

      if (deal.status === 'Open') {
        // Upcoming meetings on a third of live deals, and a next step on most.
        const mine = ownerId === actor.id;
        if (chance(rng, 0.3) || (mine && meetingsBooked < 2)) {
          // The installer's first two land today and tomorrow, so their Home always
          // opens on a real day rather than an empty calendar. Today's is anchored to
          // the clock — two hours out — so it is still ahead of whoever is looking.
          const inDays = mine && meetingsBooked < 2 ? meetingsBooked : int(rng, 1, 12);
          if (mine) meetingsBooked += 1;
          // "Today" has to be today wherever the installer is, and still ahead of
          // them, so it is anchored to the clock rather than to a UTC hour.
          const startsAt = inDays === 0 ? new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString() : pastIso(rng, today, -inDays, int(rng, 16, 23));
          activities.push({
            kind: 'Meeting',
            subject: pick(rng, ['Product demo', 'Discovery call', 'Proposal review', 'Security review']),
            occurredAt: startsAt,
            endsAt: new Date(Date.parse(startsAt) + 45 * 60_000).toISOString(),
            durationMinutes: 45,
            outcome: 'Scheduled',
            location: 'Video call',
            attendees: JSON.stringify([{ name: String(deal.contactName ?? ''), contactId: deal.contactId ?? null }, { name: sender, memberId: ownerId }]),
            ownerId,
            createdById: ownerId,
            companyId: deal.companyId,
            contactId: deal.contactId,
            dealId: deal.id,
          });
        }
        if (chance(rng, 0.78)) {
          const isMine = ownerId === actor.id;
          const due = pickWeighted(rng, [
            [-int(rng, 1, 6), isMine ? 3 : 2],
            [0, isMine ? 3 : 1],
            [int(rng, 1, 3), 3],
            [int(rng, 4, 20), 3],
          ] as Array<[number, number]>);
          tasks.push({
            title: TASK_TITLES[(deals.indexOf(deal) + openedDaysAgo) % TASK_TITLES.length],
            type: pick(rng, ['Call', 'Email', 'To-do', 'Meeting']),
            status: 'Open',
            priority: pickWeighted(rng, [
              ['Normal', 6],
              ['High', 3],
              ['Low', 1],
            ] as Array<[string, number]>),
            dueDate: addDays(today, due),
            dueTime: chance(rng, 0.4) ? `${String(int(rng, 8, 16)).padStart(2, '0')}:${pick(rng, ['00', '15', '30', '45'])}` : null,
            ownerId,
            createdById: ownerId,
            companyId: deal.companyId,
            contactId: deal.contactId,
            dealId: deal.id,
            notes: chance(rng, 0.3) ? pick(rng, ['They asked for this by end of week.', 'Loop in solutions engineering.', 'Check the numbers with finance first.']) : null,
          });
        }
      } else if (chance(rng, 0.5)) {
        tasks.push({
          title: deal.status === 'Won' ? 'Hand off to onboarding' : 'Add to the nurture list',
          type: 'To-do',
          status: 'Done',
          priority: 'Normal',
          dueDate: addDays(today, -int(rng, 2, 40)),
          completedAt: pastIso(rng, today, int(rng, 1, 30)),
          ownerId,
          createdById: ownerId,
          companyId: deal.companyId,
          contactId: deal.contactId,
          dealId: deal.id,
        });
      }
    }

    await chunked(activities, async batch => void (await zite.activities.bulkCreate({ records: batch })));
    await chunked(tasks, async batch => void (await zite.tasks.bulkCreate({ records: batch })));
  },
};

export const seedLeads: SeedPhase = {
  key: 'leads',
  label: 'leads',
  run: async ({ actor, today, rng }) => {
    const existing = await zite.leads.findAll({ limit: 1 });
    if (existing.records.length) return;
    const members = await memberMap();
    const sdrs = [members.get('marcus'), members.get('aisha'), actor.id].filter((x): x is string => Boolean(x));
    const { rows: companies } = await zite.sql({ query: `SELECT id, "name" FROM "Companies" WHERE "type" = 'Prospect' ORDER BY created_at LIMIT 8`, params: [] });

    const leads: Array<Record<string, unknown>> = [];
    const leadActivities: Array<Record<string, unknown>> = [];
    for (let i = 0; i < 34; i++) {
      const first = pick(rng, FIRST_NAMES);
      const last = pick(rng, LAST_NAMES);
      const company = pick(rng, LEAD_COMPANIES);
      const domain = `${slugify(company)}.example`;
      const status = pickWeighted(rng, [
        ['New', 10],
        ['Working', 8],
        ['Nurturing', 5],
        ['Qualified', 6],
        ['Disqualified', 5],
      ] as Array<[string, number]>);
      const daysAgo = status === 'New' ? int(rng, 0, 4) : int(rng, 3, 45);
      const employees = pick(rng, [40, 90, 120, 260, 480, 900, 1500, 2600]);
      const source = pick(rng, LEAD_SOURCES);
      const owner = status === 'New' && chance(rng, 0.35) ? null : pick(rng, sdrs);
      const converted = status === 'Qualified';
      const target = companies[i % Math.max(1, companies.length)];
      const leadTitle = pick(rng, LEAD_TITLES);
      const leadEmail = `${slugify(first)}.${slugify(last)}@${domain}`;
      const leadPhone = chance(rng, 0.6) ? `(${int(rng, 201, 989)}) 555-0${int(rng, 400, 499)}` : null;
      const leadMessage = pick(rng, LEAD_MESSAGES) || null;
      leads.push({
        name: `${first} ${last}`,
        firstName: first,
        lastName: last,
        email: leadEmail,
        phone: leadPhone,
        title: leadTitle,
        companyName: company,
        website: `https://www.${domain}`,
        employees,
        industry: pick(rng, INDUSTRIES),
        country: 'United States',
        source,
        sourceDetail: source === 'Event' ? 'Modern Logistics Summit' : source === 'Referral' ? 'Referred by Wren & Vale Apparel' : null,
        status,
        score: scoreLead({ employees, title: leadTitle, email: leadEmail, phone: leadPhone, companyName: company, source, message: leadMessage }).score,
        ownerId: owner,
        message: leadMessage,
        disqualifyReason: status === 'Disqualified' ? pick(rng, DISQUALIFY_REASONS) : null,
        convertedAt: converted ? pastIso(rng, today, Math.max(1, daysAgo - 2)) : null,
        convertedCompanyId: converted && target ? String(target.id) : null,
        receivedAt: pastIso(rng, today, daysAgo),
        firstResponseAt: status === 'New' ? null : pastIso(rng, today, Math.max(0, daysAgo - 1)),
        lastActivityAt: status === 'New' ? null : pastIso(rng, today, Math.max(0, daysAgo - 1)),
        utmSource: source === 'Website form' || source === 'Demo request' ? pick(rng, ['google', 'linkedin', 'newsletter']) : null,
        utmCampaign: source === 'Webinar' ? 'warehouse-ops-webinar' : null,
      });
    }
    const created: string[] = [];
    await chunked(leads, async batch => {
      const res = await zite.leads.bulkCreate({ records: batch });
      created.push(...res.records.map(r => r.id));
    });

    // A converted lead has to say what it became, or the funnel from lead to deal
    // reads as zero however many were qualified.
    const { rows: convertible } = await zite.sql({
      query: `SELECT d.id AS "dealId", d."companyId", d."contactId", d."status" FROM "Deals" d WHERE COALESCE(d."contactId", '') <> '' ORDER BY d.created_at LIMIT 40`,
      params: [],
    });
    let pointer = 0;
    for (const [index, lead] of leads.entries()) {
      if (lead.status !== 'Qualified' || !created[index]) continue;
      const target = convertible[pointer % Math.max(1, convertible.length)];
      pointer += 1;
      if (!target) break;
      await withRetry(() =>
        zite.leads.update({
          id: created[index],
          record: { convertedCompanyId: String(target.companyId), convertedContactId: String(target.contactId), convertedDealId: String(target.dealId) },
        }),
      );
    }

    leads.forEach((lead, i) => {
      if (lead.status === 'New') return;
      const ownerId = String(lead.ownerId ?? actor.id);
      const count = lead.status === 'Disqualified' ? 1 : int(rng, 1, 3);
      for (let j = 0; j < count; j++) {
        const daysAgo = int(rng, 0, 20);
        const leadKind = chance(rng, 0.5) ? 'Call' : 'Email';
        leadActivities.push({
          kind: leadKind,
          subject: leadKind === 'Call' ? 'Call · Connected' : 'Thanks for getting in touch',
          body: chance(rng, 0.5) ? `Spoke with ${String(lead.firstName)}. ${pick(rng, ['They are early but the timing could work next quarter.', 'Sent the overview and pricing ranges.', 'Asked to be introduced to their operations director.'])}` : null,
          occurredAt: pastIso(rng, today, daysAgo),
          direction: 'Outbound',
          outcome: leadKind === 'Call' ? 'Connected' : null,
          delivery: leadKind === 'Email' ? 'Sent' : null,
          ownerId,
          createdById: ownerId,
          leadId: created[i],
        });
      }
    });
    await chunked(leadActivities, async batch => void (await zite.activities.bulkCreate({ records: batch })));
  },
};

export const seedInbox: SeedPhase = {
  key: 'inbox',
  label: 'quotas, views and inbox',
  run: async ({ actor, today, rng, settings }) => {
    const quotas = await zite.quotas.findAll({ limit: 1 });
    if (!quotas.records.length) {
      const members = await memberMap();
      const thisQuarter = periodStart(today, 'Quarter', settings.fiscalYearStartMonth);
      const lastQuarter = periodStart(addDays(thisQuarter, -1), 'Quarter', settings.fiscalYearStartMonth);
      const records: Array<Record<string, unknown>> = [];
      const reps: Array<[string, number]> = [
        [ownerFor('daniel', members, actor.id), 420_000],
        [ownerFor('sofia', members, actor.id), 360_000],
        [ownerFor('hannah', members, actor.id), 300_000],
        [actor.id, 380_000],
      ];
      for (const [memberId, target] of reps) {
        for (const start of [thisQuarter, lastQuarter]) {
          records.push({ memberId, period: 'Quarter', periodStart: start, metric: 'Revenue', target });
        }
      }
      for (const key of ['marcus', 'aisha']) {
        const memberId = members.get(key);
        if (memberId) records.push({ memberId, period: 'Quarter', periodStart: thisQuarter, metric: 'Meetings', target: 45 });
      }
      await zite.quotas.bulkCreate({ records });
    }

    const views = await zite.views.findAll({ limit: 1 });
    if (!views.records.length) {
      await zite.views.bulkCreate({
        records: [
          { name: 'Closing this quarter', scope: 'Deals', ownerId: actor.id, shared: true, position: 0, config: JSON.stringify({ layout: 'board', filters: { status: ['Open'] }, sort: { key: 'closeDate', dir: 'asc' }, groupBy: 'stage' }) },
          { name: 'Needs a next step', scope: 'Deals', ownerId: actor.id, shared: true, position: 1, config: JSON.stringify({ layout: 'list', filters: { status: ['Open'], noNextStep: true }, sort: { key: 'lastActivityAt', dir: 'asc' } }) },
          { name: 'New leads', scope: 'Leads', ownerId: actor.id, shared: true, position: 2, config: JSON.stringify({ layout: 'list', filters: { status: ['New'] }, sort: { key: 'receivedAt', dir: 'desc' } }) },
        ],
      });
    }

    const notifications = await zite.notifications.findAll({ limit: 1, filters: { recipientId: actor.id } });
    if (!notifications.records.length) {
      const { rows: deals } = await zite.sql({ query: `SELECT d.id, d."name", d."ownerId", d."status" FROM "Deals" d ORDER BY d."lastActivityAt" DESC NULLS LAST LIMIT 12`, params: [] });
      const { rows: leadRows } = await zite.sql({ query: `SELECT id, "name", "companyName" FROM "Leads" WHERE "status" = 'New' ORDER BY "receivedAt" DESC LIMIT 3`, params: [] });
      const members = await memberMap();
      const maya = members.get('maya') ?? null;
      const daniel = members.get('daniel') ?? null;
      const records: Array<Record<string, unknown>> = [];
      const won = deals.find(d => d.status === 'Won');
      if (won) records.push({ recipientId: actor.id, kind: 'deal_won', title: `Daniel Okafor won ${won.name}`, link: `/deals/${won.id}`, entityType: 'deal', entityId: String(won.id), actorId: daniel, occurredAt: pastIso(rng, today, 1) });
      for (const lead of leadRows) {
        records.push({ recipientId: actor.id, kind: 'lead', title: `New lead: ${lead.name} at ${lead.companyName}`, body: 'Came in through the website form.', link: `/leads/${lead.id}`, entityType: 'lead', entityId: String(lead.id), occurredAt: pastIso(rng, today, int(rng, 0, 2)) });
      }
      const mine = deals.filter(d => String(d.ownerId) === actor.id).slice(0, 2);
      const mentions = [
        { body: 'Can you join the call on this one? They asked about the implementation timeline.', who: maya, name: 'Maya Brooks' },
        { body: 'Their procurement team wants the security pack before they will sign. Do you have the latest one?', who: daniel, name: 'Daniel Okafor' },
      ];
      mine.forEach((deal, index) => {
        const mention = mentions[index % mentions.length];
        records.push({
          recipientId: actor.id,
          kind: 'mention',
          title: `${mention.name} mentioned you on ${deal.name}`,
          body: mention.body,
          link: `/deals/${deal.id}`,
          entityType: 'deal',
          entityId: String(deal.id),
          actorId: mention.who,
          occurredAt: pastIso(rng, today, int(rng, 0, 3)),
        });
      });
      if (records.length) await zite.notifications.bulkCreate({ records });
    }
  },
};

export const CORE_PHASES: SeedPhase[] = [seedOrg, seedPipelines, seedCompanies, seedDeals, seedActivity, seedLeads, seedInbox];

export function seedContext(actor: Actor, settings: OrgSettings): SeedContext {
  return { actor, settings, today: todayIn(settings.timezone), rng: makeRng() };
}

export { memberMap, ownerFor, str, sample };
