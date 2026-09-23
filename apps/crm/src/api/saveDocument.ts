import { z } from 'zod';
import { createEndpoint } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { assertCan, getActor } from '@project/shared/server/actor';
import { logEvent } from '@project/shared/server/events';
import { resolveLinks } from '@project/shared/server/records';
import { withRetry } from '@project/shared/server/sql';
import { id, parseInput } from '../server/input';

const inputSchema = z.object({
  name: z.string().trim().min(1).max(240),
  url: z.string().url('That file link doesn’t look right'),
  size: z.number().int().min(0).optional(),
  contentType: z.string().max(120).optional(),
  companyId: id.nullable().optional(),
  contactId: id.nullable().optional(),
  dealId: id.nullable().optional(),
  leadId: id.nullable().optional(),
});

export default createEndpoint({
  description: 'Attach an uploaded file to a record',
  authenticated: true,
  inputSchema,
  outputSchema: z.object({ id: z.string() }),
  execute: async ({ input, context }) => {
    const data = parseInput(inputSchema, input);
    const actor = await getActor(context);
    assertCan(actor, 'records.edit');
    const links = await resolveLinks(data);
    const created = await withRetry(() =>
      zite.documents.create({ record: { name: data.name, url: data.url, size: data.size ?? null, contentType: data.contentType ?? null, uploadedById: actor.id, ...links } }),
    );
    const entity = links.dealId ? { type: 'deal' as const, id: links.dealId } : links.contactId ? { type: 'contact' as const, id: links.contactId } : links.leadId ? { type: 'lead' as const, id: links.leadId } : { type: 'company' as const, id: links.companyId ?? '' };
    if (entity.id) await logEvent({ kind: 'document.added', entity, actorId: actor.id, summary: `attached ${data.name}`, ...links });
    return { id: created.id };
  },
});
