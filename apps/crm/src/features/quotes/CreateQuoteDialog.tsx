import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { listLineItems, saveQuote } from 'zitejs/api';
import { FormDialog } from '../../ui/Dialog';
import { Field, SwitchRow } from '../../ui/Form';
import { FieldButton, RecordPicker } from '../../pickers/pickers';
import { CompanyMark } from '../../glyphs';
import { errorMessage } from '../../lib/errors';
import { todayString } from '../../lib/format';
import { Input } from '../../ui/Form';
import { fromLineItems, toPayload } from './lineItems';
import { invalidateQuotes } from './queries';

/**
 * New quote. Reads these `defaults`: `dealId`, `dealName`, `companyId`,
 * `companyName`, `contactId`, `contactName`, `title`.
 *
 * Starting from a deal copies its line items across, which is how most quotes
 * begin — the pricing already happened on the deal.
 */
export default function CreateQuoteDialog({ open, onOpenChange, defaults }: { open: boolean; onOpenChange: (open: boolean) => void; defaults: Record<string, unknown> }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const str = (key: string) => (typeof defaults[key] === 'string' ? (defaults[key] as string) : null);

  const [title, setTitle] = useState('');
  const [deal, setDeal] = useState<{ id: string; name: string } | null>(null);
  const [company, setCompany] = useState<{ id: string; name: string } | null>(null);
  const [contact, setContact] = useState<{ id: string; name: string } | null>(null);
  const [copyLines, setCopyLines] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const dealId = str('dealId');
    const companyId = str('companyId');
    const contactId = str('contactId');
    setTitle(str('title') ?? str('dealName') ?? '');
    setDeal(dealId ? { id: dealId, name: str('dealName') ?? 'Deal' } : null);
    setCompany(companyId ? { id: companyId, name: str('companyName') ?? 'Company' } : null);
    setContact(contactId ? { id: contactId, name: str('contactName') ?? 'Contact' } : null);
    setCopyLines(true);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const submit = async () => {
    if (!title.trim()) {
      setError('Name the quote so it is easy to find later');
      return;
    }
    try {
      const items = deal && copyLines ? await listLineItems({ dealId: deal.id }).catch(() => null) : null;
      const created = await saveQuote({
        title: title.trim(),
        dealId: deal?.id ?? null,
        companyId: company?.id ?? null,
        contactId: contact?.id ?? null,
        items: toPayload(fromLineItems(items?.items ?? [])),
        today: todayString(),
      });
      invalidateQuotes(qc, { dealId: deal?.id ?? null });
      onOpenChange(false);
      toast.success(`${created.number} started`);
      navigate(`/quotes/${created.id}`);
    } catch (e) {
      setError(errorMessage(e, 'Couldn’t start that quote'));
    }
  };

  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title="New quote" description="A priced proposal with its own number and a private link for the buyer." submitLabel="Start the quote" onSubmit={submit}>
      <div className="flex flex-col gap-4">
        <Field label="Title" required error={error ?? undefined}>
          <Input autoFocus value={title} onChange={e => setTitle(e.target.value)} placeholder="Cedarline Grocers — multi-site rollout" invalid={Boolean(error)} />
        </Field>
        <Field label="Deal" hint="Accepting the quote lands on this deal’s timeline.">
          <RecordPicker
            kind="deal"
            value={deal}
            onChange={record => {
              setDeal(record ? { id: record.id, name: record.name } : null);
              if (record && !title.trim()) setTitle(record.name);
              // The picker hands back an id but no company name, and a field showing
              // its own placeholder as a value reads broken — the server fills the
              // company in from the deal when this is left empty.
            }}
            trigger={
              <FieldButton aria-label="Deal" placeholder={!deal} onClear={deal ? () => setDeal(null) : undefined}>
                {deal?.name ?? 'Search deals'}
              </FieldButton>
            }
          />
        </Field>
        <Field label="Company" hint={deal && !company ? 'Left empty, this comes from the deal.' : undefined}>
          <RecordPicker
            kind="company"
            value={company}
            onChange={record => setCompany(record ? { id: record.id, name: record.name } : null)}
            trigger={
              <FieldButton aria-label="Company" placeholder={!company} icon={company?.name ? <CompanyMark name={company.name} id={company.id} size="xs" /> : undefined} onClear={company ? () => setCompany(null) : undefined}>
                {company?.name || 'Search companies'}
              </FieldButton>
            }
          />
        </Field>
        <Field label="Contact" hint="Where the quote is sent, and who it is addressed to.">
          <RecordPicker
            kind="contact"
            value={contact}
            onChange={record => setContact(record ? { id: record.id, name: record.name } : null)}
            trigger={
              <FieldButton aria-label="Contact" placeholder={!contact} onClear={contact ? () => setContact(null) : undefined}>
                {contact?.name ?? 'Search contacts'}
              </FieldButton>
            }
          />
        </Field>
        {deal && <SwitchRow label="Start from the deal’s line items" description="Copy what is already priced on the deal. You can change anything before sending." checked={copyLines} onCheckedChange={setCopyLines} />}
      </div>
    </FormDialog>
  );
}
