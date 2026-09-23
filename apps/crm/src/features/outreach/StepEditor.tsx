import { ArrowDown, ArrowUp, CaretDown, CaretRight, Copy, DotsThree, Plus, Trash } from '@phosphor-icons/react';
import { useRef, useState } from 'react';
import { Badge } from '../../ui/Chip';
import { Button } from '../../ui/Button';
import { Field, Input, Textarea } from '../../ui/Form';
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from '../../ui/Menu';
import { cn } from '../../ui/cn';
import { MergeFieldMenu } from './MergeFieldMenu';
import { TemplatePicker } from './TemplatePicker';
import { blankStep, cumulativeDays, isEmailStep, STEP_KINDS, stepKind, type Step, type StepKind } from './model';

/**
 * The cadence, editable. Each step is a card on a day rail: what happens, how
 * long after the one before, and the words. The first step is always day 0 —
 * that is the moment someone is enrolled — so its delay isn't editable.
 */
export function StepEditor({ steps, onChange, readOnly }: { steps: Step[]; onChange: (steps: Step[]) => void; readOnly?: boolean }) {
  const [openId, setOpenId] = useState<string | null>(steps[0]?.id ?? null);
  const days = cumulativeDays(steps);

  const patch = (index: number, changes: Partial<Step>) => onChange(steps.map((s, i) => (i === index ? { ...s, ...changes } : s)));

  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= steps.length) return;
    const next = [...steps];
    [next[index], next[target]] = [next[target], next[index]];
    // The first step is always day 0, so a step promoted to the front loses its wait.
    onChange(next.map((s, i) => (i === 0 ? { ...s, delayDays: 0 } : s)));
  };

  const duplicate = (index: number) => {
    const copy = { ...steps[index], id: blankStep(steps.length).id };
    onChange([...steps.slice(0, index + 1), copy, ...steps.slice(index + 1)]);
    setOpenId(copy.id);
  };

  const add = (kind: StepKind) => {
    const step = blankStep(steps.length, kind);
    onChange([...steps, step]);
    setOpenId(step.id);
  };

  return (
    <div className="flex flex-col">
      {steps.map((step, index) => {
        const meta = stepKind(step.kind);
        const open = openId === step.id;
        return (
          <div key={step.id} className="relative flex gap-2 sm:gap-4">
            <div className="flex w-10 shrink-0 justify-end pt-3.5 sm:w-14">
              <span className="text-micro font-semibold uppercase text-ink-3">Day {days[index]}</span>
            </div>
            <div className="relative flex flex-col items-center">
              <span className={cn('z-10 mt-2.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border bg-card', open ? 'border-accent text-accent' : 'border-line text-ink-2')}>{meta.icon}</span>
              {index < steps.length - 1 && <span className="w-px flex-1 bg-line" />}
            </div>

            <div className={cn('mb-3 min-w-0 flex-1 rounded-lg border bg-card', open ? 'border-line-strong shadow-hairline' : 'border-line')}>
              <div className="flex items-center gap-2 px-3 py-2.5">
                <button type="button" onClick={() => setOpenId(open ? null : step.id)} className="flex min-w-0 flex-1 items-center gap-2 rounded-sm text-left hover:text-ink" aria-expanded={open}>
                  {open ? <CaretDown size={12} weight="bold" className="shrink-0 text-ink-3" /> : <CaretRight size={12} weight="bold" className="shrink-0 text-ink-3" />}
                  <span className="truncate text-ui font-medium text-ink">{step.subject || `${meta.label} — untitled`}</span>
                  <Badge tone={meta.automatic ? 'info' : 'neutral'} className="hidden shrink-0 sm:inline-flex">
                    {meta.automatic ? 'Automatic' : 'Task'}
                  </Badge>
                </button>
                {!readOnly && (
                  <>
                    {/* Room for four buttons on a desktop; one menu on a phone. */}
                    <div className="hidden shrink-0 items-center gap-0.5 sm:flex">
                      <Button variant="ghost" size="xs" icon aria-label="Move step up" disabled={index === 0} onClick={() => move(index, -1)}>
                        <ArrowUp size={14} />
                      </Button>
                      <Button variant="ghost" size="xs" icon aria-label="Move step down" disabled={index === steps.length - 1} onClick={() => move(index, 1)}>
                        <ArrowDown size={14} />
                      </Button>
                      <Button variant="ghost" size="xs" icon aria-label="Duplicate step" onClick={() => duplicate(index)}>
                        <Copy size={14} />
                      </Button>
                      <Button variant="ghost" size="xs" icon aria-label="Remove step" onClick={() => onChange(steps.filter((_, i) => i !== index).map((s, i) => (i === 0 ? { ...s, delayDays: 0 } : s)))}>
                        <Trash size={14} />
                      </Button>
                    </div>
                    <Menu>
                      <MenuTrigger asChild>
                        <Button variant="ghost" size="xs" icon aria-label={`Actions for step ${index + 1}`} className="shrink-0 sm:hidden">
                          <DotsThree size={16} weight="bold" />
                        </Button>
                      </MenuTrigger>
                      <MenuContent align="end">
                        <MenuItem icon={<ArrowUp size={16} />} disabled={index === 0} onSelect={() => move(index, -1)}>
                          Move up
                        </MenuItem>
                        <MenuItem icon={<ArrowDown size={16} />} disabled={index === steps.length - 1} onSelect={() => move(index, 1)}>
                          Move down
                        </MenuItem>
                        <MenuItem icon={<Copy size={16} />} onSelect={() => duplicate(index)}>
                          Duplicate
                        </MenuItem>
                        <MenuSeparator />
                        <MenuItem destructive icon={<Trash size={16} />} onSelect={() => onChange(steps.filter((_, i) => i !== index).map((s, i) => (i === 0 ? { ...s, delayDays: 0 } : s)))}>
                          Remove step
                        </MenuItem>
                      </MenuContent>
                    </Menu>
                  </>
                )}
              </div>

              {open && (
                <div className="flex flex-col gap-4 border-t border-line px-3 py-4 sm:px-4">
                  <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_170px]">
                    <Field label="What happens" hint={meta.hint}>
                      <Menu>
                        <MenuTrigger asChild>
                          <Button variant="secondary" size="md" className="w-full justify-start" leading={meta.icon} disabled={readOnly}>
                            {meta.label}
                          </Button>
                        </MenuTrigger>
                        <MenuContent>
                          <MenuLabel>Step type</MenuLabel>
                          {STEP_KINDS.map(k => (
                            <MenuItem key={k.value} icon={k.icon} hint={k.automatic ? 'Automatic' : 'Task'} onSelect={() => patch(index, { kind: k.value })}>
                              {k.label}
                            </MenuItem>
                          ))}
                        </MenuContent>
                      </Menu>
                    </Field>
                    <Field label="Wait" hint={index === 0 ? 'The first step runs on enrollment.' : 'Days after the step above.'}>
                      <div className="flex items-center gap-2">
                        <Input
                          type="number"
                          min={0}
                          max={120}
                          disabled={readOnly || index === 0}
                          value={index === 0 ? 0 : step.delayDays}
                          onChange={e => patch(index, { delayDays: Math.max(0, Math.min(120, Number(e.target.value) || 0)) })}
                          className="w-20"
                          aria-label={`Days to wait before step ${index + 1}`}
                        />
                        <span className="text-ui text-ink-2">days</span>
                      </div>
                    </Field>
                  </div>

                  <StepBody step={step} index={index} readOnly={readOnly} onPatch={patch} />
                </div>
              )}
            </div>
          </div>
        );
      })}

      {!readOnly && (
        <div className="flex gap-3 pl-10 sm:gap-4 sm:pl-14">
          <div className="w-7" />
          <Menu>
            <MenuTrigger asChild>
              <Button variant="secondary" size="sm" leading={<Plus size={15} weight="bold" />}>
                Add a step
              </Button>
            </MenuTrigger>
            <MenuContent>
              <MenuLabel>Step type</MenuLabel>
              {STEP_KINDS.map(k => (
                <MenuItem key={k.value} icon={k.icon} hint={k.automatic ? 'Automatic' : 'Task'} onSelect={() => add(k.value)}>
                  {k.label}
                </MenuItem>
              ))}
            </MenuContent>
          </Menu>
        </div>
      )}
    </div>
  );
}

