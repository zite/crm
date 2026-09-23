import { z } from 'zod';
import { createEndpoint } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { getActor } from '@project/shared/server/actor';
import { iso, numOrNull, ref, str } from '@project/shared/server/sql';
import { ENTITY_COLUMN } from '@project/shared/constants';
import { parseInput } from '../server/input';
import { documentRowSchema, entityRef } from '../server/schemas';

export default createEndpoint({
  description: 'Files attached to a record',
  authenticated: true,
  inputSchema: entityRef,
  outputSchema: z.object({ documents: z.array(documentRowSchema) }),
  execute: async ({ input, context }) => {
    const { type, id } = parseInput(entityRef, input);
    await getActor(context);
    const { rows } = await zite.sql({ query: `SELECT * FROM "Documents" WHERE "${ENTITY_COLUMN[type]}" = $1 ORDER BY created_at DESC LIMIT 200`, params: [id] });
    return {
      documents: rows.map(r => ({
        id: String(r.id),
        name: str(r.name) ?? '',
        url: str(r.url) ?? '',
        size: numOrNull(r.size),
        contentType: str(r.contentType) || null,
        uploadedById: ref(r.uploadedById),
        createdAt: iso(r.created_at),
        companyId: ref(r.companyId),
        contactId: ref(r.contactId),
        dealId: ref(r.dealId),
        leadId: ref(r.leadId),
      })),
    };
  },
});
