import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { assertCan, assertMember, getActor } from '@project/shared/server/actor';
import { runTrigger } from '@project/shared/server/automations';
import { mergeCustomValues } from '@project/shared/server/customFields';
import { logEvent } from '@project/shared/server/events';
import { notify } from '@project/shared/server/notify';
import { withRetry } from '@project/shared/server/sql';
import { COMPANY_TYPES } from '@project/shared/constants';
import { customValues, day, id, parseInput, tagIds } from '../server/input';
import { normalizeDomain } from '../server/companyQuery';

const inputSchema = z.object({
  name: z.string().trim().min(1, 'Give the company a name').max(240),
  domain: z.string().max(240).nullable().optional(),
  website: z.string().max(500).nullable().optional(),
  industry: z.string().max(120).nullable().optional(),
  type: z.enum(COMPANY_TYPES).nullable().optional(),
  employees: z.number().int().min(0).max(100_000_000).nullable().optional(),
  annualRevenue: z.number().min(0).max(1_000_000_000_000).nullable().optional(),
  ownerId: id.nullable().optional(),
  parentCompanyId: id.nullable().optional(),
  phone: z.string().max(60).nullable().optional(),
  linkedinUrl: z.string().max(500).nullable().optional(),
  address: z.string().max(240).nullable().optional(),
  city: z.string().max(120).nullable().optional(),
  region: z.string().max(120).nullable().optional(),
  postalCode: z.string().max(40).nullable().optional(),
  country: z.string().max(120).nullable().optional(),
  description: z.string().max(20_000).nullable().optional(),
  source: z.string().max(120).nullable().optional(),
  customerSince: day.nullable().optional(),
  logoUrl: z.string().max(1000).nullable().optional(),
  tagIds: tagIds.optional(),
  customFields: customValues.optional(),
  /** Refuse when another company already has this domain (the create dialog offers to open it instead). */
  failOnDuplicate: z.boolean().optional(),
});

export default createEndpoint({
  description: 'Create a company',
  authenticated: true,
  inputSchema,
  outputSchema: z.object({ id: z.string(), duplicateId: z.string().nullable() }),
  execute: async ({ input, context }) => {
    const data = parseInput(inputSchema, input);
    const actor = await getActor(context);
    assertCan(actor, 'records.edit');

    const domain = normalizeDomain(data.domain ?? data.website ?? null);
    if (domain) {
      const { rows } = await zite.sql({ query: `SELECT id, "name" FROM "Companies" WHERE LOWER("domain") = $1 LIMIT 1`, params: [domain] });
      if (rows[0] && data.failOnDuplicate) {
        throw new ZiteError(`${String(rows[0].name)} already uses ${domain}`, 'CONFLICT');
      }
    }
    if (data.parentCompanyId) {
      const { rows } = await zite.sql({ query: `SELECT 1 FROM "Companies" WHERE id::text = $1`, params: [data.parentCompanyId] });
      if (!rows[0]) throw new ZiteError('That parent company no longer exists', 'BAD_REQUEST');
    }
    await assertMember(data.ownerId ?? null);
    const custom = await mergeCustomValues('Company', null, data.customFields ?? null, { enforceRequired: true });

    const created = await withRetry(() =>
      zite.companies.create({
        record: {
          name: data.name.slice(0, 240),
          domain: domain || null,
          website: data.website || null,
          industry: data.industry || null,
          type: data.type ?? 'Prospect',
          employees: data.employees ?? null,
          annualRevenue: data.annualRevenue ?? null,
          ownerId: data.ownerId === undefined ? actor.id : data.ownerId,
          parentCompanyId: data.parentCompanyId || null,
          phone: data.phone || null,
          linkedinUrl: data.linkedinUrl || null,
          address: data.address || null,
          city: data.city || null,
          region: data.region || null,
          postalCode: data.postalCode || null,
          country: data.country || null,
          description: data.description || null,
          source: data.source || null,
          customerSince: data.customerSince ?? null,
          logoUrl: data.logoUrl || null,
          tagIds: data.tagIds?.length ? JSON.stringify(data.tagIds) : null,
          customFields: custom ?? null,
        },
      }),
    );

    await logEvent({ kind: 'company.created', entity: { type: 'company', id: created.id }, actorId: actor.id, summary: `added the company` });
    const ownerId = data.ownerId === undefined ? actor.id : data.ownerId;
    if (ownerId && ownerId !== actor.id) {
      await notify({ recipientIds: [ownerId], kind: 'assigned', title: `${actor.name} gave you a company: ${data.name}`, link: `/companies/${created.id}`, entityType: 'company', entityId: created.id, actorId: actor.id });
    }
    await runTrigger('company.created', { entityType: 'company', entityId: created.id, actorId: actor.id });

    // Tell the caller about an existing record on the same domain so it can offer a merge.
    let duplicateId: string | null = null;
    if (domain) {
      const { rows } = await zite.sql({ query: `SELECT id FROM "Companies" WHERE LOWER("domain") = $1 AND id::text <> $2 LIMIT 1`, params: [domain, created.id] });
      duplicateId = rows[0] ? String(rows[0].id) : null;
    }
    return { id: created.id, duplicateId };
  },
});
