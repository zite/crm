import { MagnifyingGlass, Plus, X } from '@phosphor-icons/react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { listContacts, type EnrollInSequenceOutputType } from 'zitejs/api';
import { useQuery } from '@tanstack/react-query';
import { Badge } from '../../ui/Chip';
import { Button } from '../../ui/Button';
import { FormDialog } from '../../ui/Dialog';
import { Field, Input } from '../../ui/Form';
import { OptionPicker, type Option } from '../../pickers/OptionPicker';
import { FieldButton } from '../../pickers/pickers';
import { useWorkspace } from '../../lib/workspace';
import { useSequenceActions, useSequences } from './queries';

/**
 * Put people on a sequence. The dialog's job is to be honest about who
 * actually went on: anyone without an email, without consent or already
 * enrolled comes back with the reason, and demo addresses — which nothing can
 * be delivered to — are offered as a deliberate choice rather than silently
 * dropped or silently sent.
 */
export function EnrollDialog({
  open,
  onOpenChange,
  sequenceId,
  contacts,
  dealId,
  onEnrolled,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Fixed when opened from a sequence page; chosen in the dialog otherwise. */
  sequenceId?: string;
  /** Fixed when opened from a contact page or a bulk selection. */
  contacts?: Array<{ id: string; name: string }>;
  dealId?: string | null;
  onEnrolled?: (result: EnrollInSequenceOutputType) => void;
}) {
  const ws = useWorkspace();
  const { enroll } = useSequenceActions();
  const sequences = useSequences();
  const [chosenSequence, setChosenSequence] = useState<string>(sequenceId ?? '');
  const [picked, setPicked] = useState<Array<{ id: string; name: string }>>([]);
  const [term, setTerm] = useState('');
  const [result, setResult] = useState<EnrollInSequenceOutputType | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fixedContacts = contacts && contacts.length > 0;

  useEffect(() => {
    if (!open) return;
    setChosenSequence(sequenceId ?? '');
    setPicked(fixedContacts ? contacts! : []);
    setTerm('');
    setResult(null);
    setError(null);
  }, [open]);

  const live = (sequences.data?.sequences ?? []).filter(s => s.status !== 'Archived');
  const sequence = live.find(s => s.id === chosenSequence) ?? null;

  // listContacts rather than global search: it also tells us who has no email
  // and who has opted out, so the dialog can say so before you enroll them.
  const hits = useQuery({
    queryKey: ['outreach', 'enroll-search', term],
    queryFn: () => listContacts({ filters: { search: term.trim() }, limit: 8 }),
    enabled: open && !fixedContacts && term.trim().length > 1,
    staleTime: 20_000,
    retry: false,
  });
  const found = hits.data?.contacts ?? [];

  const options: Option[] = useMemo(
    () => live.map(s => ({ value: s.id, label: s.name, hint: `${s.stepCount} steps`, group: s.status === 'Active' ? 'Running' : 'Paused' })),
    [live],
  );

  const undeliverable = (result?.skipped ?? []).filter(s => s.code === 'undeliverable');

  const submit = async (includeUndeliverable = false) => {
    if (!chosenSequence) {
      setError('Choose a sequence');
      return;
    }
    if (!picked.length) {
      setError('Choose at least one contact');
      return;
    }
    setError(null);
    const outcome = await enroll.mutateAsync({ sequenceId: chosenSequence, contactIds: picked.map(c => c.id), dealId: dealId ?? null, includeUndeliverable });
    setResult(outcome);
    onEnrolled?.(outcome);
    if (outcome.enrolled && !outcome.skipped.length) {
      onOpenChange(false);
      toast.success(outcome.enrolled === 1 ? `Enrolled in “${outcome.sequenceName}”` : `${outcome.enrolled} contacts enrolled in “${outcome.sequenceName}”`);
    }
  };

  // After a partial result the one button either retries the demo addresses or closes.
  const retryDemo = Boolean(result) && undeliverable.length > 0;
  const done = Boolean(result) && !retryDemo;

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Enroll contacts"
      description={sequence ? `“${sequence.name}” — ${sequence.stepCount} steps over ${sequence.days[sequence.days.length - 1] ?? 0} days` : 'Pick a sequence and who should go on it.'}
      submitLabel={retryDemo ? (undeliverable.length === 1 ? 'Enroll them anyway' : 'Enroll them anyway') : result ? 'Done' : 'Enroll'}
      onSubmit={done ? () => onOpenChange(false) : () => submit(retryDemo)}
      pending={enroll.isPending}
      size="md"
    >
      <div className="flex flex-col gap-4">
        {!sequenceId && (
          <Field label="Sequence" required error={error && !chosenSequence ? error : undefined}>
            <OptionPicker
              options={options}
              value={chosenSequence}
              onSelect={setChosenSequence}
              width={320}
              trigger={<FieldButton placeholder={!sequence} invalid={Boolean(error && !chosenSequence)}>{sequence?.name ?? 'Choose a sequence'}</FieldButton>}
            />
          </Field>
        )}

        {sequence && sequence.status !== 'Active' && (
          <p className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-meta text-warning">
            “{sequence.name}” is paused. People can go on it now, and it will start working through them when you turn it on.
          </p>
        )}

        <Field label={fixedContacts ? 'Contacts' : 'Who goes on it'} required error={error && chosenSequence && !picked.length ? error : undefined}>
          <div className="flex flex-col gap-2">
            {!fixedContacts && (
              <div className="relative">
                <MagnifyingGlass size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3" />
                <Input value={term} onChange={e => setTerm(e.target.value)} placeholder="Search contacts by name, email or company" className="pl-8" />
              </div>
            )}
            {!fixedContacts && term.trim().length > 1 && (
              <div className="max-h-[180px] overflow-y-auto rounded-md border border-line">
                {hits.isPending ? (
                  <p className="px-3 py-4 text-center text-ui text-ink-3">Searching…</p>
                ) : hits.isError ? (
                  <p className="px-3 py-4 text-center text-ui text-danger">Couldn’t search contacts just now.</p>
                ) : found.length === 0 ? (
                  <p className="px-3 py-4 text-center text-ui text-ink-3">Nothing matches “{term}”</p>
                ) : (
                  found.map(hit => {
                    const already = picked.some(c => c.id === hit.id);
                    const blocked = hit.doNotContact || Boolean(hit.unsubscribedAt) ? 'Opted out' : !hit.email ? 'No email' : null;
                    return (
                      <button
                        key={hit.id}
                        type="button"
                        disabled={already || Boolean(blocked)}
                        onClick={() => {
                          setPicked(current => [...current, { id: hit.id, name: hit.name }]);
                          setTerm('');
                        }}
                        className="flex w-full items-center gap-2 border-b border-line px-3 py-2 text-left text-ui last:border-0 hover:bg-hover disabled:opacity-45"
                      >
                        <Plus size={13} weight="bold" className="shrink-0 text-ink-3" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-ink">{hit.name}</span>
                          <span className="block truncate text-meta text-ink-3">{hit.companyName || hit.email}</span>
                        </span>
                        {blocked ? <Badge tone="warning">{blocked}</Badge> : already ? <span className="shrink-0 text-meta text-ink-3">Added</span> : null}
                      </button>
                    );
                  })
                )}
              </div>
            )}
            {picked.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {picked.map(contact => (
                  <span key={contact.id} className="inline-flex h-7 items-center gap-1.5 rounded-sm border border-line bg-card pl-2 pr-1 text-meta text-ink">
                    {contact.name}
                    {!fixedContacts && (
                      <button type="button" aria-label={`Remove ${contact.name}`} onClick={() => setPicked(current => current.filter(c => c.id !== contact.id))} className="flex h-5 w-5 items-center justify-center rounded-xs text-ink-3 hover:bg-hover hover:text-ink">
                        <X size={11} weight="bold" />
                      </button>
                    )}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-meta text-ink-3">Nobody chosen yet.</p>
            )}
          </div>
        </Field>

        {result && (
          <div className="flex flex-col gap-2 rounded-lg border border-line bg-sunken p-3">
            <p className="text-ui text-ink">
              {result.enrolled ? `${result.enrolled} enrolled in “${result.sequenceName}”.` : 'Nobody was enrolled.'}{' '}
              {result.skipped.length > 0 && <span className="text-ink-2">{result.skipped.length} left out:</span>}
            </p>
            {result.skipped.length > 0 && (
              <ul className="flex flex-col gap-1">
                {result.skipped.map(s => (
                  <li key={s.contactId} className="flex items-start gap-2 text-meta text-ink-2">
                    <Badge tone={s.code === 'no_consent' ? 'danger' : 'warning'}>{LABEL[s.code] ?? 'Skipped'}</Badge>
                    <span className="min-w-0 flex-1 pt-0.5">{s.reason}</span>
                  </li>
                ))}
              </ul>
            )}
            {undeliverable.length > 0 && (
              <p className="rounded-md border border-line bg-card px-3 py-2 text-meta text-ink-2">
                The seeded demo contacts all use reserved addresses. Enrolling them anyway writes every email to the timeline and records it as
                <span className="text-ink"> Not Sent</span> — nothing leaves the building.
              </p>
            )}
          </div>
        )}

        {!result && (
          <p className="text-meta text-ink-3">
            {ws.settings.organizationName} won’t email anyone who has unsubscribed or is marked do-not-contact, and nobody goes on the same sequence twice.
          </p>
        )}
      </div>
    </FormDialog>
  );
}

const LABEL: Record<string, string> = {
  no_email: 'No email',
  no_consent: 'Opted out',
  already_enrolled: 'Already on it',
  undeliverable: 'Demo address',
  missing: 'Gone',
};

/** The small button any record page can drop in to put one contact on a sequence. */
export function EnrollButton({ contact, dealId, size = 'sm' }: { contact: { id: string; name: string }; dealId?: string | null; size?: 'xs' | 'sm' }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" size={size} onClick={() => setOpen(true)}>
        Enroll in sequence
      </Button>
      {open && <EnrollDialog open onOpenChange={setOpen} contacts={[contact]} dealId={dealId ?? null} />}
    </>
  );
}
