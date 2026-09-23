import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { FormDialog } from '../../ui/Dialog';
import { Field, Input, Textarea } from '../../ui/Form';
import { cn } from '../../ui/cn';
import { DEFAULT_SETTINGS, stepKind, type Step, type StepKind } from './model';
import { useSequenceActions } from './queries';

/**
 * Start a sequence. A blank one is a blank page, so the dialog offers three
 * shapes people actually build — you get real steps to edit rather than an
 * empty list, and it starts paused until you say otherwise.
 */

type Starter = { key: string; label: string; description: string; steps: Array<{ kind: StepKind; delayDays: number; subject: string; body?: string; note?: string }> };

const STARTERS: Starter[] = [
  {
    key: 'blank',
    label: 'Empty',
    description: 'One email, and you build the rest.',
    steps: [{ kind: 'auto_email', delayDays: 0, subject: '', body: 'Hi {{contact.first_name | there}},\n\n' }],
  },
  {
    key: 'inbound',
    label: 'Inbound follow-up',
    description: 'Email, call, email — fast on day one, then it backs off.',
    steps: [
      { kind: 'auto_email', delayDays: 0, subject: 'Thanks for getting in touch, {{contact.first_name | there}}', body: 'Hi {{contact.first_name | there}},\n\nThanks for reaching out. Before we talk, one question: how does your team handle this today?\n\n{{sender.first_name}}' },
      { kind: 'call', delayDays: 1, subject: 'Call {{contact.first_name}} about their enquiry', note: 'Lead with the question they asked, not the product.' },
      { kind: 'auto_email', delayDays: 2, subject: 'Two ways teams like {{company.name | yours}} start', body: 'Hi {{contact.first_name | there}},\n\n' },
      { kind: 'auto_email', delayDays: 4, subject: 'Closing the loop', body: 'Hi {{contact.first_name | there}},\n\nI’ll leave it there rather than keep filling your inbox. Replying to this is enough if it comes back around.\n\n{{sender.first_name}}' },
    ],
  },
  {
    key: 'outbound',
    label: 'Cold outbound',
    description: 'Five touches over a fortnight, mixing email, LinkedIn and a call.',
    steps: [
      { kind: 'auto_email', delayDays: 0, subject: 'A question about {{company.name | your operation}}', body: 'Hi {{contact.first_name | there}},\n\n' },
      { kind: 'linkedin', delayDays: 2, subject: 'Connect with {{contact.first_name}}', note: 'Connection request with one line about their business. No link.' },
      { kind: 'auto_email', delayDays: 3, subject: 'One number that usually moves', body: 'Hi {{contact.first_name | there}},\n\n' },
      { kind: 'call', delayDays: 2, subject: 'Cold call {{contact.first_name}}', note: 'Reference the emails. Voicemail and move on if there is no answer.' },
      { kind: 'auto_email', delayDays: 5, subject: 'Last one from me', body: 'Hi {{contact.first_name | there}},\n\nI’ll stop here. Reply to this if it lands on your list later in the year.\n\n{{sender.first_name}}' },
    ],
  },
];

export function CreateSequenceDialog({ open, onOpenChange, defaults }: { open: boolean; onOpenChange: (open: boolean) => void; defaults?: Record<string, unknown> }) {
  const navigate = useNavigate();
  const { save } = useSequenceActions();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [starter, setStarter] = useState('inbound');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(typeof defaults?.name === 'string' ? defaults.name : '');
    setDescription('');
    setStarter('inbound');
    setError(null);
  }, [open]);

  const submit = async () => {
    if (!name.trim()) {
      setError('Give the sequence a name');
      return;
    }
    const chosen = STARTERS.find(s => s.key === starter) ?? STARTERS[0];
    const steps: Step[] = chosen.steps.map((s, i) => ({ id: `s${i + 1}`, kind: s.kind, delayDays: i === 0 ? 0 : s.delayDays, subject: s.subject, body: s.body ?? '', note: s.note ?? '' }));
    const result = await save.mutateAsync({ name: name.trim(), description: description.trim(), status: 'Paused', shared: true, steps, settings: DEFAULT_SETTINGS });
    onOpenChange(false);
    toast.success('Sequence created — it starts paused until you turn it on');
    navigate(`/outreach/sequences/${result.id}`);
  };

  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title="New sequence" description="Give it a name and a shape to start from. Nothing sends until you turn it on." submitLabel="Create sequence" onSubmit={submit}>
      <div className="flex flex-col gap-4">
        <Field label="Name" required error={error ?? undefined}>
          <Input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="New inbound lead" invalid={Boolean(error)} />
        </Field>
        <Field label="Description" hint="What it is for, so the team picks the right one.">
          <Textarea value={description} onChange={e => setDescription(e.target.value)} minRows={2} placeholder="For someone who asked to hear from us." />
        </Field>
        <Field label="Start from">
          <div className="flex flex-col gap-1.5">
            {STARTERS.map(option => (
              <button
                key={option.key}
                type="button"
                onClick={() => setStarter(option.key)}
                aria-pressed={starter === option.key}
                className={cn(
                  'flex flex-col gap-1 rounded-md border px-3 py-2.5 text-left transition-colors',
                  starter === option.key ? 'border-accent bg-accent/[0.07] dark:bg-accent/10' : 'border-line hover:bg-hover',
                )}
              >
                <span className="text-ui font-medium text-ink">{option.label}</span>
                <span className="text-meta text-ink-2">{option.description}</span>
                <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-ink-3">
                  {option.steps.map((s, i) => (
                    <span key={i} className="inline-flex items-center gap-1 text-meta">
                      {stepKind(s.kind).icon}
                    </span>
                  ))}
                </span>
              </button>
            ))}
          </div>
        </Field>
      </div>
    </FormDialog>
  );
}

/** Registered in shell/CreateDialogs.tsx as the `sequence` kind. */
export default function CreateSequenceDialogDefault({ open, onOpenChange, defaults }: { open: boolean; onOpenChange: (open: boolean) => void; defaults: Record<string, unknown> }) {
  return <CreateSequenceDialog open={open} onOpenChange={onOpenChange} defaults={defaults} />;
}
