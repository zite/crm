import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { getActor } from '@project/shared/server/actor';
import { getSettings } from '@project/shared/server/settings';
import { matchCompanies, matchContact } from '@project/shared/server/leads';
import { scoreLead } from '@project/shared/leads';
import { num, str } from '@project/shared/server/sql';
import { parseInput } from '../server/input';
import { leadRowSchema, queryLeads } from '../features/leads/leadQuery';

const inputSchema = z.object({ id: z.string().min(1).max(64), matches: z.boolean().optional() });

/**
 * One lead, with everything the page and the review deck need: the record, why
 * it scores what it scores, what it became if it was converted, and — when the
 * convert dialog asks — the companies and contact it would link to.
 */
export default createEndpoint({
  description: 'Load one lead with its score reasons, converted records and possible company/contact matches',
  authenticated: true,
  inputSchema,
  outputSchema: z.object({
    lead: leadRowSchema,
    scoreReasons: z.array(z.string()),
    converted: z.object({
      contact: z.object({ id: z.string(), name: z.string(), email: z.string().nullable(), title: z.string().nullable() }).nullable(),
      company: z.object({ id: z.string(), name: z.string(), domain: z.string().nullable() }).nullable(),
      deal: z.object({ id: z.string(), name: z.string(), amount: z.number().nullable(), status: z.string() }).nullable(),
    }),
    matches: z.object({
      companies: z.array(z.object({ id: z.string(), name: z.string(), domain: z.string().nullable(), type: z.string().nullable(), ownerId: z.string().nullable(), contactCount: z.number() })),
      contact: z.object({ id: z.string(), name: z.string(), email: z.string().nullable(), title: z.string().nullable(), companyId: z.string().nullable(), companyName: z.string().nullable(), ownerId: z.string().nullable() }).nullable(),
    }),
    counts: z.object({ activities: z.number(), openTasks: z.number(), documents: z.number(), submissions: z.number() }),
  }),
  execute: async ({ input, context }) => {
    const { id, matches: wantMatches = false } = parseInput(inputSchema, input);
    await getActor(context);
    const settings = await getSettings();
    const { leads } = await queryLeads({ ids: [id] }, undefined, 1, { responseHours: settings.preferences.leadResponseHours });
    const lead = leads[0];
    if (!lead) throw new ZiteError('That lead doesn’t exist or was deleted', 'NOT_FOUND');

    const [contact, company, deal, counts, companyMatches, contactMatch] = await Promise.all([
      lead.convertedContactId ? zite.sql({ query: `SELECT id, "name", "email", "title" FROM "Contacts" WHERE id::text = $1`, params: [lead.convertedContactId] }) : Promise.resolve({ rows: [] as Record<string, unknown>[] }),
      lead.convertedCompanyId ? zite.sql({ query: `SELECT id, "name", "domain" FROM "Companies" WHERE id::text = $1`, params: [lead.convertedCompanyId] }) : Promise.resolve({ rows: [] as Record<string, unknown>[] }),
      lead.convertedDealId ? zite.sql({ query: `SELECT id, "name", "amount", "status" FROM "Deals" WHERE id::text = $1`, params: [lead.convertedDealId] }) : Promise.resolve({ rows: [] as Record<string, unknown>[] }),
      zite.sql({
        query: `SELECT
          (SELECT COUNT(*) FROM "Activities" WHERE "leadId" = $1) AS "activityTotal",
          (SELECT COUNT(*) FROM "Tasks" WHERE "leadId" = $1 AND "status" = 'Open') AS "taskTotal",
          (SELECT COUNT(*) FROM "Documents" WHERE "leadId" = $1) AS "documentTotal",
          (SELECT COUNT(*) FROM "Submissions" WHERE "leadId" = $1) AS "submissionTotal"`,
        params: [id],
      }),
      wantMatches && !lead.convertedAt ? matchCompanies(lead) : Promise.resolve([]),
      wantMatches && !lead.convertedAt ? matchContact(lead.email) : Promise.resolve(null),
    ]);

    const c = counts.rows[0] ?? {};
    const row = (rows: Record<string, unknown>[]) => rows[0];
    return {
      lead,
      scoreReasons: scoreLead(lead).reasons,
      converted: {
        contact: row(contact.rows) ? { id: String(contact.rows[0].id), name: str(contact.rows[0].name) ?? '', email: str(contact.rows[0].email) || null, title: str(contact.rows[0].title) || null } : null,
        company: row(company.rows) ? { id: String(company.rows[0].id), name: str(company.rows[0].name) ?? '', domain: str(company.rows[0].domain) || null } : null,
        deal: row(deal.rows) ? { id: String(deal.rows[0].id), name: str(deal.rows[0].name) ?? '', amount: deal.rows[0].amount == null ? null : num(deal.rows[0].amount), status: str(deal.rows[0].status) || 'Open' } : null,
      },
      matches: { companies: companyMatches, contact: contactMatch },
      counts: { activities: num(c.activityTotal), openTasks: num(c.taskTotal), documents: num(c.documentTotal), submissions: num(c.submissionTotal) },
    };
  },
});
