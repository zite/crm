import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { assertCan, getActor } from '@project/shared/server/actor';
import { loadFieldDefs } from '@project/shared/server/customFields';
import { logEvent } from '@project/shared/server/events';
import { idList, jsonHasAny } from '@project/shared/server/records';
import { Params, day, iso, num, str } from '@project/shared/server/sql';
import { displayValue, parseCustomValues } from '@project/shared/customFields';
import { VIEW_SCOPES, type ViewScope } from '@project/shared/constants';
import { parseInput } from '../server/input';

/**
 * Export to CSV, on the server.
 *
 * Every ledger in the app pages its rows, so exporting what the browser holds
 * would quietly hand someone the first fifty of nine hundred deals. The same
 * filters are applied here instead, against the whole table, and the file
 * comes back complete.
 */

const filters = z
  .object({
    ownerIds: z.array(z.string().min(1)).max(50),
    stageIds: z.array(z.string().min(1)).max(60),
    pipelineId: z.string().min(1),
    status: z.array(z.string().min(1)).max(10),
    types: z.array(z.string().min(1)).max(10),
    sources: z.array(z.string().min(1)).max(30),
    tagIds: z.array(z.string().min(1)).max(50),
    industries: z.array(z.string().min(1)).max(40),
    search: z.string().max(120),
    closedAfter: z.string().max(10),
    closedBefore: z.string().max(10),
    includeArchived: z.boolean(),
  })
  .partial();

const inputSchema = z.object({ scope: z.enum(VIEW_SCOPES), filters: filters.optional(), limit: z.number().int().min(1).max(5000).optional() });

type Column = { header: string; read: (r: Record<string, unknown>) => string | number | null };

