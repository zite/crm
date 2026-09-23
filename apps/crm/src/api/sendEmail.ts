import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { assertCan, getActor, memberById } from '@project/shared/server/actor';
import { createActivity } from '@project/shared/server/activities';
import { hasConsent, mergeContext, sendEmail, unsubscribeUrl } from '@project/shared/server/email';
import { renderMerge } from '@project/shared/merge';
import { getSettings } from '@project/shared/server/settings';
import { createTask } from '@project/shared/server/tasks';
import { withRetry } from '@project/shared/server/sql';
import { EMAIL_RE } from '@project/shared/format';
import { day, id, parseInput } from '../server/input';

const inputSchema = z.object({
  /** Either a contact (preferred, so consent and history are right) or a plain address. */
  contactId: id.nullable().optional(),
  to: z.string().max(200).nullable().optional(),
  cc: z.array(z.string().max(200)).max(10).optional(),
  subject: z.string().trim().min(1, 'Add a subject').max(200),
  body: z.string().trim().min(1, 'Write something to send').max(20_000),
  companyId: id.nullable().optional(),
  dealId: id.nullable().optional(),
  leadId: id.nullable().optional(),
  templateId: id.nullable().optional(),
  followUp: z.object({ title: z.string().trim().min(1).max(240), dueDate: day.nullable().optional() }).nullable().optional(),
});

/**
 * Send a one-to-one email and record it on the timeline. Merge fields are
 * rendered here, so what is stored is what the buyer received. A send that
 * can't be delivered (demo address, bad address, gateway error) is still
 * recorded, flagged with why.
 */
export default createEndpoint({
  description: 'Send an email to a contact or lead and log it on their timeline',
  authenticated: true,
  inputSchema,
  outputSchema: z.object({ activityId: z.string(), delivery: z.string(), reason: z.string().nullable(), taskId: z.string().nullable() }),
  execute: async ({ input, context }) => {
    const data = parseInput(inputSchema, input);
    const actor = await getActor(context);
    assertCan(actor, 'outreach.send');
    const settings = await getSettings();
    const sender = await memberById(actor.id);

    let to = (data.to ?? '').trim();
    let contactId: string | null = null;
    if (data.contactId) {
      const c = await zite.contacts.findOne({ id: data.contactId });
      if (!c) throw new ZiteError('That contact no longer exists', 'NOT_FOUND');
      contactId = c.id;
      to = to || (c.email ?? '');
      if (!hasConsent(c)) throw new ZiteError(`${c.name ?? 'This contact'} has opted out of email`, 'FORBIDDEN');
    }
    if (data.leadId && !to) {
      const l = await zite.leads.findOne({ id: data.leadId });
      to = l?.email ?? '';
    }
    if (!EMAIL_RE.test(to)) throw new ZiteError('That email address doesn’t look right', 'BAD_REQUEST');

    const ctx = await mergeContext({ settings, sender, contactId: data.contactId ?? null, companyId: data.companyId ?? null, dealId: data.dealId ?? null });
    const subject = renderMerge(data.subject, ctx);
    const body = renderMerge(data.body, ctx);
    const unsubscribe = contactId ? await unsubscribeUrl(settings, contactId) : '';

    const result = await sendEmail({
      to,
      cc: data.cc,
      subject,
      text: body,
      replyTo: actor.email,
      settings,
      signature: sender?.signature ?? null,
      footer: unsubscribe ? { unsubscribeUrl: unsubscribe } : null,
    });

    const activityId = await createActivity(actor, {
      kind: 'Email',
      subject,
      body,
      direction: 'Outbound',
      delivery: result.delivery,
      emailFrom: actor.email,
      emailTo: to,
      emailCc: data.cc?.join(', ') || null,
      contactId: data.contactId ?? null,
      companyId: data.companyId ?? null,
      dealId: data.dealId ?? null,
      leadId: data.leadId ?? null,
    });

    if (data.templateId) {
      const t = await zite.emailTemplates.findOne({ id: data.templateId });
      if (t) await withRetry(() => zite.emailTemplates.update({ id: data.templateId as string, record: { useCount: (t.useCount ?? 0) + 1, lastUsedAt: new Date().toISOString() } }));
    }
    let taskId: string | null = null;
    if (data.followUp) {
      taskId = await createTask(actor, { title: data.followUp.title, dueDate: data.followUp.dueDate ?? null, type: 'Email', contactId: data.contactId ?? null, companyId: data.companyId ?? null, dealId: data.dealId ?? null, leadId: data.leadId ?? null });
    }
    return { activityId, delivery: result.delivery, reason: result.reason, taskId };
  },
});
