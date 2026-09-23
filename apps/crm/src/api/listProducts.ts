import { z } from 'zod';
import { createEndpoint } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { getActor } from '@project/shared/server/actor';
import { bool, num, str, Params } from '@project/shared/server/sql';
import { parseInput } from '../server/input';

const inputSchema = z.object({
  search: z.string().max(120).optional(),
  category: z.string().max(80).optional(),
  /** 'active' (default), 'archived' or 'all'. */
  state: z.enum(['active', 'archived', 'all']).optional(),
  limit: z.number().int().min(1).max(2000).optional(),
});

/** The price book, with how many deals each product is priced on. */
export default createEndpoint({
  description: 'List price-book products with their usage',
  authenticated: true,
  inputSchema,
  outputSchema: z.object({
    products: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        sku: z.string(),
        description: z.string(),
        unitPrice: z.number(),
        billing: z.string(),
        category: z.string(),
        active: z.boolean(),
        usageCount: z.number(),
        createdAt: z.string().nullable(),
      }),
    ),
    categories: z.array(z.string()),
  }),
  execute: async ({ input, context }) => {
    const { search, category, state = 'active', limit = 500 } = parseInput(inputSchema, input);
    await getActor(context);

    const params = new Params();
    const where: string[] = [];
    if (state === 'active') where.push(`COALESCE(p."active", false) = true`);
    if (state === 'archived') where.push(`COALESCE(p."active", false) = false`);
    if (category) where.push(`p."category" = ${params.add(category)}`);
    if (search?.trim()) {
      const term = params.add(`%${search.trim().toLowerCase()}%`);
      where.push(`(LOWER(p."name") LIKE ${term} OR LOWER(p."sku") LIKE ${term} OR LOWER(p."category") LIKE ${term})`);
    }

    const [{ rows }, { rows: cats }] = await Promise.all([
      zite.sql({
        query: `SELECT p.id, p."name", p."sku", p."description", p."unitPrice", p."billing", p."category", p."active", p.created_at,
                  (SELECT COUNT(*) FROM "LineItems" li WHERE li."productId" = p.id::text) AS "usageTotal"
                FROM "Products" p
                ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
                ORDER BY LOWER(COALESCE(p."category", '')), LOWER(p."name")
                LIMIT ${Math.min(2000, limit)}`,
        params: params.values,
      }),
      zite.sql({ query: `SELECT DISTINCT "category" FROM "Products" WHERE COALESCE("category", '') <> '' ORDER BY "category"`, params: [] }),
    ]);

    return {
      products: rows.map(r => ({
        id: String(r.id),
        name: str(r.name) ?? '',
        sku: str(r.sku) ?? '',
        description: str(r.description) ?? '',
        unitPrice: num(r.unitPrice),
        billing: str(r.billing) || 'One-time',
        category: str(r.category) ?? '',
        active: bool(r.active),
        usageCount: num(r.usageTotal),
        createdAt: r.created_at ? new Date(String(r.created_at)).toISOString() : null,
      })),
      categories: cats.map(r => String(r.category)),
    };
  },
});
