import { z } from 'zod';
import { createEndpoint } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { assertCan, getActor } from '@project/shared/server/actor';
import { iso, json, num, ref, str } from '@project/shared/server/sql';
import { parseInput } from '../server/input';

/** The import history: what came in, who brought it, what went wrong, and what can still be undone. */

export default createEndpoint({
  description: 'The recent imports, with their counts, their errors and whether they can still be undone',
  authenticated: true,
  inputSchema: z.object({ limit: z.number().int().min(1).max(50).optional() }),
  outputSchema: z.object({
    imports: z.array(
      z.object({
        id: z.string(),
        fileName: z.string(),
        object: z.string(),
        status: z.string(),
        rowCount: z.number(),
        createdCount: z.number(),
        updatedCount: z.number(),
        skippedCount: z.number(),
        errors: z.array(z.object({ row: z.number(), message: z.string() })),
        actorId: z.string().nullable(),
        actorName: z.string().nullable(),
        createdAt: z.string().nullable(),
        undoneAt: z.string().nullable(),
        remaining: z.number(),
      }),
    ),
  }),
  execute: async ({ input, context }) => {
    const parsed = parseInput(z.object({ limit: z.number().int().min(1).max(50).optional() }), input);
    const actor = await getActor(context);
    assertCan(actor, 'data.import');

    const { rows } = await zite.sql({
      query: `
        SELECT i.*, m."name" AS "actorName",
          (SELECT COUNT(*) FROM "Companies" c WHERE c."importId" = i.id::text)
          + (SELECT COUNT(*) FROM "Contacts" ct WHERE ct."importId" = i.id::text)
          + (SELECT COUNT(*) FROM "Deals" d WHERE d."importId" = i.id::text)
          + (SELECT COUNT(*) FROM "Leads" l WHERE l."importId" = i.id::text) AS "remaining"
        FROM "Imports" i
        LEFT JOIN "Members" m ON m.id::text = i."actorId"
        ORDER BY i.created_at DESC
        LIMIT $1`,
      params: [parsed.limit ?? 20],
    });

    return {
      imports: rows.map(r => ({
        id: String(r.id),
        fileName: str(r.fileName) ?? 'import.csv',
        object: str(r.object) ?? 'Companies',
        status: str(r.status) ?? 'Completed',
        rowCount: num(r.rowCount),
        createdCount: num(r.createdCount),
        updatedCount: num(r.updatedCount),
        skippedCount: num(r.skippedCount),
        errors: json<Array<{ row: number; message: string }>>(r.errors, []),
        actorId: ref(r.actorId),
        actorName: str(r.actorName) || null,
        createdAt: iso(r.created_at),
        undoneAt: iso(r.undoneAt),
        remaining: num(r.remaining),
      })),
    };
  },
});