const PLANS: Record<ViewScope, { table: string; select: string; object?: 'Company' | 'Contact' | 'Deal' | 'Lead'; columns: Column[]; order: string }> = {
  Deals: {
    table: 'Deals',
    object: 'Deal',
    select: `d.*, co."name" AS "companyName", ct."name" AS "contactName", ct."email" AS "contactEmail", s."name" AS "stageName", p."name" AS "pipelineName", m."name" AS "ownerName", m."email" AS "ownerEmail"
      FROM "Deals" d
      LEFT JOIN "Companies" co ON co.id::text = d."companyId"
      LEFT JOIN "Contacts" ct ON ct.id::text = d."contactId"
      LEFT JOIN "Stages" s ON s.id::text = d."stageId"
      LEFT JOIN "Pipelines" p ON p.id::text = d."pipelineId"
      LEFT JOIN "Members" m ON m.id::text = d."ownerId"`,
    order: `d."closeDate" ASC NULLS LAST, d.created_at DESC`,
    columns: [
      { header: 'Deal name', read: r => str(r.name) },
      { header: 'Company', read: r => str(r.companyName) },
      { header: 'Primary contact', read: r => str(r.contactName) },
      { header: 'Contact email', read: r => str(r.contactEmail) },
      { header: 'Pipeline', read: r => str(r.pipelineName) },
      { header: 'Stage', read: r => str(r.stageName) },
      { header: 'Status', read: r => str(r.status) },
      { header: 'Amount', read: r => (r.amount == null ? '' : num(r.amount)) },
      { header: 'Close date', read: r => day(r.closeDate) },
      { header: 'Owner', read: r => str(r.ownerName) },
      { header: 'Owner email', read: r => str(r.ownerEmail) },
      { header: 'Type', read: r => str(r.type) },
      { header: 'Source', read: r => str(r.source) },
      { header: 'Forecast category', read: r => str(r.forecastCategory) },
      { header: 'Lost reason', read: r => str(r.lostReason) },
      { header: 'Next step', read: r => str(r.nextStep) },
      { header: 'Opened at', read: r => iso(r.openedAt) },
      { header: 'Closed at', read: r => iso(r.closedAt) },
      { header: 'Last activity', read: r => iso(r.lastActivityAt) },
    ],
  },
  Companies: {
    table: 'Companies',
    object: 'Company',
    select: `d.*, m."name" AS "ownerName", m."email" AS "ownerEmail" FROM "Companies" d LEFT JOIN "Members" m ON m.id::text = d."ownerId"`,
    order: `d."name" ASC`,
    columns: [
      { header: 'Company name', read: r => str(r.name) },
      { header: 'Domain', read: r => str(r.domain) },
      { header: 'Industry', read: r => str(r.industry) },
      { header: 'Type', read: r => str(r.type) },
      { header: 'Employees', read: r => (r.employees == null ? '' : num(r.employees)) },
      { header: 'Annual revenue', read: r => (r.annualRevenue == null ? '' : num(r.annualRevenue)) },
      { header: 'Owner', read: r => str(r.ownerName) },
      { header: 'Owner email', read: r => str(r.ownerEmail) },
      { header: 'Phone', read: r => str(r.phone) },
      { header: 'Street', read: r => str(r.address) },
      { header: 'City', read: r => str(r.city) },
      { header: 'State or region', read: r => str(r.region) },
      { header: 'Postal code', read: r => str(r.postalCode) },
      { header: 'Country', read: r => str(r.country) },
      { header: 'Source', read: r => str(r.source) },
      { header: 'Customer since', read: r => day(r.customerSince) },
      { header: 'Last activity', read: r => iso(r.lastActivityAt) },
    ],
  },
  Contacts: {
    table: 'Contacts',
    object: 'Contact',
    select: `d.*, co."name" AS "companyName", m."name" AS "ownerName", m."email" AS "ownerEmail"
      FROM "Contacts" d LEFT JOIN "Companies" co ON co.id::text = d."companyId" LEFT JOIN "Members" m ON m.id::text = d."ownerId"`,
    order: `d."name" ASC`,
    columns: [
      { header: 'Full name', read: r => str(r.name) },
      { header: 'First name', read: r => str(r.firstName) },
      { header: 'Last name', read: r => str(r.lastName) },
      { header: 'Email', read: r => str(r.email) },
      { header: 'Phone', read: r => str(r.phone) },
      { header: 'Mobile', read: r => str(r.mobile) },
      { header: 'Job title', read: r => str(r.title) },
      { header: 'Company', read: r => str(r.companyName) },
      { header: 'Owner', read: r => str(r.ownerName) },
      { header: 'Owner email', read: r => str(r.ownerEmail) },
      { header: 'Source', read: r => str(r.source) },
      { header: 'LinkedIn', read: r => str(r.linkedinUrl) },
      { header: 'City', read: r => str(r.city) },
      { header: 'Country', read: r => str(r.country) },
      { header: 'Do not contact', read: r => (r.doNotContact === true ? 'Yes' : 'No') },
      { header: 'Unsubscribed at', read: r => iso(r.unsubscribedAt) },
      { header: 'Last contacted', read: r => iso(r.lastContactedAt) },
    ],
  },
  Leads: {
    table: 'Leads',
    object: 'Lead',
    select: `d.*, m."name" AS "ownerName", m."email" AS "ownerEmail" FROM "Leads" d LEFT JOIN "Members" m ON m.id::text = d."ownerId"`,
    order: `d."receivedAt" DESC NULLS LAST`,
    columns: [
      { header: 'Full name', read: r => str(r.name) },
      { header: 'Email', read: r => str(r.email) },
      { header: 'Phone', read: r => str(r.phone) },
      { header: 'Job title', read: r => str(r.title) },
      { header: 'Company', read: r => str(r.companyName) },
      { header: 'Website', read: r => str(r.website) },
      { header: 'Employees', read: r => (r.employees == null ? '' : num(r.employees)) },
      { header: 'Industry', read: r => str(r.industry) },
      { header: 'Country', read: r => str(r.country) },
      { header: 'Source', read: r => str(r.source) },
      { header: 'Status', read: r => str(r.status) },
      { header: 'Score', read: r => (r.score == null ? '' : num(r.score)) },
      { header: 'Owner', read: r => str(r.ownerName) },
      { header: 'Owner email', read: r => str(r.ownerEmail) },
      { header: 'Received at', read: r => iso(r.receivedAt) },
      { header: 'Disqualify reason', read: r => str(r.disqualifyReason) },
    ],
  },
  Tasks: {
    table: 'Tasks',
    select: `d.*, m."name" AS "ownerName", co."name" AS "companyName", de."name" AS "dealName"
      FROM "Tasks" d LEFT JOIN "Members" m ON m.id::text = d."ownerId" LEFT JOIN "Companies" co ON co.id::text = d."companyId" LEFT JOIN "Deals" de ON de.id::text = d."dealId"`,
    order: `d."dueDate" ASC NULLS LAST`,
    columns: [
      { header: 'Title', read: r => str(r.title) },
      { header: 'Type', read: r => str(r.type) },
      { header: 'Status', read: r => str(r.status) },
      { header: 'Priority', read: r => str(r.priority) },
      { header: 'Due date', read: r => day(r.dueDate) },
      { header: 'Owner', read: r => str(r.ownerName) },
      { header: 'Company', read: r => str(r.companyName) },
      { header: 'Deal', read: r => str(r.dealName) },
      { header: 'Completed at', read: r => iso(r.completedAt) },
      { header: 'Notes', read: r => str(r.notes) },
    ],
  },
  Activities: {
    table: 'Activities',
    select: `d.*, m."name" AS "ownerName", co."name" AS "companyName", ct."name" AS "contactName", de."name" AS "dealName"
      FROM "Activities" d LEFT JOIN "Members" m ON m.id::text = d."ownerId" LEFT JOIN "Companies" co ON co.id::text = d."companyId"
      LEFT JOIN "Contacts" ct ON ct.id::text = d."contactId" LEFT JOIN "Deals" de ON de.id::text = d."dealId"`,
    order: `d."occurredAt" DESC NULLS LAST`,
    columns: [
      { header: 'Kind', read: r => str(r.kind) },
      { header: 'Subject', read: r => str(r.subject) },
      { header: 'Occurred at', read: r => iso(r.occurredAt) },
      { header: 'Direction', read: r => str(r.direction) },
      { header: 'Outcome', read: r => str(r.outcome) },
      { header: 'Duration (min)', read: r => (r.durationMinutes == null ? '' : num(r.durationMinutes)) },
      { header: 'Logged by', read: r => str(r.ownerName) },
      { header: 'Company', read: r => str(r.companyName) },
      { header: 'Contact', read: r => str(r.contactName) },
      { header: 'Deal', read: r => str(r.dealName) },
      { header: 'Body', read: r => str(r.body) },
    ],
  },
  Quotes: {
    table: 'Quotes',
    select: `d.*, co."name" AS "companyName", de."name" AS "dealName", m."name" AS "ownerName"
      FROM "Quotes" d LEFT JOIN "Companies" co ON co.id::text = d."companyId" LEFT JOIN "Deals" de ON de.id::text = d."dealId" LEFT JOIN "Members" m ON m.id::text = d."ownerId"`,
    order: `d.created_at DESC`,
    columns: [
      { header: 'Number', read: r => str(r.number) },
      { header: 'Title', read: r => str(r.title) },
      { header: 'Status', read: r => str(r.status) },
      { header: 'Company', read: r => str(r.companyName) },
      { header: 'Deal', read: r => str(r.dealName) },
      { header: 'Total', read: r => (r.total == null ? '' : num(r.total)) },
      { header: 'Currency', read: r => str(r.currency) },
      { header: 'Expires on', read: r => day(r.expiresOn) },
      { header: 'Owner', read: r => str(r.ownerName) },
    ],
  },
};

