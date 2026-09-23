import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { getActor } from '@project/shared/server/actor';
import { getSettings } from '@project/shared/server/settings';
import { iso, num, numOrNull, ref, str } from '@project/shared/server/sql';
import { todayIn } from '@project/shared/dates';
import { parseInput } from '../server/input';
import { dealRowSchema } from '../server/schemas';
import { queryDeals } from '../server/dealQuery';

const inputSchema = z.object({ id: z.string().min(1), today: z.string().optional() });

export default createEndpoint({
  description: 'Load one deal with its buying group, line item and quote summary, and stage history',
  authenticated: true,
  inputSchema,
  outputSchema: z.object({
    deal: dealRowSchema.extend({ description: z.string().nullable(), closeNote: z.string().nullable(), createdAt: z.string().nullable() }),
    company: z.object({ id: z.string(), name: z.string(), domain: z.string().nullable(), type: z.string().nullable(), industry: z.string().nullable(), employees: z.number().nullable(), ownerId: z.string().nullable(), logoUrl: z.string().nullable() }).nullable(),
    contacts: z.array(z.object({ linkId: z.string(), contactId: z.string(), name: z.string(), title: z.string().nullable(), email: z.string().nullable(), phone: z.string().nullable(), role: z.string().nullable(), isPrimary: z.boolean(), lastActivityAt: z.string().nullable() })),
    lineItems: z.object({ count: z.number(), total: z.number() }),
    quotes: z.array(z.object({ id: z.string(), number: z.string(), title: z.string().nullable(), status: z.string(), total: z.number(), sentAt: z.string().nullable(), acceptedAt: z.string().nullable(), expiresOn: z.string().nullable() })),
    stageHistory: z.array(z.object({ id: z.string(), fromStageId: z.string().nullable(), toStageId: z.string(), changedAt: z.string(), actorId: z.string().nullable(), amount: z.number().nullable() })),
    counts: z.object({ activities: z.number(), openTasks: z.number(), documents: z.number() }),
  }),
  execute: async ({ input, context }) => {
    const { id, today: t } = parseInput(inputSchema, input);
    await getActor(context);
    const settings = await getSettings();
    const today = t && /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : todayIn(settings.timezone);
    const [{ deals }, raw] = await Promise.all([
      queryDeals({ ids: [id], archived: undefined }, undefined, 1, today),
      zite.sql({ query: `SELECT "description", "closeNote", "archived", created_at FROM "Deals" WHERE id::text = $1`, params: [id] }),
    ]);
    let row = deals[0];
    if (!row && raw.rows[0]) row = (await queryDeals({ ids: [id], archived: true }, undefined, 1, today)).deals[0];
    if (!row || !raw.rows[0]) throw new ZiteError('That deal doesn’t exist or was deleted', 'NOT_FOUND');

    const [company, contacts, items, quotes, history, counts] = await Promise.all([
      row.companyId ? zite.sql({ query: `SELECT id, "name", "domain", "type", "industry", "employees", "ownerId", "logoUrl" FROM "Companies" WHERE id::text = $1`, params: [row.companyId] }) : Promise.resolve({ rows: [] as Record<string, unknown>[] }),
      zite.sql({
        query: `SELECT dc.id AS "linkId", dc."role", c.id, c."name", c."title", c."email", c."phone", c."lastActivityAt"
          FROM "DealContacts" dc JOIN "Contacts" c ON c.id::text = dc."contactId"
          WHERE dc."dealId" = $1 ORDER BY c."name"`,
        params: [id],
      }),
      zite.sql({ query: `SELECT COUNT(*) AS "itemTotal" FROM "LineItems" WHERE "dealId" = $1`, params: [id] }),
      zite.sql({ query: `SELECT id, "number", "title", "status", "total", "sentAt", "acceptedAt", "expiresOn" FROM "Quotes" WHERE "dealId" = $1 ORDER BY created_at DESC`, params: [id] }),
      zite.sql({ query: `SELECT id, "fromStageId", "toStageId", "changedAt", "actorId", "amount" FROM "StageChanges" WHERE "dealId" = $1 ORDER BY "changedAt" ASC`, params: [id] }),
      zite.sql({
        query: `SELECT
          (SELECT COUNT(*) FROM "Activities" WHERE "dealId" = $1) AS "activityTotal",
          (SELECT COUNT(*) FROM "Tasks" WHERE "dealId" = $1 AND "status" = 'Open') AS "taskTotal",
          (SELECT COUNT(*) FROM "Documents" WHERE "dealId" = $1) AS "documentTotal"`,
        params: [id],
      }),
    ]);
    const c = company.rows[0];
    const r0 = raw.rows[0];
    return {
      deal: { ...row, description: str(r0.description) || null, closeNote: str(r0.closeNote) || null, createdAt: iso(r0.created_at) },
      company: c ? { id: String(c.id), name: str(c.name) ?? '', domain: str(c.domain) || null, type: str(c.type) || null, industry: str(c.industry) || null, employees: numOrNull(c.employees), ownerId: ref(c.ownerId), logoUrl: str(c.logoUrl) || null } : null,
      contacts: contacts.rows.map(r => ({ linkId: String(r.linkId), contactId: String(r.id), name: str(r.name) ?? '', title: str(r.title) || null, email: str(r.email) || null, phone: str(r.phone) || null, role: str(r.role) || null, isPrimary: String(r.id) === row.contactId, lastActivityAt: iso(r.lastActivityAt) })),
      lineItems: { count: num(items.rows[0]?.itemTotal), total: row.amount ?? 0 },
      quotes: quotes.rows.map(q => ({ id: String(q.id), number: str(q.number) ?? '', title: str(q.title) || null, status: str(q.status) || 'Draft', total: num(q.total), sentAt: iso(q.sentAt), acceptedAt: iso(q.acceptedAt), expiresOn: q.expiresOn ? String(q.expiresOn).slice(0, 10) : null })),
      stageHistory: history.rows.map(h => ({ id: String(h.id), fromStageId: ref(h.fromStageId), toStageId: str(h.toStageId) ?? '', changedAt: iso(h.changedAt) ?? '', actorId: ref(h.actorId), amount: numOrNull(h.amount) })),
      counts: { activities: num(counts.rows[0]?.activityTotal), openTasks: num(counts.rows[0]?.taskTotal), documents: num(counts.rows[0]?.documentTotal) },
    };
  },
});
