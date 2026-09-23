import { z } from 'zod';
import { createEndpoint } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { assertCan, getActor } from '@project/shared/server/actor';
import { bool, num, numOrNull, str } from '@project/shared/server/sql';
import { id, parseInput } from '../server/input';

/**
 * One pipeline, in the detail only its editor needs: each stage's guidance
 * text and how many deals are sitting in it. The workspace bootstrap carries
 * the stage list every screen uses, and stays small by leaving these out.
 */

const inputSchema = z.object({ pipelineId: id });

export default createEndpoint({
  description: 'A pipeline’s stages with their guidance text and how many deals each one holds',
  authenticated: true,
  inputSchema,
  outputSchema: z.object({
    stages: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        kind: z.string(),
        position: z.number(),
        probability: z.number(),
        rottingDays: z.number().nullable(),
        guidance: z.string().nullable(),
        archived: z.boolean(),
        dealCount: z.number(),
        openDealCount: z.number(),
      }),
    ),
  }),
  execute: async ({ input, context }) => {
    const { pipelineId } = parseInput(inputSchema, input);
    const actor = await getActor(context);
    assertCan(actor, 'settings.manage');

    const { rows } = await zite.sql({
      query: `
        SELECT s.*,
          (SELECT COUNT(*) FROM "Deals" d WHERE d."stageId" = s.id::text) AS "dealCount",
          (SELECT COUNT(*) FROM "Deals" d WHERE d."stageId" = s.id::text AND d."status" = 'Open') AS "openDealCount"
        FROM "Stages" s
        WHERE s."pipelineId" = $1
        ORDER BY COALESCE(s."position", 0), s.created_at`,
      params: [pipelineId],
    });

    return {
      stages: rows.map(r => ({
        id: String(r.id),
        name: str(r.name) ?? '',
        kind: str(r.kind) || 'Open',
        position: num(r.position),
        probability: num(r.probability),
        rottingDays: numOrNull(r.rottingDays),
        guidance: str(r.guidance) || null,
        archived: bool(r.archived),
        dealCount: num(r.dealCount),
        openDealCount: num(r.openDealCount),
      })),
    };
  },
});
