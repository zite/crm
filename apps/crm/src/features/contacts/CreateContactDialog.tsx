import { Warning } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
import { createContact } from 'zitejs/api';
import { Avatar, Unassigned } from '../../ui/Avatar';
import { Button } from '../../ui/Button';
import { FormDialog } from '../../ui/Dialog';
import { Field, FieldRow, Input, Textarea } from '../../ui/Form';
import { CompanyMark } from '../../glyphs';
import { ChoicePicker, FieldButton, MemberPicker, RecordPicker } from '../../pickers/pickers';
import { errorMessage } from '../../lib/errors';
import { useWorkspace } from '../../lib/workspace';
import { invalidateContact } from '../companies/queries';

/**
 * New contact. `defaults` may carry: firstName, lastName, name, email, phone,
 * title, companyId, companyName, ownerId, source, dealId — creating one from a
 * company or a deal arrives with that record already filled in.
 */
export default function CreateContactDialog({ open, onOpenChange, defaults }: { open: boolean; onOpenChange: (open: boolean) => void; defaults: Record<string, unknown> }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [title, setTitle] = useState('');
  const [company, setCompany] = useState<{ id: string; name: string } | null>(null);
  const [ownerId, setOwnerId] = useState<string | null>(ws.me.id);
  const [source, setSource] = useState<string | null>(null);
  const [background, setBackground] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const dealId = (defaults.dealId as string) ?? null;

  useEffect(() => {
    if (!open) return;
    const full = ((defaults.name as string) ?? '').trim();
    setFirstName((defaults.firstName as string) ?? full.split(/\s+/)[0] ?? '');
    setLastName((defaults.lastName as string) ?? (full.split(/\s+/).length > 1 ? full.split(/\s+/).slice(1).join(' ') : ''));
    setEmail((defaults.email as string) ?? '');
    setPhone((defaults.phone as string) ?? '');
    setTitle((defaults.title as string) ?? '');
    setCompany(defaults.companyId ? { id: defaults.companyId as string, name: (defaults.companyName as string) ?? 'Company' } : null);
    setOwnerId((defaults.ownerId as string) ?? ws.me.id);
    setSource((defaults.source as string) ?? null);
    setBackground('');
    setError(null);
    setDuplicate(null);
  }, [open]);

  const submit = async (force = false) => {
    const name = [firstName.trim(), lastName.trim()].filter(Boolean).join(' ');
    if (!name) {
      setError('Give the contact a name');
      return;
    }
    setPending(true);
    setError(null);
    try {
      const result = await createContact({
        firstName: firstName.trim() || null,
        lastName: lastName.trim() || null,
        name,
        email: email.trim() || null,
        phone: phone.trim() || null,
        title: title.trim() || null,
        companyId: company?.id ?? null,
        ownerId,
        source,
        background: background.trim() || null,
        dealId,
        failOnDuplicate: !force,
      });
      invalidateContact(qc);
      onOpenChange(false);
      toast.success('Contact added', { action: { label: 'Open', onClick: () => navigate(`/contacts/${result.id}`) } });
    } catch (e) {
      const message = errorMessage(e, 'Couldn’t add that contact');
      if (/already uses/i.test(message)) setDuplicate(message);
      else setError(message);
    } finally {
      setPending(false);
    }
  };

  const owner = ws.memberById(ownerId);

  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title="New contact" submitLabel="Add contact" onSubmit={() => submit(false)} pending={pending} size="lg">
      <div className="flex flex-col gap-4">
        <FieldRow>
          <Field label="First name" required error={error && !firstName.trim() && !lastName.trim() ? error : undefined}>
            <Input autoFocus value={firstName} onChange={e => setFirstName(e.target.value)} placeholder="Priya" invalid={Boolean(error && !firstName.trim() && !lastName.trim())} />
          </Field>
          <Field label="Last name">
            <Input value={lastName} onChange={e => setLastName(e.target.value)} placeholder="Raman" />
          </Field>
        </FieldRow>
        <FieldRow>
          <Field label="Email">
            <Input
              value={email}
              onChange={e => {
                setEmail(e.target.value);
                setDuplicate(null);
              }}
              inputMode="email"
              placeholder="priya.raman@harborfreight.example"
            />
          </Field>
          <Field label="Phone">
            <Input value={phone} onChange={e => setPhone(e.target.value)} inputMode="tel" placeholder="(541) 555-0292" />
          </Field>
        </FieldRow>

        {duplicate && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-warning/40 bg-warning/[0.07] px-3 py-2.5 dark:bg-warning/10">
            <Warning size={16} className="shrink-0 text-warning" />
            <p className="min-w-0 flex-1 text-ui text-ink">{duplicate}</p>
            <Button variant="secondary" size="sm" onClick={() => submit(true)}>
              Add them anyway
            </Button>
          </div>
        )}

        <FieldRow>
          <Field label="Job title">
            <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="VP Operations" />
          </Field>
          <Field label="Company">
            <RecordPicker
              kind="company"
              value={company}
              onChange={record => setCompany(record)}
              trigger={
                <FieldButton
                  placeholder={!company}
                  icon={company ? <CompanyMark name={company.name} id={company.id} size="xs" /> : undefined}
                  onClear={company ? () => setCompany(null) : undefined}
                >
                  {company?.name ?? 'Search companies'}
                </FieldButton>
              }
            />
          </Field>
        </FieldRow>
        <FieldRow>
          <Field label="Owner">
            <MemberPicker value={ownerId} onChange={setOwnerId} trigger={<FieldButton icon={owner ? <Avatar person={owner} size="xs" /> : <Unassigned size="xs" />}>{owner?.name ?? 'Unassigned'}</FieldButton>} />
          </Field>
          <Field label="Source">
            <ChoicePicker list="Lead Source" value={source} onChange={setSource} trigger={<FieldButton placeholder={!source}>{source ?? 'Where they came from'}</FieldButton>} />
          </Field>
        </FieldRow>
        <Field label="Background" hint={dealId ? 'They will also join this deal’s buying group.' : undefined}>
          <Textarea value={background} onChange={e => setBackground(e.target.value)} minRows={3} placeholder="What they care about, and how they like to be reached." />
        </Field>
        {error && (firstName.trim() || lastName.trim()) ? <p className="text-meta text-danger">{error}</p> : null}
      </div>
    </FormDialog>
  );
}
