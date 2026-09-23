import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { assertCan, getActor } from '@project/shared/server/actor';
import { logEvent } from '@project/shared/server/events';
import { getSettings, updateSettings, type LeadRouting } from '@project/shared/server/settings';
import { CURRENCIES, ROLES } from '@project/shared/constants';
import { isValidTimezone } from '@project/shared/dates';
import { parseInput } from '../server/input';

/**
 * The organization's own settings: how it is named and branded, what money and
 * calendar it keeps, the words that go in every email footer, and the handful
 * of preferences that change how the app behaves for everyone.
 *
 * `pagesUrl` is deliberately not writable — CRM Pages records its own address
 * the first time a buyer opens it, so the link in an email is always the one
 * that works.
 */

const routing = z.object({
  mode: z.enum(['round_robin', 'member', 'unassigned']),
  memberIds: z.array(z.string().min(1)).max(100),
  memberId: z.string().min(1).nullable(),
});

const preferences = z.object({
  stalledEnabled: z.boolean(),
  requireLostReason: z.boolean(),
  dailyDigest: z.boolean(),
  leadResponseHours: z.number().int().min(1).max(336),
});

const inputSchema = z
  .object({
    organizationName: z.string().trim().min(1, 'Give your organization a name').max(120),
    logoUrl: z.string().trim().max(600).nullable(),
    brandColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a colour like #1d4e80'),
    currency: z.enum(CURRENCIES),
    timezone: z.string().min(1).max(64),
    fiscalYearStartMonth: z.number().int().min(1).max(12),
    mailingAddress: z.string().max(400),
    emailFooter: z.string().max(600),
    defaultRole: z.enum(ROLES),
    leadRouting: routing,
    preferences,
  })
  .partial();

export default createEndpoint({
  description: 'Change the organization’s settings: name, branding, currency, calendar, email footer, lead routing and preferences',
  authenticated: true,
  inputSchema,
  outputSchema: z.object({ saved: z.array(z.string()) }),
  execute: async ({ input, context }) => {
    const patch = parseInput(inputSchema, input);
    const actor = await getActor(context);
    assertCan(actor, 'settings.manage');
    if (!Object.keys(patch).length) throw new ZiteError('Nothing to change', 'BAD_REQUEST');

    const settings = await getSettings();

    if (patch.timezone && !isValidTimezone(patch.timezone)) throw new ZiteError('That isn’t a timezone we recognise', 'BAD_REQUEST');
    if (patch.logoUrl && !/^https:\/\//i.test(patch.logoUrl)) throw new ZiteError('A logo needs a full https:// address', 'BAD_REQUEST');

    // Pulled out of the patch: both are merged into what is already stored rather than replacing it.
    const { leadRouting: routingPatch, preferences: preferencesPatch, ...rest } = patch;
    let leadRouting: LeadRouting | undefined = routingPatch ? { ...settings.leadRouting, ...routingPatch } : undefined;
    if (leadRouting) {
      const ids = [...new Set([...leadRouting.memberIds, ...(leadRouting.memberId ? [leadRouting.memberId] : [])])];
      if (ids.length) {
        const { rows } = await zite.sql({
          query: `SELECT id FROM "Members" WHERE "status" <> 'Deactivated' AND id::text IN (${ids.map((_, i) => `$${i + 1}`).join(', ')})`,
          params: ids,
        });
        const live = new Set(rows.map(r => String(r.id)));
        leadRouting = { ...leadRouting, memberIds: leadRouting.memberIds.filter(id => live.has(id)), memberId: leadRouting.memberId && live.has(leadRouting.memberId) ? leadRouting.memberId : null };
      }
      if (leadRouting.mode === 'round_robin' && !leadRouting.memberIds.length) throw new ZiteError('Choose at least one teammate for the round robin', 'BAD_REQUEST');
      if (leadRouting.mode === 'member' && !leadRouting.memberId) throw new ZiteError('Choose the teammate new leads should go to', 'BAD_REQUEST');
      // A changed pool starts its rotation again, so nobody is skipped.
      leadRouting = { ...leadRouting, cursor: 0 };
    }

    await updateSettings(settings.id, {
      ...rest,
      ...(leadRouting ? { leadRouting } : {}),
      ...(preferencesPatch ? { preferences: { ...settings.preferences, ...preferencesPatch } } : {}),
    });

    const saved = Object.keys(patch);
    await logEvent({
      kind: 'settings.updated',
      entity: { type: 'settings', id: settings.id },
      actorId: actor.id,
      summary: `changed ${saved.length === 1 ? LABELS[saved[0]] ?? 'a setting' : `${saved.length} settings`}`,
      data: { fields: saved },
    });
    return { saved };
  },
});

const LABELS: Record<string, string> = {
  organizationName: 'the organization name',
  logoUrl: 'the logo',
  brandColor: 'the brand colour',
  currency: 'the currency',
  timezone: 'the timezone',
  fiscalYearStartMonth: 'the fiscal year',
  mailingAddress: 'the mailing address',
  emailFooter: 'the email footer',
  defaultRole: 'the default role',
  leadRouting: 'lead routing',
  preferences: 'the organization’s preferences',
};
