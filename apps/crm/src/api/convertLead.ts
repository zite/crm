import { z } from 'zod';
import { createEndpoint } from 'zitejs/backend';
import { assertCan, getActor } from '@project/shared/server/actor';
import { convertLead } from '@project/shared/server/leads';
import { getSettings } from '@project/shared/server/settings';
import { todayIn } from '@project/shared/dates';
import { day, id, money, parseInput } from '../server/input';

const inputSchema = z.object({
  leadId: id,
  /** match: link the domain match, else make one from the lead. */
  company: z.object({ mode: z.enum(['match', 'existing', 'new', 'none']), companyId: id.nullable().optional(), name: z.string().trim().max(200).optional(), domain: z.string().trim().max(200).optional() }).optional(),
  /** match: link the contact with this email, else make one. */
  contact: z.object({ mode: z.enum(['match', 'existing', 'new']), contactId: id.nullable().optional() }).optional(),
  deal: z.object({ create: z.boolean(), name: z.string().trim().max(240).optional(), amount: money.nullable().optional(), pipelineId: id.nullable().optional(), stageId: id.nullable().optional(), closeDate: day.nullable().optional(), ownerId: id.nullable().optional() }).optional(),
  ownerId: id.nullable().optional(),
  today: day.optional(),
});

/**
 * Convert a lead into a contact, a company and (usually) a deal. Idempotent:
 * a lead that already carries `convertedAt` returns what it became instead of
 * making a second set of records.
 */
export default createEndpoint({
  description: 'Convert a lead into a contact, company and optionally a deal, carrying its activities and tasks across',
  authenticated: true,
  inputSchema,
  outputSchema: z.object({
    leadId: z.string(),
    contactId: z.string().nullable(),
    companyId: z.string().nullable(),
    dealId: z.string().nullable(),
    contactName: z.string().nullable(),
    companyName: z.string().nullable(),
    dealName: z.string().nullable(),
    alreadyConverted: z.boolean(),
  }),
  execute: async ({ input, context }) => {
    const data = parseInput(inputSchema, input);
    const actor = await getActor(context);
    assertCan(actor, 'records.edit');
    const settings = await getSettings();
    return convertLead(actor, data.leadId, {
      company: data.company,
      contact: data.contact,
      deal: data.deal,
      ownerId: data.ownerId,
      today: data.today ?? todayIn(settings.timezone),
    });
  },
});
