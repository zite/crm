import { z } from 'zod';
import { createEndpoint } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { getActor } from '@project/shared/server/actor';
import { can, canManageAsset } from '@project/shared/roles';
import { bool, iso, num, ref, str } from '@project/shared/server/sql';
import { parseInput } from '../server/input';

/**
 * Email templates a person may see: the ones shared with the team, their own,
 * and — for managers and admins — everyone's. Bodies come back with the list
 * because templates are short and both the editor and the composer's picker
 * need them immediately.
 */
const inputSchema = z.object({ includeArchived: z.boolean().optional(), limit: z.number().int().min(1).max(500).optional() });

const templateSchema = z.object({
  id: z.string(),
  name: z.string(),
  subject: z.string(),
  body: z.string(),
  category: z.string(),
  ownerId: z.string().nullable(),
  shared: z.boolean(),
  archived: z.boolean(),
  useCount: z.number(),
  lastUsedAt: z.string().nullable(),
  createdAt: z.string().nullable(),
  canManage: z.boolean(),
});

export default createEndpoint({
  description: 'List the email templates this person can use, with their bodies',
  authenticated: true,
  inputSchema,
  outputSchema: z.object({ templates: z.array(templateSchema), categories: z.array(z.string()) }),
  execute: async ({ input, context }) => {
    const { includeArchived = false, limit = 400 } = parseInput(inputSchema, input);
    const actor = await getActor(context);
    const seesEverything = can(actor.role, 'outreach.manage');

    const { rows } = await zite.sql({
      query: `
        SELECT id, "name", "subject", "body", "category", "ownerId", "shared", "archived", "useCount", "lastUsedAt", created_at
        FROM "EmailTemplates"
        WHERE ($1 OR COALESCE("archived", false) = false)
          AND ($2 OR COALESCE("shared", false) = true OR "ownerId" = $3)
        ORDER BY LOWER("name") ASC
        LIMIT $4`,
      params: [includeArchived, seesEverything, actor.id, limit],
    });

    const templates = rows.map(r => {
      const ownerId = ref(r.ownerId);
      return {
        id: String(r.id),
        name: str(r.name) ?? '',
        subject: str(r.subject) ?? '',
        body: str(r.body) ?? '',
        category: str(r.category) ?? '',
        ownerId,
        shared: bool(r.shared),
        archived: bool(r.archived),
        useCount: num(r.useCount),
        lastUsedAt: iso(r.lastUsedAt),
        createdAt: iso(r.created_at),
        canManage: canManageAsset(actor.role, actor.id, ownerId),
      };
    });
    return { templates, categories: [...new Set(templates.map(t => t.category).filter(Boolean))].sort() };
  },
});
