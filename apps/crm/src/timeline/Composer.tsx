import { CalendarBlank, EnvelopeSimple, NotePencil, Phone, Sparkle } from '@phosphor-icons/react';
import { useState } from 'react';
import { toast } from 'sonner';
import { aiNextSteps } from 'zitejs/api';
import { Checkbox } from '../ui/Form';
import { errorMessage } from '../lib/errors';
import { useTaskActions } from '../lib/mutations';
import { Button } from '../ui/Button';
import { Input } from '../ui/Form';
import { Kbd } from '../ui/Kbd';
import { cn } from '../ui/cn';
import { DatePicker, OptionsPicker, FieldButton } from '../pickers/pickers';
import { CALL_OUTCOMES, MEETING_OUTCOMES } from '@project/shared/constants';
import { useLogActivity } from '../lib/mutations';
import { shortDate, todayString } from '../lib/format';
import { MentionTextarea } from './MentionTextarea';

export type ComposerLinks = { companyId?: string | null; contactId?: string | null; dealId?: string | null; leadId?: string | null };

const MODES = [
  { value: 'Note', label: 'Note', icon: <NotePencil size={15} /> },
  { value: 'Call', label: 'Call', icon: <Phone size={15} /> },
  { value: 'Meeting', label: 'Meeting', icon: <CalendarBlank size={15} /> },
] as const;

/**
 * The box at the top of a timeline: log a note, a call or a meeting without
 * leaving the record. Email has its own dialog, because it actually sends.
 */
export function Composer({ links, onEmail, className, defaultMode = 'Note' }: { links: ComposerLinks; onEmail?: () => void; className?: string; defaultMode?: 'Note' | 'Call' | 'Meeting' }) {
  const [mode, setMode] = useState<'Note' | 'Call' | 'Meeting'>(defaultMode);
  const [body, setBody] = useState('');
  const [open, setOpen] = useState(false);
  const [outcome, setOutcome] = useState<string | null>(null);
  const [day, setDay] = useState<string | null>(todayString());
  const [duration, setDuration] = useState('');
  const log = useLogActivity();
  const taskActions = useTaskActions();
  const [suggested, setSuggested] = useState<Array<{ title: string; dueInDays: number; keep: boolean }> | null>(null);
  const [suggesting, setSuggesting] = useState(false);

  // Notes written after a call usually contain the follow-ups; offer to keep them as tasks.
  const findNextSteps = async () => {
    setSuggesting(true);
    try {
      const result = await aiNextSteps({ text: body, dealId: links.dealId ?? null });
      setSuggested(result.tasks.map(t => ({ ...t, keep: true })));
      if (!result.tasks.length) toast.message('Nothing in those notes looked like a follow-up');
    } catch (e) {
      toast.error(errorMessage(e, 'Couldn’t read those notes'));
    } finally {
      setSuggesting(false);
    }
  };

  const submit = async () => {
    if (mode === 'Note' && !body.trim()) return;
    await log.mutateAsync({
      kind: mode,
      body: body.trim() || null,
      occurredAt: day ? new Date(`${day}T12:00:00`).toISOString() : new Date().toISOString(),
      outcome: (outcome as 'Connected') ?? (mode === 'Meeting' ? 'Completed' : null),
      durationMinutes: duration.trim() ? Number(duration) : null,
      ...links,
    });
    for (const task of suggested ?? []) {
      if (!task.keep) continue;
      const due = new Date();
      due.setDate(due.getDate() + task.dueInDays);
      await taskActions.create.mutateAsync({ title: task.title, dueDate: due.toLocaleDateString('en-CA'), type: 'To-do', ...links });
    }
    setBody('');
    setOutcome(null);
    setDuration('');
    setSuggested(null);
    setOpen(false);
    toast.success(suggested?.some(t => t.keep) ? `${mode} logged, with follow-ups` : `${mode} logged`);
  };

  return (
    <div className={cn('rounded-lg border border-line bg-card shadow-hairline', className)}>
      <div className="flex items-center gap-1 border-b border-line px-2 py-1.5">
        {MODES.map(m => (
          <button
            key={m.value}
            type="button"
            onClick={() => {
              setMode(m.value);
              setOpen(true);
              setOutcome(null);
            }}
            className={cn('inline-flex h-8 items-center gap-1.5 rounded-sm px-2.5 text-ui font-medium transition-colors', mode === m.value && open ? 'bg-sunken text-ink' : 'text-ink-2 hover:bg-hover hover:text-ink')}
          >
            {m.icon}
            {m.label}
          </button>
        ))}
        {onEmail && (
          <button type="button" onClick={onEmail} className="inline-flex h-8 items-center gap-1.5 rounded-sm px-2.5 text-ui font-medium text-ink-2 transition-colors hover:bg-hover hover:text-ink">
            <EnvelopeSimple size={15} />
            Email
          </button>
        )}
      </div>
      {open ? (
        <div className="flex flex-col gap-3 p-3">
          <MentionTextarea
            autoFocus
            value={body}
            onChange={setBody}
            onSubmit={submit}
            minRows={3}
            placeholder={mode === 'Note' ? 'What happened, and what’s next — @ to mention a teammate' : mode === 'Call' ? 'How did the call go?' : 'What did you cover?'}
          />
          {suggested && suggested.length > 0 && (
            <div className="rounded-md border border-line bg-sunken/60 p-2.5">
              <div className="mb-1.5 flex items-center gap-1.5 text-micro font-semibold uppercase text-ink-3">
                <Sparkle size={12} /> Follow-ups found in these notes
              </div>
              <ul className="flex flex-col gap-1">
                {suggested.map((task, i) => (
                  <li key={`${task.title}-${i}`} className="flex items-center gap-2.5">
                    <Checkbox checked={task.keep} onCheckedChange={keep => setSuggested(list => (list ?? []).map((t, j) => (j === i ? { ...t, keep } : t)))} label={task.title} />
                    <span className="min-w-0 flex-1 truncate text-ui text-ink">{task.title}</span>
                    <span className="shrink-0 text-meta text-ink-3">{task.dueInDays === 0 ? 'today' : `in ${task.dueInDays}d`}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <DatePicker value={day} onChange={setDay} trigger={<FieldButton className="h-8 w-auto text-ui">{day ? shortDate(day) : 'Date'}</FieldButton>} />
            {mode !== 'Note' && (
              <OptionsPicker
                options={mode === 'Call' ? [...CALL_OUTCOMES] : [...MEETING_OUTCOMES]}
                value={outcome}
                onChange={setOutcome}
                allowEmpty
                placeholder="Outcome"
                trigger={<FieldButton className="h-8 w-auto text-ui" placeholder={!outcome}>{outcome ?? 'Outcome'}</FieldButton>}
              />
            )}
            {mode !== 'Note' && <Input value={duration} onChange={e => setDuration(e.target.value)} inputMode="numeric" placeholder="Minutes" className="h-8 w-[104px] text-ui" />}
            <div className="ml-auto flex items-center gap-2">
              {body.trim().length > 40 && !suggested && (
                <Button variant="ghost" size="sm" leading={<Sparkle size={14} />} loading={suggesting} onClick={findNextSteps}>
                  Find next steps
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button variant="primary" size="sm" onClick={submit} loading={log.isPending} disabled={mode === 'Note' && !body.trim()}>
                Log {mode.toLowerCase()} <Kbd keys="mod+enter" tone="inverse" className="ml-1" />
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => setOpen(true)} className="w-full px-3 py-3 text-left text-ui text-ink-3 hover:text-ink-2">
          Log what just happened…
        </button>
      )}
    </div>
  );
}
