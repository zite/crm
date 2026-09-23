import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
import { createDeal } from 'zitejs/api';
import { Field, FieldRow, Input, Textarea } from '../../ui/Form';
import { FormDialog } from '../../ui/Dialog';
import { Menu, MenuContent, MenuItem, MenuTrigger } from '../../ui/Menu';
import { CompanyMark } from '../../glyphs';
import { ChoicePicker, DatePicker, FieldButton, MemberPicker, RecordPicker, StagePicker } from '../../pickers/pickers';
import { Avatar, Unassigned } from '../../ui/Avatar';
import { errorMessage } from '../../lib/errors';
import { invalidateDeal } from '../../lib/queries';
import { useWorkspace } from '../../lib/workspace';
import { shortDate, todayString } from '../../lib/format';

/**
 * New deal. `defaults` may carry: companyId, companyName, contactId,
 * contactName, pipelineId, stageId, ownerId, amount, closeDate, name, source.
 */
export default function CreateDealDialog({ open, onOpenChange, defaults }: { open: boolean; onOpenChange: (open: boolean) => void; defaults: Record<string, unknown> }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [company, setCompany] = useState<{ id: string; name: string } | null>(null);
  const [contact, setContact] = useState<{ id: string; name: string } | null>(null);
  const [pipelineId, setPipelineId] = useState<string>('');
  const [stageId, setStageId] = useState<string>('');
  const [ownerId, setOwnerId] = useState<string | null>(ws.me.id);
  const [amount, setAmount] = useState('');
  const [closeDate, setCloseDate] = useState<string | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const [description, setDescription] = useState('');
  const [firstTask, setFirstTask] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!open) return;
    const pipeline = (defaults.pipelineId as string) || ws.defaultPipeline?.id || '';
    const stages = ws.openStagesFor(pipeline);
    setName((defaults.name as string) ?? (defaults.companyName ? `${defaults.companyName} — ` : ''));
    setCompany(defaults.companyId ? { id: defaults.companyId as string, name: (defaults.companyName as string) ?? 'Company' } : null);
    setContact(defaults.contactId ? { id: defaults.contactId as string, name: (defaults.contactName as string) ?? 'Contact' } : null);
    setPipelineId(pipeline);
    setStageId((defaults.stageId as string) || stages[0]?.id || '');
    setOwnerId((defaults.ownerId as string) ?? ws.me.id);
    setAmount(defaults.amount ? String(defaults.amount) : '');
    setCloseDate((defaults.closeDate as string) ?? null);
    setSource((defaults.source as string) ?? null);
    setDescription('');
    setFirstTask('');
    setError(null);
  }, [open]);

  const submit = async () => {
    if (!name.trim()) {
      setError('Give the deal a name');
      return;
    }
    setPending(true);
    try {
      const amountValue = amount.trim() ? Number(amount.replace(/[^0-9.]/g, '')) : null;
      const result = await createDeal({
        name: name.trim(),
        companyId: company?.id ?? null,
        contactId: contact?.id ?? null,
        pipelineId: pipelineId || null,
        stageId: stageId || null,
        ownerId,
        amount: Number.isFinite(amountValue) ? amountValue : null,
        closeDate,
        source,
        description: description.trim() || null,
        nextTask: firstTask.trim() ? { title: firstTask.trim(), dueDate: todayString() } : null,
      });
      invalidateDeal(qc);
      onOpenChange(false);
      toast.success('Deal created', { action: { label: 'Open', onClick: () => navigate(`/deals/${result.id}`) } });
    } catch (e) {
      setError(errorMessage(e, 'Couldn’t create that deal'));
    } finally {
      setPending(false);
    }
  };

  const owner = ws.memberById(ownerId);
  const pipelines = ws.pipelines.filter(p => !p.archived);

  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title="New deal" submitLabel="Create deal" onSubmit={submit} pending={pending} size="lg">
      <div className="flex flex-col gap-4">
        <Field label="Name" required error={error && !name.trim() ? error : undefined}>
          <Input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="Harbor Freight — Platform rollout" invalid={Boolean(error && !name.trim())} />
        </Field>
        <FieldRow>
          <Field label="Company">
            <RecordPicker
              kind="company"
              value={company}
              onChange={record => {
                setCompany(record);
                if (record && !name.trim()) setName(`${record.name} — `);
              }}
              trigger={
                <FieldButton aria-label="Company" placeholder={!company} icon={company ? <CompanyMark name={company.name} id={company.id} size="xs" /> : undefined} onClear={company ? () => setCompany(null) : undefined}>
                  {company?.name ?? 'Search companies'}
                </FieldButton>
              }
            />
          </Field>
          <Field label="Primary contact">
            <RecordPicker
              kind="contact"
              value={contact}
              onChange={record => setContact(record)}
              trigger={
                <FieldButton aria-label="Primary contact" placeholder={!contact} onClear={contact ? () => setContact(null) : undefined}>
                  {contact?.name ?? 'Search contacts'}
                </FieldButton>
              }
            />
          </Field>
        </FieldRow>
        <FieldRow cols={3}>
          <Field label="Pipeline">
            {/* A menu, not a cycling button: this field looks like the two beside it, so clicking it has to show the choices. */}
            <Menu>
              <MenuTrigger asChild>
                <FieldButton aria-label="Pipeline" placeholder={!pipelineId}>{ws.pipelineById(pipelineId)?.name ?? 'Choose a pipeline'}</FieldButton>
              </MenuTrigger>
              <MenuContent align="start">
                {pipelines.map(pipeline => (
                  <MenuItem
                    key={pipeline.id}
                    onSelect={() => {
                      setPipelineId(pipeline.id);
                      setStageId(ws.openStagesFor(pipeline.id)[0]?.id ?? '');
                    }}
                  >
                    {pipeline.name}
                  </MenuItem>
                ))}
              </MenuContent>
            </Menu>
          </Field>
          <Field label="Stage">
            <StagePicker pipelineId={pipelineId} value={stageId} onChange={setStageId} trigger={<FieldButton aria-label="Stage" placeholder={!stageId}>{ws.stageById(stageId)?.name ?? 'Choose'}</FieldButton>} />
          </Field>
          <Field label="Owner">
            <MemberPicker
              value={ownerId}
              onChange={setOwnerId}
              trigger={<FieldButton aria-label="Owner" icon={owner ? <Avatar person={owner} size="xs" /> : <Unassigned size="xs" />}>{owner?.name ?? 'Unassigned'}</FieldButton>}
            />
          </Field>
        </FieldRow>
        <FieldRow cols={3}>
          <Field label="Amount" hint={`In ${ws.settings.currency}`}>
            <Input value={amount} onChange={e => setAmount(e.target.value)} inputMode="decimal" placeholder="48000" />
          </Field>
          <Field label="Close date">
            <DatePicker value={closeDate} onChange={setCloseDate} trigger={<FieldButton aria-label="Close date" placeholder={!closeDate}>{closeDate ? shortDate(closeDate) : 'Pick a date'}</FieldButton>} />
          </Field>
          <Field label="Source">
            <ChoicePicker list="Lead Source" value={source} onChange={setSource} trigger={<FieldButton aria-label="Source" placeholder={!source}>{source ?? 'Where it came from'}</FieldButton>} />
          </Field>
        </FieldRow>
        <Field label="First next step" hint="Creates a task due today, so the deal never sits without one.">
          <Input value={firstTask} onChange={e => setFirstTask(e.target.value)} placeholder="Book the discovery call" />
        </Field>
        <Field label="Notes">
          <Textarea value={description} onChange={e => setDescription(e.target.value)} minRows={3} placeholder="What they’re trying to fix, and by when." />
        </Field>
        {error && name.trim() ? <p className="text-meta text-danger">{error}</p> : null}
      </div>
    </FormDialog>
  );
}
