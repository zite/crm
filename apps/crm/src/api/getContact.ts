import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { getActor } from '@project/shared/server/actor';
import { getSettings } from '@project/shared/server/settings';
import { num, str } from '@project/shared/server/sql';
import { todayIn } from '@project/shared/dates';
import { parseInput } from '../server/input';
import { contactRowSchema, queryContacts } from '../server/contactQuery';

const inputSchema = z.object({ id: z.string().min(1), today: z.string().optional() });

export default createEndpoint({
  description: 'Load one contact with their company, pipeline figures and tab counts',
  authenticated: true,
  inputSchema,
  outputSchema: z.object({
    contact: contactRowSchema,
    company: z.object({ id: z.string(), name: z.string(), domain: z.string().nullable(), type: z.string().nullable(), industry: z.string().nullable(), logoUrl: z.string().nullable(), ownerId: z.string().nullable() }).nullable(),
    colleagues: z.array(z.object({ id: z.string(), name: z.string(), title: z.string().nullable(), avatarUrl: z.string().nullable() })),
    figures: z.object({ openPipeline: z.number(), openDeals: z.number(), wonRevenue: z.number(), wonDeals: z.number() }),
    counts: z.object({ activities: z.number(), openTasks: z.number(), documents: z.number(), deals: z.number() }),
  }),
  execute: async ({ input, context }) => {
    const { id, today: t } = parseInput(inputSchema, input);
    await getActor(context);
    const settings = await getSettings();
    const today = t && /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : todayIn(settings.timezone);

    let { contacts } = await queryContacts({ ids: [id] }, undefined, 1, today);
    if (!contacts.length) contacts = (await queryContacts({ ids: [id], archived: true }, undefined, 1, today)).contacts;
    const contact = contacts[0];
    if (!contact) throw new ZiteError('That contact doesn’t exist or was deleted', 'NOT_FOUND');

    const [companyRes, colleagueRes, figureRes, countRes] = await Promise.all([
      contact.companyId
        ? zite.sql({ query: `SELECT id, "name", "domain", "type", "industry", "logoUrl", "ownerId" FROM "Companies" WHERE id::text = $1`, params: [contact.companyId] })
        : Promise.resolve({ rows: [] as Record<string, unknown>[] }),
      contact.companyId
        ? zite.sql({
            query: `SELECT id, "name", "title", "avatarUrl" FROM "Contacts" WHERE "companyId" = $1 AND id::text <> $2 AND COALESCE("archived", false) = false ORDER BY LOWER("name") LIMIT 12`,
            params: [contact.companyId, id],
          })
        : Promise.resolve({ rows: [] as Record<string, unknown>[] }),
      zite.sql({
        query: `SELECT
            COALESCE(SUM(CASE WHEN d."status" = 'Open' THEN d."amount" END), 0) AS "openSum",
            COUNT(*) FILTER (WHERE d."status" = 'Open') AS "openTotal",
            COALESCE(SUM(CASE WHEN d."status" = 'Won' THEN d."amount" END), 0) AS "wonSum",
            COUNT(*) FILTER (WHERE d."status" = 'Won') AS "wonTotal",
            COUNT(*) AS "dealTotal"
          FROM "Deals" d
          WHERE COALESCE(d."archived", false) = false
            AND (d."contactId" = $1 OR EXISTS (SELECT 1 FROM "DealContacts" dc WHERE dc."dealId" = d.id::text AND dc."contactId" = $1))`,
        params: [id],
      }),
      zite.sql({
        query: `SELECT
            (SELECT COUNT(*) FROM "Activities" WHERE "contactId" = $1) AS "activityTotal",
            (SELECT COUNT(*) FROM "Tasks" WHERE "contactId" = $1 AND "status" = 'Open') AS "taskTotal",
            (SELECT COUNT(*) FROM "Documents" WHERE "contactId" = $1) AS "documentTotal"`,
        params: [id],
      }),
    ]);

    const c = companyRes.rows[0];
    const f = figureRes.rows[0] ?? {};
    const n = countRes.rows[0] ?? {};
    return {
      contact,
      company: c
        ? { id: String(c.id), name: str(c.name) ?? '', domain: str(c.domain) || null, type: str(c.type) || null, industry: str(c.industry) || null, logoUrl: str(c.logoUrl) || null, ownerId: str(c.ownerId) || null }
        : null,
      colleagues: colleagueRes.rows.map(r => ({ id: String(r.id), name: str(r.name) ?? '', title: str(r.title) || null, avatarUrl: str(r.avatarUrl) || null })),
      figures: { openPipeline: num(f.openSum), openDeals: num(f.openTotal), wonRevenue: num(f.wonSum), wonDeals: num(f.wonTotal) },
      counts: { activities: num(n.activityTotal), openTasks: num(n.taskTotal), documents: num(n.documentTotal), deals: num(f.dealTotal) },
    };
  },
});
