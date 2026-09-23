import { Warning } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
import { createCompany } from 'zitejs/api';
import { Avatar, Unassigned } from '../../ui/Avatar';
import { Button } from '../../ui/Button';
import { FormDialog } from '../../ui/Dialog';
import { Field, FieldRow, Input, Textarea } from '../../ui/Form';
import { CompanyMark } from '../../glyphs';
import { ChoicePicker, FieldButton, MemberPicker, OptionsPicker, RecordPicker } from '../../pickers/pickers';
import { COMPANY_TYPES } from '@project/shared/constants';
import { errorMessage } from '../../lib/errors';
import { useWorkspace } from '../../lib/workspace';
import { invalidateCompany } from './queries';

/**
 * New company. `defaults` may carry: name, domain, website, type, industry,
 * ownerId, parentCompanyId, parentCompanyName, source, city, country.
 */
export default function CreateCompanyDialog({ open, onOpenChange, defaults }: { open: boolean; onOpenChange: (open: boolean) => void; defaults: Record<string, unknown> }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [domain, setDomain] = useState('');
  const [type, setType] = useState<string | null>('Prospect');
  const [industry, setIndustry] = useState<string | null>(null);
  const [ownerId, setOwnerId] = useState<string | null>(ws.me.id);
  const [source, setSource] = useState<string | null>(null);
  const [employees, setEmployees] = useState('');
  const [city, setCity] = useState('');
  const [parent, setParent] = useState<{ id: string; name: string } | null>(null);
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<{ id: string; message: string } | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName((defaults.name as string) ?? '');
    setDomain((defaults.domain as string) ?? (defaults.website as string) ?? '');
    setType((defaults.type as string) ?? 'Prospect');
    setIndustry((defaults.industry as string) ?? null);
    setOwnerId((defaults.ownerId as string) ?? ws.me.id);
    setSource((defaults.source as string) ?? null);
    setEmployees('');
    setCity((defaults.city as string) ?? '');
    setParent(defaults.parentCompanyId ? { id: defaults.parentCompanyId as string, name: (defaults.parentCompanyName as string) ?? 'Parent company' } : null);
    setDescription('');
    setError(null);
    setDuplicate(null);
  }, [open]);

  const submit = async (force = false) => {
    if (!name.trim()) {
      setError('Give the company a name');
      return;
    }
    setPending(true);
    setError(null);
    try {
      const employeeCount = employees.trim() ? Math.round(Number(employees.replace(/[^0-9]/g, ''))) : null;
      const result = await createCompany({
        name: name.trim(),
        domain: domain.trim() || null,
        website: domain.trim() || null,
        type: (type as 'Prospect') ?? null,
        industry,
        ownerId,
        source,
        employees: Number.isFinite(employeeCount) ? employeeCount : null,
        city: city.trim() || null,
        parentCompanyId: parent?.id ?? null,
        description: description.trim() || null,
        failOnDuplicate: !force,
      });
      invalidateCompany(qc);
      onOpenChange(false);
      toast.success('Company added', { action: { label: 'Open', onClick: () => navigate(`/companies/${result.id}`) } });
    } catch (e) {
      const message = errorMessage(e, 'Couldn’t add that company');
      if (/already uses/i.test(message)) setDuplicate({ id: '', message });
      else setError(message);
    } finally {
      setPending(false);
    }
  };

  const owner = ws.memberById(ownerId);

  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title="New company" submitLabel="Add company" onSubmit={() => submit(false)} pending={pending} size="lg">
      <div className="flex flex-col gap-4">
        <Field label="Name" required error={error && !name.trim() ? error : undefined}>
          <Input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="Harbor Freight Collective" invalid={Boolean(error && !name.trim())} />
        </Field>
        <FieldRow>
          <Field label="Website" hint="We keep just the domain, so duplicates are easy to spot.">
            <Input
              value={domain}
              onChange={e => {
                setDomain(e.target.value);
                setDuplicate(null);
              }}
              inputMode="url"
              placeholder="harborfreight.example"
            />
          </Field>
          <Field label="Type">
            <OptionsPicker
              options={[...COMPANY_TYPES]}
              value={type}
              allowEmpty={false}
              onChange={setType}
              trigger={<FieldButton placeholder={!type}>{type ?? 'Choose'}</FieldButton>}
            />
          </Field>
        </FieldRow>

        {duplicate && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-warning/40 bg-warning/[0.07] px-3 py-2.5 dark:bg-warning/10">
            <Warning size={16} className="shrink-0 text-warning" />
            <p className="min-w-0 flex-1 text-ui text-ink">{duplicate.message}</p>
            <Button variant="secondary" size="sm" onClick={() => submit(true)}>
              Add it anyway
            </Button>
          </div>
        )}

        <FieldRow cols={3}>
          <Field label="Industry">
            <ChoicePicker list="Industry" value={industry} onChange={setIndustry} trigger={<FieldButton placeholder={!industry}>{industry ?? 'Choose'}</FieldButton>} />
          </Field>
          <Field label="Owner">
            <MemberPicker value={ownerId} onChange={setOwnerId} trigger={<FieldButton icon={owner ? <Avatar person={owner} size="xs" /> : <Unassigned size="xs" />}>{owner?.name ?? 'Unassigned'}</FieldButton>} />
          </Field>
          <Field label="Source">
            <ChoicePicker list="Lead Source" value={source} onChange={setSource} trigger={<FieldButton placeholder={!source}>{source ?? 'Where it came from'}</FieldButton>} />
          </Field>
        </FieldRow>
        <FieldRow cols={3}>
          <Field label="Employees">
            <Input value={employees} onChange={e => setEmployees(e.target.value)} inputMode="numeric" placeholder="1400" />
          </Field>
          <Field label="City">
            <Input value={city} onChange={e => setCity(e.target.value)} placeholder="Long Beach" />
          </Field>
          <Field label="Parent company" hint="For a subsidiary.">
            <RecordPicker
              kind="company"
              value={parent}
              onChange={setParent}
              trigger={
                <FieldButton placeholder={!parent} icon={parent ? <CompanyMark name={parent.name} id={parent.id} size="xs" /> : undefined} onClear={parent ? () => setParent(null) : undefined}>
                  {parent?.name ?? 'None'}
                </FieldButton>
              }
            />
          </Field>
        </FieldRow>
        <Field label="Notes">
          <Textarea value={description} onChange={e => setDescription(e.target.value)} minRows={3} placeholder="What they do, how they buy, and who cares about it inside." />
        </Field>
        {error && name.trim() ? <p className="text-meta text-danger">{error}</p> : null}
      </div>
    </FormDialog>
  );
}