/** Escaped, and a leading =/+/-/@ neutralised so a spreadsheet can't run what a stranger typed. */
function cell(v: string | number | null | undefined) {
  const s = v == null ? '' : String(v);
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export default createEndpoint({
  description: 'Export any list to CSV with the filters applied, read from the whole table rather than the open page',
  authenticated: true,
  inputSchema,
  outputSchema: z.object({ fileName: z.string(), csv: z.string(), rowCount: z.number(), truncated: z.boolean() }),
  execute: async ({ input, context }) => {
    const parsed = parseInput(inputSchema, input);
    const actor = await getActor(context);
    assertCan(actor, 'data.export');

    const plan = PLANS[parsed.scope];
    if (!plan) throw new ZiteError('There’s nothing to export for that list', 'BAD_REQUEST');
    const f = parsed.filters ?? {};
    const p = new Params();
    const where: string[] = [];

    if (f.ownerIds?.length) where.push(`d."ownerId" IN ${p.list(f.ownerIds)}`);
    if (f.stageIds?.length && plan.table === 'Deals') where.push(`d."stageId" IN ${p.list(f.stageIds)}`);
    if (f.pipelineId && plan.table === 'Deals') where.push(`d."pipelineId" = ${p.add(f.pipelineId)}`);
    if (f.status?.length) where.push(`d."status" IN ${p.list(f.status)}`);
    if (f.types?.length) where.push(`d."type" IN ${p.list(f.types)}`);
    if (f.sources?.length) where.push(`d."source" IN ${p.list(f.sources)}`);
    if (f.industries?.length) where.push(`d."industry" IN ${p.list(f.industries)}`);
    if (f.tagIds?.length && ['Deals', 'Companies', 'Contacts', 'Leads'].includes(plan.table)) where.push(jsonHasAny('d."tagIds"', p.list(f.tagIds)));
    if (f.search) where.push(`d."name" ILIKE ${p.add(`%${f.search}%`)}`);
    if (f.closedAfter && plan.table === 'Deals') where.push(`d."closeDate" >= ${p.add(f.closedAfter)}::date`);
    if (f.closedBefore && plan.table === 'Deals') where.push(`d."closeDate" <= ${p.add(f.closedBefore)}::date`);
    if (!f.includeArchived && ['Deals', 'Companies', 'Contacts'].includes(plan.table)) where.push(`COALESCE(d."archived", false) = false`);

    const limit = Math.min(parsed.limit ?? 2000, 2000);
    const { rows, truncated } = await zite.sql({
      query: `SELECT ${plan.select} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY ${plan.order} LIMIT ${limit + 1}`,
      params: p.values,
    });
    const capped = rows.length > limit;
    const data = capped ? rows.slice(0, limit) : rows;

    const defs = plan.object ? (await loadFieldDefs(plan.object, false)) : [];
    const columns: Column[] = [
      ...plan.columns,
      ...(plan.table === 'Deals' || plan.table === 'Companies' || plan.table === 'Contacts' || plan.table === 'Leads'
        ? [{ header: 'Tags', read: (r: Record<string, unknown>) => idList(r.tagIds).length.toString() }]
        : []),
      ...defs.map<Column>(def => ({ header: def.label, read: r => displayValue(def, parseCustomValues(r.customFields)[def.key]) })),
    ];
    // Tags export as names, not a count — resolve them once for the whole file.
    const tagNames = new Map<string, string>();
    if (columns.some(c => c.header === 'Tags')) {
      const { rows: tags } = await zite.sql({ query: `SELECT id, "name" FROM "Tags"`, params: [] });
      for (const t of tags) tagNames.set(String(t.id), str(t.name) ?? '');
      const index = columns.findIndex(c => c.header === 'Tags');
      columns[index] = { header: 'Tags', read: r => idList(r.tagIds).map(x => tagNames.get(x) ?? '').filter(Boolean).join('; ') };
    }

    const csv = [columns.map(c => cell(c.header)).join(','), ...data.map(r => columns.map(c => cell(c.read(r))).join(','))].join('\n');
    const stamp = new Date().toISOString().slice(0, 10);
    await logEvent({ kind: 'data.exported', entity: { type: 'settings', id: parsed.scope }, actorId: actor.id, summary: `exported ${data.length} ${parsed.scope.toLowerCase()} to CSV` });

    return { fileName: `${parsed.scope.toLowerCase()}-${stamp}.csv`, csv, rowCount: data.length, truncated: capped || truncated === true };
  },
});
