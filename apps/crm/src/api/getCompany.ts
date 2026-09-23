import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { getActor } from '@project/shared/server/actor';
import { getSettings } from '@project/shared/server/settings';
import { iso, num, str } from '@project/shared/server/sql';
import { todayIn } from '@project/shared/dates';
import { parseInput } from '../server/input';
import { companyRowSchema, queryCompanies } from '../server/companyQuery';

const inputSchema = z.object({ id: z.string().min(1), today: z.string().optional() });

/**
 * One company as a dossier: the record, who it belongs to in the group (parent
 * and subsidiaries), the money in and around it, and the counts the tabs show.
 */
export default createEndpoint({
  description: 'Load one company with its parent, subsidiaries, pipeline figures and tab counts',
  authenticated: true,
  inputSchema,
  outputSchema: z.object({
    company: companyRowSchema,
    parent: z.object({ id: z.string(), name: z.string(), domain: z.string().nullable(), type: z.string().nullable(), logoUrl: z.string().nullable() }).nullable(),
    children: z.array(z.object({ id: z.string(), name: z.string(), type: z.string().nullable(), logoUrl: z.string().nullable(), contactCount: z.number(), openDealCount: z.number() })),
    figures: z.object({
      openPipeline: z.number(),
      weightedPipeline: z.number(),
      openDeals: z.number(),
      wonRevenue: z.number(),
      wonDeals: z.number(),
      lostDeals: z.number(),
      lastWonAt: z.string().nullable(),
    }),
    counts: z.object({ contacts: z.number(), deals: z.number(), activities: z.number(), openTasks: z.number(), documents: z.number() }),
  }),
  execute: async ({ input, context }) => {
    const { id, today: t } = parseInput(inputSchema, input);
    await getActor(context);
    const settings = await getSettings();
    const today = t && /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : todayIn(settings.timezone);

    let { companies } = await queryCompanies({ ids: [id] }, undefined, 1, today);
    if (!companies.length) companies = (await queryCompanies({ ids: [id], archived: true }, undefined, 1, today)).companies;
    const company = companies[0];
    if (!company) throw new ZiteError('That company doesn’t exist or was deleted', 'NOT_FOUND');

    const [parentRes, childRes, figureRes, countRes] = await Promise.all([
      company.parentCompanyId
        ? zite.sql({ query: `SELECT id, "name", "domain", "type", "logoUrl" FROM "Companies" WHERE id::text = $1`, params: [company.parentCompanyId] })
        : Promise.resolve({ rows: [] as Record<string, unknown>[] }),
      zite.sql({
        query: `SELECT c.id, c."name", c."type", c."logoUrl",
            (SELECT COUNT(*) FROM "Contacts" ct WHERE ct."companyId" = c.id::text) AS "contactTotal",
            (SELECT COUNT(*) FROM "Deals" d WHERE d."companyId" = c.id::text AND d."status" = 'Open') AS "openDealTotal"
          FROM "Companies" c WHERE c."parentCompanyId" = $1 ORDER BY LOWER(c."name")`,
        params: [id],
      }),
      zite.sql({
        query: `SELECT
            COALESCE(SUM(CASE WHEN d."status" = 'Open' THEN d."amount" END), 0) AS "openSum",
            COALESCE(SUM(CASE WHEN d."status" = 'Open' THEN COALESCE(d."amount", 0) * COALESCE(d."probability", s."probability", 0) / 100.0 END), 0) AS "weightedSum",
            COUNT(*) FILTER (WHERE d."status" = 'Open') AS "openTotal",
            COALESCE(SUM(CASE WHEN d."status" = 'Won' THEN d."amount" END), 0) AS "wonSum",
            COUNT(*) FILTER (WHERE d."status" = 'Won') AS "wonTotal",
            COUNT(*) FILTER (WHERE d."status" = 'Lost') AS "lostTotal",
            MAX(CASE WHEN d."status" = 'Won' THEN d."closedAt" END) AS "lastWon"
          FROM "Deals" d LEFT JOIN "Stages" s ON s.id::text = d."stageId"
          WHERE d."companyId" = $1 AND COALESCE(d."archived", false) = false`,
        params: [id],
      }),
      zite.sql({
        query: `SELECT
            (SELECT COUNT(*) FROM "Contacts" WHERE "companyId" = $1 AND COALESCE("archived", false) = false) AS "contactTotal",
            (SELECT COUNT(*) FROM "Deals" WHERE "companyId" = $1 AND COALESCE("archived", false) = false) AS "dealTotal",
            (SELECT COUNT(*) FROM "Activities" WHERE "companyId" = $1) AS "activityTotal",
            (SELECT COUNT(*) FROM "Tasks" WHERE "companyId" = $1 AND "status" = 'Open') AS "taskTotal",
            (SELECT COUNT(*) FROM "Documents" WHERE "companyId" = $1) AS "documentTotal"`,
        params: [id],
      }),
    ]);

    const p = parentRes.rows[0];
    const f = figureRes.rows[0] ?? {};
    const c = countRes.rows[0] ?? {};
    return {
      company,
      parent: p ? { id: String(p.id), name: str(p.name) ?? '', domain: str(p.domain) || null, type: str(p.type) || null, logoUrl: str(p.logoUrl) || null } : null,
      children: childRes.rows.map(r => ({
        id: String(r.id),
        name: str(r.name) ?? '',
        type: str(r.type) || null,
        logoUrl: str(r.logoUrl) || null,
        contactCount: num(r.contactTotal),
        openDealCount: num(r.openDealTotal),
      })),
      figures: {
        openPipeline: num(f.openSum),
        weightedPipeline: Math.round(num(f.weightedSum) * 100) / 100,
        openDeals: num(f.openTotal),
        wonRevenue: num(f.wonSum),
        wonDeals: num(f.wonTotal),
        lostDeals: num(f.lostTotal),
        lastWonAt: iso(f.lastWon),
      },
      counts: {
        contacts: num(c.contactTotal),
        deals: num(c.dealTotal),
        activities: num(c.activityTotal),
        openTasks: num(c.taskTotal),
        documents: num(c.documentTotal),
      },
    };
  },
});
