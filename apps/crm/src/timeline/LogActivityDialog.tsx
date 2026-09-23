import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Field, FieldRow, Input, Textarea } from '../ui/Form';
import { FormDialog } from '../ui/Dialog';
import { Segmented } from '../ui/Form';
import { DatePicker, FieldButton, OptionsPicker, RecordPicker } from '../pickers/pickers';
import { CALL_OUTCOMES, MEETING_OUTCOMES } from '@project/shared/constants';
import { useLogActivity } from '../lib/mutations';
import { shortDate, todayString } from '../lib/format';

type RelatedKind = 'deal' | 'contact' | 'company' | 'lead';

const RELATED_KINDS: Array<{ value: RelatedKind; label: string; search: string }> = [
  { value: 'deal', label: 'Deal', search: 'Search deals' },
  { value: 'contact', label: 'Contact', search: 'Search contacts' },
  { value: 'company', label: 'Company', search: 'Search companies' },
  { value: 'lead', label: 'Lead', search: 'Search leads' },
];

/**
 * Log a note, call, email or meeting. `defaults`: kind, companyId/companyName,
 * contactId/contactName, dealId/dealName, leadId/leadName.
 */
export default function LogActivityDialog({ open, onOpenChange, defaults }: { open: boolean; onOpenChange: (open: boolean) => void; defaults: Record<string, unknown> }) {
  const log = useLogActivity();
  const [kind, setKind] = useState<'Note' | 'Call' | 'Email' | 'Meeting'>('Note');
  const [body, setBody] = useState('');
  const [subject, setSubject] = useState('');
  const [outcome, setOutcome] = useState<string | null>(null);
  const [day, setDay] = useState<string | null>(todayString());
  const [time, setTime] = useState('');
  const [duration, setDuration] = useState('');
  const [followUp, setFollowUp] = useState('');
  const [relatedKind, setRelatedKind] = useState<RelatedKind>('deal');
  const [related, setRelated] = useState<{ kind: RelatedKind; id: string; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setKind(((defaults.kind as string) ?? 'Note') as 'Note');
    setBody('');
    setSubject('');
    setOutcome(null);
    setDay(todayString());
    setTime('');
    setDuration('');
    setFollowUp('');
    setError(null);
    const k: RelatedKind | null = defaults.dealId ? 'deal' : defaults.contactId ? 'contact' : defaults.companyId ? 'company' : defaults.leadId ? 'lead' : null;
    setRelatedKind(k ?? 'deal');
    setRelated(k ? { kind: k, id: defaults[`${k}Id`] as string, name: (defaults[`${k}Name`] as string) ?? 'Record' } : null);
  }, [open]);

  const submit = async () => {
    if (!related) {
      setError('Choose what this is about');
      return;
    }
    if (kind === 'Note' && !body.trim()) {
      setError('Write the note');
      return;
    }
    const occurredAt = day ? new Date(`${day}T${/^([01]\d|2[0-3]):[0-5]\d$/.test(time) ? time : '12:00'}:00`).toISOString() : new Date().toISOString();
    await log.mutateAsync({
      kind,
      subject: subject.trim() || null,
      body: body.trim() || null,
      occurredAt,
      outcome: (outcome as 'Connected') ?? null,
      durationMinutes: duration.trim() ? Number(duration) : null,
      companyId: related.kind === 'company' ? related.id : null,
      contactId: related.kind === 'contact' ? related.id : null,
      dealId: related.kind === 'deal' ? related.id : null,
      leadId: related.kind === 'lead' ? related.id : null,
      followUp: followUp.trim() ? { title: followUp.trim(), dueDate: todayString() } : null,
    });
    toast.success(`${kind} logged`);
    onOpenChange(false);
  };

  const outcomes = kind === 'Call' ? [...CALL_OUTCOMES] : kind === 'Meeting' ? [...MEETING_OUTCOMES] : [];

  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title="Log activity" submitLabel="Log it" onSubmit={submit} pending={log.isPending}>
      <div className="flex flex-col gap-4">
        <Segmented
          value={kind}
          onChange={v => {
            setKind(v as 'Note');
            setOutcome(null);
          }}
          options={[
            { value: 'Note', label: 'Note' },
            { value: 'Call', label: 'Call' },
            { value: 'Email', label: 'Email' },
            { value: 'Meeting', label: 'Meeting' },
          ]}
        />
        <Field label="About" required error={error && !related ? error : undefined}>
          {/* The kind has to be pickable: opened from the global New menu there is
              no record to infer it from, and "About" is required — deal-only made
              logging a call on a contact impossible from anywhere but its page. */}
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
                trigger={<FieldButton aria-label="What this activity is about">{RELATED_KINDS.find(k => k.value === relatedKind)!.label}</FieldButton>}
              />
            </div>
            <div className="min-w-0 flex-1">
              <RecordPicker
                kind={relatedKind}
                value={related}
                onChange={record => setRelated(record ? { kind: relatedKind, id: record.id, name: record.name } : null)}
                trigger={<FieldButton placeholder={!related}>{related ? related.name : RELATED_KINDS.find(k => k.value === relatedKind)!.search}</FieldButton>}
              />
            </div>
          </div>
        </Field>
        {(kind === 'Email' || kind === 'Meeting') && (
          <Field label={kind === 'Email' ? 'Subject' : 'Title'}>
            <Input value={subject} onChange={e => setSubject(e.target.value)} placeholder={kind === 'Email' ? 'Following up on our call' : 'Discovery call'} />
          </Field>
        )}
        <FieldRow cols={3}>
          <Field label="Date">
            <DatePicker value={day} onChange={setDay} trigger={<FieldButton placeholder={!day}>{day ? shortDate(day) : 'Pick a date'}</FieldButton>} />
          </Field>
          <Field label="Time" hint="24-hour">
            <Input value={time} onChange={e => setTime(e.target.value)} placeholder="14:30" />
          </Field>
          {outcomes.length ? (
            <Field label="Outcome">
              <OptionsPicker options={outcomes} value={outcome} onChange={setOutcome} allowEmpty trigger={<FieldButton placeholder={!outcome}>{outcome ?? 'Choose'}</FieldButton>} />
            </Field>
          ) : (
            <Field label="Minutes" hint="Optional">
              <Input value={duration} onChange={e => setDuration(e.target.value)} inputMode="numeric" placeholder="30" />
            </Field>
          )}
        </FieldRow>
        <Field label={kind === 'Note' ? 'Note' : 'What happened'} required={kind === 'Note'} error={error && kind === 'Note' && !body.trim() ? error : undefined}>
          <Textarea value={body} onChange={e => setBody(e.target.value)} minRows={4} placeholder="What was said, and what happens next." />
        </Field>
        <Field label="Follow-up task" hint="Optional — creates a task due today.">
          <Input value={followUp} onChange={e => setFollowUp(e.target.value)} placeholder="Send the recap" />
        </Field>
      </div>
    </FormDialog>
  );
}
