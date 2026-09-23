import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Field, FieldRow, Input, Textarea } from '../../ui/Form';
import { FormDialog } from '../../ui/Dialog';
import { Avatar, Unassigned } from '../../ui/Avatar';
import { DatePicker, FieldButton, MemberPicker, OptionsPicker, RecordPicker } from '../../pickers/pickers';
import { TASK_PRIORITIES, TASK_TYPES } from '@project/shared/constants';
import { useTaskActions } from '../../lib/mutations';
import { useWorkspace } from '../../lib/workspace';
import { shortDate, todayString } from '../../lib/format';

type RelatedKind = 'deal' | 'contact' | 'company' | 'lead';

const RELATED_KINDS: Array<{ value: RelatedKind; label: string; search: string }> = [
  { value: 'deal', label: 'Deal', search: 'Search deals' },
  { value: 'contact', label: 'Contact', search: 'Search contacts' },
  { value: 'company', label: 'Company', search: 'Search companies' },
  { value: 'lead', label: 'Lead', search: 'Search leads' },
];

/**
 * New task. `defaults`: title, type, dueDate, ownerId, companyId/companyName,
 * contactId/contactName, dealId/dealName, leadId/leadName.
 */
export default function CreateTaskDialog({ open, onOpenChange, defaults }: { open: boolean; onOpenChange: (open: boolean) => void; defaults: Record<string, unknown> }) {
  const ws = useWorkspace();
  const { create } = useTaskActions();
  const [title, setTitle] = useState('');
  const [type, setType] = useState<string>('To-do');
  const [priority, setPriority] = useState<string>('Normal');
  const [dueDate, setDueDate] = useState<string | null>(todayString());
  const [dueTime, setDueTime] = useState('');
  const [ownerId, setOwnerId] = useState<string | null>(ws.me.id);
  const [notes, setNotes] = useState('');
  const [relatedKind, setRelatedKind] = useState<RelatedKind>('deal');
  const [related, setRelated] = useState<{ kind: RelatedKind; id: string; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTitle((defaults.title as string) ?? '');
    setType((defaults.type as string) ?? 'To-do');
    setPriority('Normal');
    setDueDate((defaults.dueDate as string) ?? todayString());
    setDueTime('');
    setOwnerId((defaults.ownerId as string) ?? ws.me.id);
    setNotes('');
    setError(null);
    const kind: RelatedKind | null = defaults.dealId ? 'deal' : defaults.contactId ? 'contact' : defaults.companyId ? 'company' : defaults.leadId ? 'lead' : null;
    setRelatedKind(kind ?? 'deal');
    setRelated(
      kind
        ? {
            kind,
            id: defaults[`${kind}Id`] as string,
            name: (defaults[`${kind}Name`] as string) ?? { deal: 'Deal', contact: 'Contact', company: 'Company', lead: 'Lead' }[kind],
          }
        : null,
    );
  }, [open]);

  const submit = async () => {
    if (!title.trim()) {
      setError('Give the task a title');
      return;
    }
    await create.mutateAsync({
      title: title.trim(),
      type: type as 'To-do',
      priority: priority as 'Normal',
      dueDate,
      dueTime: /^([01]\d|2[0-3]):[0-5]\d$/.test(dueTime) ? dueTime : null,
      ownerId,
      notes: notes.trim() || null,
      companyId: related?.kind === 'company' ? related.id : null,
      contactId: related?.kind === 'contact' ? related.id : null,
      dealId: related?.kind === 'deal' ? related.id : null,
      leadId: related?.kind === 'lead' ? related.id : null,
    });
    toast.success('Task created');
    onOpenChange(false);
  };

  const owner = ws.memberById(ownerId);
  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title="New task" submitLabel="Create task" onSubmit={submit} pending={create.isPending}>
      <div className="flex flex-col gap-4">
        <Field label="Title" required error={error ?? undefined}>
          <Input autoFocus value={title} onChange={e => setTitle(e.target.value)} placeholder="Send the two-site pricing" invalid={Boolean(error)} />
        </Field>
        <FieldRow cols={3}>
          <Field label="Type">
            <OptionsPicker options={[...TASK_TYPES]} value={type} onChange={v => setType(v ?? 'To-do')} trigger={<FieldButton>{type}</FieldButton>} />
          </Field>
          <Field label="Priority">
            <OptionsPicker options={[...TASK_PRIORITIES]} value={priority} onChange={v => setPriority(v ?? 'Normal')} trigger={<FieldButton>{priority}</FieldButton>} />
          </Field>
          <Field label="Owner">
            <MemberPicker value={ownerId} onChange={setOwnerId} trigger={<FieldButton icon={owner ? <Avatar person={owner} size="xs" /> : <Unassigned size="xs" />}>{owner?.name ?? 'Unassigned'}</FieldButton>} />
          </Field>
        </FieldRow>
        <FieldRow>
          <Field label="Due date">
            <DatePicker value={dueDate} onChange={setDueDate} trigger={<FieldButton placeholder={!dueDate}>{dueDate ? shortDate(dueDate) : 'No due date'}</FieldButton>} />
          </Field>
          <Field label="Time" hint="Optional, 24-hour (09:30)">
            <Input value={dueTime} onChange={e => setDueTime(e.target.value)} placeholder="09:30" />
          </Field>
        </FieldRow>
        {/* A task can hang off any of the four records, so say which kind you are
            searching rather than silently only ever searching deals. */}
        <Field label="Related to">
          <div className="flex gap-2">
            <div className="w-[132px] shrink-0">
              <OptionsPicker
                options={RELATED_KINDS.map(k => k.label)}
                value={RELATED_KINDS.find(k => k.value === relatedKind)!.label}
                onChange={label => {
                  const next = RELATED_KINDS.find(k => k.label === label);
                  if (!next || next.value === relatedKind) return;
                  setRelatedKind(next.value);
                  setRelated(null);
                }}
                trigger={<FieldButton aria-label="What this task is related to">{RELATED_KINDS.find(k => k.value === relatedKind)!.label}</FieldButton>}
              />
            </div>
            <div className="min-w-0 flex-1">
              <RecordPicker
                kind={relatedKind}
                value={related}
                onChange={record => setRelated(record ? { kind: relatedKind, id: record.id, name: record.name } : null)}
                trigger={
                  <FieldButton placeholder={!related} onClear={related ? () => setRelated(null) : undefined}>
                    {related ? related.name : RELATED_KINDS.find(k => k.value === relatedKind)!.search}
                  </FieldButton>
                }
              />
            </div>
          </div>
        </Field>
        <Field label="Notes">
          <Textarea value={notes} onChange={e => setNotes(e.target.value)} minRows={3} placeholder="Anything the task needs." />
        </Field>
      </div>
    </FormDialog>
  );
}