function StepBody({ step, index, readOnly, onPatch }: { step: Step; index: number; readOnly?: boolean; onPatch: (index: number, changes: Partial<Step>) => void }) {
  const subjectRef = useRef<HTMLInputElement | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);
  const meta = stepKind(step.kind);
  const email = isEmailStep(step.kind);

  return (
    <>
      <Field
        label={email ? 'Subject' : 'Task title'}
        action={
          <div className="flex flex-wrap items-center justify-end gap-1">
            {email && !readOnly && <TemplatePicker label="Template" onPick={t => onPatch(index, { subject: t.subject, body: t.body })} />}
            {!readOnly && <MergeFieldMenu target={subjectRef} value={step.subject} onChange={v => onPatch(index, { subject: v })} label="Field" />}
          </div>
        }
      >
        <Input
          ref={subjectRef}
          readOnly={readOnly}
          value={step.subject}
          onChange={e => onPatch(index, { subject: e.target.value })}
          placeholder={email ? 'A quicker way to run {{company.name}}' : `${meta.verb} {{contact.first_name}}`}
        />
      </Field>

      {email && (
        <Field label="Message" action={!readOnly && <MergeFieldMenu target={bodyRef} value={step.body} onChange={v => onPatch(index, { body: v })} label="Field" />}>
          <Textarea
            ref={bodyRef}
            readOnly={readOnly}
            value={step.body}
            onChange={e => onPatch(index, { body: e.target.value })}
            minRows={8}
            placeholder={'Hi {{contact.first_name | there}},\n\n'}
          />
        </Field>
      )}

      <Field label="Note for whoever does it" hint={email && step.kind === 'auto_email' ? 'Nobody sees this — it is for your team.' : 'Shown on the task.'}>
        <Textarea readOnly={readOnly} value={step.note} onChange={e => onPatch(index, { note: e.target.value })} minRows={2} placeholder="Lead with the question they asked, not the product." />
      </Field>
    </>
  );
}
