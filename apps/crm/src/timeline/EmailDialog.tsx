import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Sparkle } from '@phosphor-icons/react';
import { aiDraftEmail, sendEmail } from 'zitejs/api';
import { Button } from '../ui/Button';
import { Menu, MenuContent, MenuItem, MenuLabel, MenuTrigger } from '../ui/Menu';
import { FormDialog } from '../ui/Dialog';
import { Field, Input, Textarea } from '../ui/Form';
import { Badge } from '../ui/Chip';
import { errorMessage } from '../lib/errors';
import { invalidate } from '../lib/queries';
import { useWorkspace } from '../lib/workspace';
import { TemplatePicker } from '../features/outreach/TemplatePicker';
import { todayString } from '../lib/format';

export type EmailTarget = {
  contactId?: string | null;
  leadId?: string | null;
  companyId?: string | null;
  dealId?: string | null;
  to: string;
  name?: string | null;
};

/**
 * Compose and send one email. Merge fields ({{contact.first_name}}) are
 * rendered by the server, so what lands on the timeline is what the buyer got.
 * A send that can't be delivered is still recorded, flagged with why.
 */
export function EmailDialog({ open, onOpenChange, target, subject: initialSubject, body: initialBody }: { open: boolean; onOpenChange: (open: boolean) => void; target: EmailTarget | null; subject?: string; body?: string }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [cc, setCc] = useState('');
  const [followUp, setFollowUp] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [drafting, setDrafting] = useState(false);
  /** Set when the body came from a template, so its use count measures real sends. */
  const [templateId, setTemplateId] = useState<string | null>(null);

  const draft = async (intent: 'follow_up' | 'recap' | 'pricing' | 'check_in' | 'intro') => {
    if (!target) return;
    setDrafting(true);
    try {
      const result = await aiDraftEmail({ intent, dealId: target.dealId ?? null, contactId: target.contactId ?? null, leadId: target.leadId ?? null });
      setSubject(result.subject);
      setBody(result.body);
      if (!result.aiGenerated) toast.message('Starter draft — connect Anthropic in settings for a written one');
    } catch (e) {
      toast.error(errorMessage(e, 'Couldn’t draft that'));
    } finally {
      setDrafting(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    setSubject(initialSubject ?? '');
    setBody(initialBody ?? `Hi {{contact.first_name | there}},\n\n\n\n${ws.me.name}`);
    setCc('');
    setFollowUp('');
    setError(null);
    setTemplateId(null);
  }, [open]);

  const submit = async () => {
    if (!target) return;
    if (!subject.trim()) {
      setError('Add a subject');
      return;
    }
    setPending(true);
    try {
      const result = await sendEmail({
        contactId: target.contactId ?? null,
        leadId: target.leadId ?? null,
        companyId: target.companyId ?? null,
        dealId: target.dealId ?? null,
        to: target.to,
        cc: cc.trim() ? cc.split(',').map(s => s.trim()).filter(Boolean) : undefined,
        subject: subject.trim(),
        body: body.trim(),
        templateId,
        followUp: followUp.trim() ? { title: followUp.trim(), dueDate: todayString() } : null,
      });
      invalidate(qc, 'timeline', 'deals', 'deal', 'contacts', 'leads', 'tasks');
      onOpenChange(false);
      if (result.delivery === 'Sent') toast.success('Email sent');
      else toast.message(`Logged, not sent — ${result.reason ?? 'the address could not be delivered to'}`);
    } catch (e) {
      setError(errorMessage(e, 'Couldn’t send that email'));
    } finally {
      setPending(false);
    }
  };

  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title="Send email" submitLabel="Send" onSubmit={submit} pending={pending} size="lg" footerStart={<span className="text-meta text-ink-3">Replies come back to {ws.me.email}</span>}>
      <div className="flex flex-col gap-4">
        <Field label="To">
          <div className="flex h-9 items-center gap-2 rounded-md border border-line bg-sunken px-2.5 text-body text-ink">
            <span className="truncate">{target?.name ? `${target.name} · ${target.to}` : target?.to}</span>
            {target?.to?.endsWith('.example') && <Badge tone="warning">Demo address</Badge>}
          </div>
        </Field>
        <Field label="Cc" hint="Comma separated">
          <Input value={cc} onChange={e => setCc(e.target.value)} placeholder="colleague@example.com" />
        </Field>
        <Field label="Subject" required error={error && !subject.trim() ? error : undefined}>
          <Input autoFocus value={subject} onChange={e => setSubject(e.target.value)} invalid={Boolean(error && !subject.trim())} />
        </Field>
        <Field
          label="Message"
          hint="Merge fields like {{contact.first_name}} are filled in when it sends."
          action={
            <div className="flex flex-wrap items-center justify-end gap-1">
              <TemplatePicker
                onPick={t => {
                  setSubject(t.subject);
                  setBody(t.body);
                  setTemplateId(t.id);
                }}
              />
              <Menu>
              <MenuTrigger asChild>
                <Button variant="ghost" size="xs" leading={<Sparkle size={14} />} loading={drafting}>
                  Draft
                </Button>
              </MenuTrigger>
              <MenuContent align="end">
                <MenuLabel>Draft an email that…</MenuLabel>
                <MenuItem onSelect={() => draft('follow_up')}>Follows up on the last conversation</MenuItem>
                <MenuItem onSelect={() => draft('recap')}>Recaps the last meeting</MenuItem>
                <MenuItem onSelect={() => draft('pricing')}>Sends pricing</MenuItem>
                <MenuItem onSelect={() => draft('check_in')}>Checks in on a quiet deal</MenuItem>
                <MenuItem onSelect={() => draft('intro')}>Introduces us for the first time</MenuItem>
                </MenuContent>
              </Menu>
            </div>
          }
        >
          <Textarea value={body} onChange={e => setBody(e.target.value)} minRows={10} />
        </Field>
        <Field label="Follow-up task" hint="Optional — due today.">
          <Input value={followUp} onChange={e => setFollowUp(e.target.value)} placeholder="Check they got the pricing" />
        </Field>
        {error && subject.trim() ? <p className="text-meta text-danger">{error}</p> : null}
      </div>
    </FormDialog>
  );
}
