import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { sendQuote, type GetQuoteOutputType } from 'zitejs/api';
import { FormDialog } from '../../ui/Dialog';
import { Field, Input, Textarea } from '../../ui/Form';
import { errorMessage } from '../../lib/errors';
import { fullDate } from '../../lib/format';
import { useWorkspace } from '../../lib/workspace';
import { invalidateQuotes } from './queries';
import { EMAIL_RE } from '@project/shared/format';

/**
 * The compose step before a quote goes out. Everything the buyer receives is
 * on this one screen: who it goes to, the subject, the note, and the link they
 * will open. Sending is what freezes the quote.
 */
export function SendQuoteDialog({
  open,
  onOpenChange,
  quote,
  publicUrl,
  onSent,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  quote: GetQuoteOutputType['quote'];
  publicUrl: string;
  onSent?: () => void;
}) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const firstName = (quote.contactName ?? '').split(' ')[0];
    setTo(quote.contactEmail ?? '');
    setSubject(`${quote.title || 'Your quote'} from ${ws.settings.organizationName} (${quote.number})`);
    setMessage(
      [
        firstName ? `Hi ${firstName},` : 'Hello,',
        '',
        // To the cent: this figure is what the buyer is being asked to agree to.
        `Here is ${quote.number} for ${ws.money(quote.total, { cents: true })}${quote.expiresOn ? `, which holds until ${fullDate(quote.expiresOn)}` : ''}.`,
        '',
        'Open the link below to read it in full and accept it, or reply here with anything you want changed.',
      ].join('\n'),
    );
    setError(null);
  }, [open, quote, ws]);

  const submit = async () => {
    if (!EMAIL_RE.test(to.trim())) {
      setError('Add a valid email address');
      return;
    }
    if (!subject.trim() || !message.trim()) {
      setError('The subject and the message both need something in them');
      return;
    }
    try {
      const result = await sendQuote({ id: quote.id, to: to.trim(), subject: subject.trim(), message: message.trim() });
      invalidateQuotes(qc, { quoteId: quote.id, dealId: quote.dealId });
      onOpenChange(false);
      onSent?.();
      if (result.delivery === 'Sent') toast.success(`${quote.number} sent to ${to.trim()}`);
      else if (result.delivery === 'Not Sent') toast.message(`${quote.number} is marked sent`, { description: `${result.reason ?? 'Not delivered'} — the link still works.` });
      else toast.error(result.reason ?? 'The email couldn’t be delivered, but the quote is marked sent');
    } catch (e) {
      setError(errorMessage(e, 'Couldn’t send that quote'));
    }
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Send ${quote.number}`}
      description="Sending freezes the lines and hands the buyer a private link to accept or decline."
      submitLabel="Send quote"
      size="lg"
      onSubmit={submit}
    >
      <div className="flex flex-col gap-4">
        <Field label="To" required error={error && !EMAIL_RE.test(to.trim()) ? error : undefined}>
          <Input autoFocus value={to} onChange={e => setTo(e.target.value)} placeholder="buyer@company.com" type="email" invalid={Boolean(error) && !EMAIL_RE.test(to.trim())} />
        </Field>
        <Field label="Subject" required>
          <Input value={subject} onChange={e => setSubject(e.target.value)} />
        </Field>
        <Field label="Message" required hint="Your signature and the organization’s footer are added automatically." error={error && EMAIL_RE.test(to.trim()) ? error : undefined}>
          <Textarea value={message} minRows={7} onChange={e => setMessage(e.target.value)} />
        </Field>
        <div className="rounded-md border border-line bg-sunken px-3 py-2.5">
          <div className="text-micro font-semibold uppercase text-ink-3">The link they get</div>
          {publicUrl ? (
            <p className="mt-1 break-all text-meta text-ink-2">{publicUrl}</p>
          ) : (
            <p className="mt-1 text-meta text-warning">
              No public address is recorded yet, so this email goes out without a link. Open the CRM Pages app once and it is saved for every quote after this one.
            </p>
          )}
        </div>
      </div>
    </FormDialog>
  );
}
