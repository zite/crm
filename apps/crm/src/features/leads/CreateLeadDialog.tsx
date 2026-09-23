import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { createLead } from 'zitejs/api';
import { Avatar, Unassigned } from '../../ui/Avatar';
import { Field, FieldRow, Input, Textarea } from '../../ui/Form';
import { FormDialog } from '../../ui/Dialog';
import { ChoicePicker, FieldButton, MemberPicker } from '../../pickers/pickers';
import { errorMessage } from '../../lib/errors';
import { useWorkspace } from '../../lib/workspace';
import { invalidateLead } from './leadData';

/**
 * New lead by hand — the one someone met at a conference, or a name a partner
 * passed on. `defaults` may carry: name, email, companyName, source, ownerId.
 */
export default function CreateLeadDialog({ open, onOpenChange, defaults }: { open: boolean; onOpenChange: (open: boolean) => void; defaults: Record<string, unknown> }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [title, setTitle] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [employees, setEmployees] = useState('');
  const [source, setSource] = useState<string | null>(null);
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName((defaults.name as string) ?? '');
    setEmail((defaults.email as string) ?? '');
    setPhone('');
    setTitle('');
    setCompanyName((defaults.companyName as string) ?? '');
    setEmployees('');
    setSource((defaults.source as string) ?? null);
    setOwnerId((defaults.ownerId as string) ?? ws.me.id);
    setMessage('');
    setError(null);
  }, [open]);

  const submit = async () => {
    if (!name.trim() && !email.trim()) {
      setError('Give the lead a name or an email address');
      return;
    }
    setPending(true);
    try {
      const size = employees.trim() ? Number(employees.replace(/[^0-9]/g, '')) : null;
      const result = await createLead({
        name: name.trim() || undefined,
        email: email.trim() || undefined,
        phone: phone.trim() || undefined,
        title: title.trim() || undefined,
        companyName: companyName.trim() || undefined,
        employees: Number.isFinite(size) && size ? size : null,
        source: source ?? undefined,
        ownerId,
        message: message.trim() || undefined,
      });
      invalidateLead(qc);
      onOpenChange(false);
      toast.success(`Lead added — scores ${result.score}`, { action: { label: 'Open', onClick: () => navigate(`/leads/${result.id}`) } });
    } catch (e) {
      setError(errorMessage(e, 'Couldn’t create that lead'));
    } finally {
      setPending(false);
    }
  };

  const owner = ws.memberById(ownerId);

  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title="New lead" description="Someone who raised a hand but isn’t a contact yet." submitLabel="Add lead" onSubmit={submit} pending={pending} size="lg">
      <div className="flex flex-col gap-4">
        <FieldRow>
          {/* Not `required`: the form takes a name or an email, and an asterisk on
              one of them would be a rule the dialog doesn't actually enforce. */}
          <Field label="Name" hint="A name or an email is enough" error={error && !name.trim() && !email.trim() ? error : undefined}>
            <Input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="Tessa Whitfield" invalid={Boolean(error && !name.trim() && !email.trim())} />
          </Field>
          <Field label="Email" hint="How we recognise them later">
            <Input value={email} onChange={e => setEmail(e.target.value)} type="email" placeholder="tessa@northgate.example" />
          </Field>
        </FieldRow>
        <FieldRow cols={3}>
          <Field label="Phone">
            <Input value={phone} onChange={e => setPhone(e.target.value)} placeholder="(503) 555-0142" />
          </Field>
          <Field label="Title">
            <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="Director of Logistics" />
          </Field>
          <Field label="Company">
            <Input value={companyName} onChange={e => setCompanyName(e.target.value)} placeholder="Northgate Freight" />
          </Field>
        </FieldRow>
        <FieldRow cols={3}>
          <Field label="Company size" hint="Feeds the fit score">
            <Input value={employees} onChange={e => setEmployees(e.target.value)} inputMode="numeric" placeholder="250" />
          </Field>
          <Field label="Source">
            <ChoicePicker list="Lead Source" value={source} onChange={setSource} trigger={<FieldButton placeholder={!source}>{source ?? 'Where they came from'}</FieldButton>} />
          </Field>
          <Field label="Owner">
            <MemberPicker value={ownerId} onChange={setOwnerId} trigger={<FieldButton icon={owner ? <Avatar person={owner} size="xs" /> : <Unassigned size="xs" />}>{owner?.name ?? 'Unassigned'}</FieldButton>} />
          </Field>
        </FieldRow>
        <Field label="What they said" hint="Shown at the top of the review deck.">
          <Textarea value={message} onChange={e => setMessage(e.target.value)} minRows={3} placeholder="Runs four distribution centres, wants to fix visibility before the winter peak." />
        </Field>
        {error && (name.trim() || email.trim()) ? <p className="text-meta text-danger">{error}</p> : null}
      </div>
    </FormDialog>
  );
}
