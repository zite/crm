import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { createActivity } from '@project/shared/server/activities';
import { runTrigger } from '@project/shared/server/automations';
import { logEvent } from '@project/shared/server/events';
import { managerIds, notify } from '@project/shared/server/notify';
import { getSettings } from '@project/shared/server/settings';
import { day, num, str, withRetry } from '@project/shared/server/sql';
import { todayIn } from '@project/shared/dates';
import { EMAIL_RE } from '@project/shared/format';
import { formatMoney } from '@project/shared/money';
import { parseInput } from '../server/input';

/**
 * The buyer's answer. Unauthenticated and a write, so it is deliberately
 * narrow: the quote is found only by its token, the same NOT_FOUND covers
 * "missing" and "not yours", a honeypot field catches drive-by bots, and every
 * string is length-capped before it reaches the database.
 */
const inputSchema = z.object({
  token: z.string().trim().min(16, 'This link isn’t valid').max(64, 'This link isn’t valid').regex(/^[A-Za-z0-9]+$/, 'This link isn’t valid'),
  action: z.enum(['accept', 'decline']),
  name: z.string().trim().max(120).optional(),
  title: z.string().trim().max(120).optional(),
  email: z.string().trim().max(200).optional(),
  authorized: z.boolean().optional(),
  reason: z.string().trim().max(600).optional(),
  /** Honeypot: a real person never fills this in. */
  website: z.string().max(200).optional(),
});

const NOT_FOUND = 'This quote link is no longer valid. Ask for a new one.';

export default createEndpoint({
  description: 'Accept or decline a quote from its public link',
  inputSchema,
  outputSchema: z.object({ status: z.enum(['Accepted', 'Declined']), acceptedName: z.string().nullable(), answeredAt: z.string() }),
  execute: async ({ input }) => {
    const data = parseInput(inputSchema, input);
    if (data.website?.trim()) throw new ZiteError(NOT_FOUND, 'NOT_FOUND');

    const { rows } = await zite.sql({
      query: `SELECT q.id, q."number", q."title", q."status", q."total", q."currency", q."expiresOn", q."ownerId", q."dealId", q."companyId", q."contactId",
                c."name" AS "companyName"
              FROM "Quotes" q
              LEFT JOIN "Companies" c ON c.id::text = q."companyId"
              WHERE q."token" = $1 LIMIT 1`,
      params: [data.token],
    });
    const q = rows[0];
    const stored = q ? str(q.status) || 'Draft' : '';
    if (!q || stored === 'Draft') throw new ZiteError(NOT_FOUND, 'NOT_FOUND');

    if (stored === 'Void') throw new ZiteError('This quote has been withdrawn. Ask for a new one.', 'CONFLICT');
    if (stored === 'Accepted' || stored === 'Declined') throw new ZiteError('This quote has already been answered.', 'CONFLICT');

    const settings = await getSettings();
    const today = todayIn(settings.timezone);
    const expiresOn = day(q.expiresOn);
    if (stored === 'Expired' || (expiresOn && expiresOn < today)) throw new ZiteError('This quote expired. Ask for an up-to-date one.', 'CONFLICT');

    const quoteId = String(q.id);
    const number = str(q.number) ?? 'the quote';
    const money = formatMoney(num(q.total), str(q.currency) || settings.currency, { cents: false });
    const now = new Date().toISOString();
    const links = { dealId: str(q.dealId) || null, companyId: str(q.companyId) || null, contactId: str(q.contactId) || null };

    if (data.action === 'accept') {
      const name = (data.name ?? '').trim();
      const title = (data.title ?? '').trim();
      const email = (data.email ?? '').trim();
      if (name.length < 2) throw new ZiteError('Type your full name to accept', 'BAD_REQUEST');
      if (!title) throw new ZiteError('Add your job title', 'BAD_REQUEST');
      if (email && !EMAIL_RE.test(email)) throw new ZiteError('That email address doesn’t look right', 'BAD_REQUEST');
      if (data.authorized !== true) throw new ZiteError('Confirm you’re authorised to accept this quote', 'BAD_REQUEST');

      await withRetry(() =>
        zite.quotes.update({
          id: quoteId,
          record: { status: 'Accepted', acceptedAt: now, acceptedName: name.slice(0, 120), acceptedTitle: title.slice(0, 120), acceptedEmail: email.slice(0, 200) || null } as never,
        }),
      );

      const summary = `${name} accepted quote ${number} (${money})`;
      await createActivity(null, {
        kind: 'Note',
        subject: `Quote ${number} accepted`,
        body: `${name}${title ? `, ${title}` : ''}${email ? ` (${email})` : ''} accepted ${number} for ${money} on the quote page.`,
        occurredAt: now,
        ownerId: str(q.ownerId) || null,
        ...links,
      });
      await logEvent({ kind: 'quote.accepted', entity: { type: 'quote', id: quoteId }, actorId: null, summary, ...links });

      const managers = await managerIds();
      await notify({
        recipientIds: [str(q.ownerId), ...managers],
        kind: 'quote_accepted',
        title: `${str(q.companyName) || name} accepted ${number} — ${money}`,
        body: `${name}${title ? `, ${title}` : ''} accepted it on the quote page.`,
        link: `/quotes/${quoteId}`,
        entityType: 'quote',
        entityId: quoteId,
      });
      await runTrigger('quote.accepted', { entityType: 'quote', entityId: quoteId, actorId: null, data: { dealId: links.dealId, total: num(q.total) } });

      return { status: 'Accepted' as const, acceptedName: name, answeredAt: now };
    }

    const reason = (data.reason ?? '').trim();
    await withRetry(() => zite.quotes.update({ id: quoteId, record: { status: 'Declined', declinedAt: now, declineReason: reason.slice(0, 600) || null } as never }));

    const summary = `The buyer declined quote ${number}${reason ? ` — ${reason}` : ''}`;
    await createActivity(null, {
      kind: 'Note',
      subject: `Quote ${number} declined`,
      body: reason ? `Declined on the quote page: “${reason}”` : 'Declined on the quote page, with no reason given.',
      occurredAt: now,
      ownerId: str(q.ownerId) || null,
      ...links,
    });
    await logEvent({ kind: 'quote.declined', entity: { type: 'quote', id: quoteId }, actorId: null, summary, ...links });
    await notify({
      recipientIds: [str(q.ownerId)],
      kind: 'quote_declined',
      title: `${str(q.companyName) || 'The buyer'} declined ${number}`,
      body: reason || null,
      link: `/quotes/${quoteId}`,
      entityType: 'quote',
      entityId: quoteId,
    });
    await runTrigger('quote.declined', { entityType: 'quote', entityId: quoteId, actorId: null, data: { dealId: links.dealId, reason: reason || null } });

    return { status: 'Declined' as const, acceptedName: null, answeredAt: now };
  },
});
