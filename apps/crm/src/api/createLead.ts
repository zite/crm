import { z } from 'zod';
import { createEndpoint } from 'zitejs/backend';
import { assertCan, getActor } from '@project/shared/server/actor';
import { createLead } from '@project/shared/server/leads';
import { mergeCustomValues } from '@project/shared/server/customFields';
import { nextLeadOwner } from '@project/shared/server/leadRouting';
import { LEAD_STATUSES } from '@project/shared/constants';
import { customValues, id, parseInput, tagIds } from '../server/input';

const inputSchema = z.object({
  name: z.string().trim().max(160).optional(),
  firstName: z.string().trim().max(80).optional(),
  lastName: z.string().trim().max(80).optional(),
  email: z.string().trim().max(200).optional(),
  phone: z.string().trim().max(60).optional(),
  title: z.string().trim().max(120).optional(),
  companyName: z.string().trim().max(200).optional(),
  website: z.string().trim().max(300).optional(),
  employees: z.number().int().min(0).max(10_000_000).nullable().optional(),
  industry: z.string().max(120).optional(),
  country: z.string().max(120).optional(),
  source: z.string().max(120).optional(),
  sourceDetail: z.string().max(200).optional(),
  status: z.enum(LEAD_STATUSES).optional(),
  ownerId: id.nullable().optional(),
  /** Leave ownerId out entirely to let lead routing decide. */
  route: z.boolean().optional(),
  message: z.string().max(8000).optional(),
  tagIds: tagIds.optional(),
  customFields: customValues.optional(),
});

export default createEndpoint({
  description: 'Create a lead by hand, scoring it and routing it to an owner',
  authenticated: true,
  inputSchema,
  outputSchema: z.object({ id: z.string(), name: z.string(), score: z.number() }),
  execute: async ({ input, context }) => {
    const data = parseInput(inputSchema, input);
    const actor = await getActor(context);
    assertCan(actor, 'records.edit');
    const custom = await mergeCustomValues('Lead', null, data.customFields ?? null, { enforceRequired: true });
    const ownerId = data.route ? await nextLeadOwner() : data.ownerId === undefined ? actor.id : data.ownerId;
    return createLead(actor, {
      name: data.name ?? null,
      firstName: data.firstName ?? null,
      lastName: data.lastName ?? null,
      email: data.email ?? null,
      phone: data.phone ?? null,
      title: data.title ?? null,
      companyName: data.companyName ?? null,
      website: data.website ?? null,
      employees: data.employees ?? null,
      industry: data.industry ?? null,
      country: data.country ?? null,
      source: data.source ?? null,
      sourceDetail: data.sourceDetail ?? null,
      status: data.status ?? 'New',
      ownerId,
      message: data.message ?? null,
      tagIds: data.tagIds ?? null,
      customFields: custom ?? null,
    });
  },
});
