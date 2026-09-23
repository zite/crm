import { Plus, X } from '@phosphor-icons/react';
import { useMemo, useState } from 'react';
import type { saveAutomation } from 'zitejs/api';
import { Button } from '../../ui/Button';
import { FormDialog } from '../../ui/Dialog';
import { Field, Input, Select, SwitchRow } from '../../ui/Form';
import { cn } from '../../ui/cn';
import { TASK_TYPES } from '@project/shared/constants';
import { useWorkspace } from '../../lib/workspace';
import type { AutomationRow } from './AutomationsSection';
import { ACTION_OPTIONS, CONDITION_OPTIONS, OP_LABEL, SET_FIELD_OPTIONS, TRIGGER_OPTIONS, automationSentence, conditionOption, triggerOption, type Names } from './automationText';

type SaveInput = Parameters<typeof saveAutomation>[0];
type Condition = SaveInput['conditions'][number];
type Action = SaveInput['actions'][number];

/**
 * The builder: trigger, then conditions, then actions, with the finished
 * sentence in front of you the whole time. Changing the trigger changes what
 * you can ask about — a lead has a score, a deal has an amount — so the
 * condition list follows the trigger's subject rather than offering fields
 * that would never be true.
 */
export function AutomationDialog({
  rule,
  templates,
  sequences,
  onClose,
  onSave,
  pending,
}: {
  rule: AutomationRow | null;
  templates: Array<{ id: string; name: string }>;
  sequences: Array<{ id: string; name: string; status: string }>;
  onClose: () => void;
  onSave: (input: SaveInput) => void;
  pending: boolean;
}) {
  const ws = useWorkspace();
  const [name, setName] = useState(rule?.name ?? '');
  const [description, setDescription] = useState(rule?.description ?? '');
  const [trigger, setTrigger] = useState(rule?.trigger ?? 'deal.won');
  const [conditions, setConditions] = useState<Condition[]>((rule?.conditions as Condition[]) ?? []);
  const [actions, setActions] = useState<Action[]>((rule?.actions as Action[]) ?? [{ type: 'createTask', title: '', taskType: 'To-do', priority: 'Normal', dueInDays: 1, memberId: 'owner' }]);
  const [active, setActive] = useState(rule?.active ?? true);

  const option = triggerOption(trigger);
  const available = CONDITION_OPTIONS.filter(c => c.subjects.includes(option.subject));

  const names: Names = useMemo(
    () => ({
      member: id => ws.memberById(id)?.name ?? 'a teammate',
      stage: id => ws.stageById(id)?.name ?? 'that stage',
      pipeline: id => ws.pipelineById(id)?.name ?? 'that pipeline',
      tag: id => ws.tagById(id)?.name ?? 'that tag',
      template: id => templates.find(t => t.id === id)?.name ?? 'that template',
      sequence: id => sequences.find(s => s.id === id)?.name ?? 'that sequence',
      money: n => ws.money(n),
    }),
    [ws, templates, sequences],
  );

  const sentence = automationSentence({ trigger, conditions, actions }, names);
  const incomplete = actions.some(a => (a.type === 'createTask' && !a.title?.trim()) || (a.type === 'sendEmail' && !a.templateId) || (a.type === 'enrollSequence' && !a.sequenceId) || (a.type === 'setField' && !a.field));
  const valid = Boolean(name.trim()) && actions.length > 0 && !incomplete;

  const setCondition = (index: number, patch: Partial<Condition>) => setConditions(list => list.map((c, i) => (i === index ? { ...c, ...patch } : c)));
  const setAction = (index: number, patch: Partial<Action>) => setActions(list => list.map((a, i) => (i === index ? { ...a, ...patch } : a)));

  return (
    <FormDialog
      open
      onOpenChange={o => !o && onClose()}
      title={rule ? `Edit “${rule.name}”` : 'New automation'}
      submitLabel={rule ? 'Save automation' : 'Create automation'}
      size="xl"
      pending={pending}
      disabled={!valid}
      onSubmit={() => onSave({ ...(rule ? { automationId: rule.id } : {}), name: name.trim(), description: description.trim() || undefined, trigger, conditions, actions, active })}
      footerStart={<span className="hidden max-w-[360px] truncate text-meta text-ink-3 sm:block">{sentence.full}</span>}
    >
      <div className="flex flex-col gap-5">
        <Field label="Name" required hint="What you’d call it out loud." htmlFor="auto-name">
          <Input id="auto-name" autoFocus value={name} onChange={e => setName(e.target.value)} maxLength={120} placeholder="Hand off every win" />
        </Field>

        <Step index={1} title="When this happens">
          <Select
            value={trigger}
            onChange={e => {
              const next = e.target.value as typeof trigger;
              setTrigger(next);
              // Conditions that can't be true of the new subject would silently never match.
              const subjects = triggerOption(next).subject;
              setConditions(list => list.filter(c => conditionOption(c.field).subjects.includes(subjects)));
            }}
            aria-label="Trigger"
          >
            {TRIGGER_OPTIONS.map(t => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </Select>
          <p className="mt-1.5 text-meta text-ink-2">{option.note}</p>
        </Step>

        <Step
          index={2}
          title="Only if"
          hint={conditions.length ? 'Every condition has to be true.' : 'No conditions — it runs every time.'}
          action={
            available.length > 0 && (
              <Button variant="ghost" size="xs" leading={<Plus size={13} weight="bold" />} onClick={() => setConditions(list => [...list, { field: available[0].value, op: available[0].ops[0], value: '' }])}>
                Add condition
              </Button>
            )
          }
        >
          {conditions.length > 0 && (
            <div className="flex flex-col gap-2">
              {conditions.map((condition, index) => {
                const def = conditionOption(condition.field);
                return (
                  <div key={index} className="flex flex-wrap items-center gap-2 rounded-md border border-line bg-sunken/50 p-2">
                    <Select
                      className="h-8 w-[140px] text-ui"
                      value={condition.field}
                      onChange={e => {
                        const next = conditionOption(e.target.value);
                        setCondition(index, { field: next.value, op: next.ops[0], value: '' });
                      }}
                      aria-label="Field"
                    >
                      {available.map(c => (
                        <option key={c.value} value={c.value}>
                          {c.label}
                        </option>
                      ))}
                    </Select>
                    <Select className="h-8 w-[112px] text-ui" value={condition.op} onChange={e => setCondition(index, { op: e.target.value as Condition['op'] })} aria-label="Comparison">
                      {def.ops.map(op => (
                        <option key={op} value={op}>
                          {OP_LABEL[op]}
                        </option>
                      ))}
                    </Select>
                    <ConditionValue def={def} value={condition.value} onChange={v => setCondition(index, { value: v })} />
                    <Button variant="ghost" size="sm" icon aria-label="Remove condition" className="ml-auto" onClick={() => setConditions(list => list.filter((_, i) => i !== index))}>
                      <X size={14} />
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </Step>

        <Step
          index={3}
          title="Then"
          action={
            <Button variant="ghost" size="xs" leading={<Plus size={13} weight="bold" />} disabled={actions.length >= 8} onClick={() => setActions(list => [...list, { type: 'notify', memberId: 'owner' }])}>
              Add action
            </Button>
          }
        >
          <div className="flex flex-col gap-2">
            {actions.map((action, index) => (
              <div key={index} className="rounded-md border border-line bg-sunken/50 p-2.5">
                <div className="flex items-center gap-2">
                  <Select className="h-8 w-[200px] text-ui" value={action.type} onChange={e => setAction(index, resetAction(e.target.value as Action['type']))} aria-label="Action">
                    {ACTION_OPTIONS.map(a => (
                      <option key={a.value} value={a.value}>
                        {a.label}
                      </option>
                    ))}
                  </Select>
                  {actions.length > 1 && (
                    <Button variant="ghost" size="sm" icon aria-label="Remove action" className="ml-auto" onClick={() => setActions(list => list.filter((_, i) => i !== index))}>
                      <X size={14} />
                    </Button>
                  )}
                </div>
                <ActionFields action={action} templates={templates} sequences={sequences} onChange={patch => setAction(index, patch)} />
              </div>
            ))}
          </div>
        </Step>

        <div className="rounded-lg border border-line bg-sunken/60 px-4 py-3">
          <div className="text-micro font-semibold uppercase text-ink-3">Reads as</div>
          <p className="mt-1 text-body text-ink text-pretty">{sentence.full}</p>
        </div>

        <Field label="Note" hint="Why it exists — for whoever finds it in six months." htmlFor="auto-desc">
          <Input id="auto-desc" value={description} onChange={e => setDescription(e.target.value)} maxLength={400} placeholder="A won deal needs someone to pick it up." />
        </Field>

        <SwitchRow label="Switched on" description="Off, it stays here and does nothing. You can still run it on a record by hand." checked={active} onCheckedChange={setActive} />
      </div>
    </FormDialog>
  );
}

function resetAction(type: Action['type']): Action {
  switch (type) {
    case 'createTask':
      return { type, title: '', taskType: 'To-do', priority: 'Normal', dueInDays: 1, memberId: 'owner' };
    case 'notify':
      return { type, memberId: 'owner' };
    case 'sendEmail':
      return { type, templateId: '' };
    case 'setField':
      return { type, field: 'owner', value: '' };
    case 'enrollSequence':
      return { type, sequenceId: '' };
    default:
      return { type: 'notify', memberId: 'owner' };
  }
}

function Step({ index, title, hint, action, children }: { index: number; title: string; hint?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-2 flex items-center gap-2">
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-on-primary">{index}</span>
        <h3 className="text-ui font-semibold text-ink">{title}</h3>
        {hint && <span className="truncate text-meta text-ink-3">{hint}</span>}
        {action && <div className="ml-auto">{action}</div>}
      </div>
      {children}
    </section>
  );
}

function ConditionValue({ def, value, onChange }: { def: ReturnType<typeof conditionOption>; value: string; onChange: (v: string) => void }) {
  const ws = useWorkspace();
  const cls = 'h-8 min-w-[150px] flex-1 text-ui';
  switch (def.kind) {
    case 'member':
      return (
        <Select className={cls} value={value} onChange={e => onChange(e.target.value)} aria-label="Value">
          <option value="">Choose a teammate</option>
          <option value="unassigned">Nobody (unassigned)</option>
          {ws.activeMembers.map(m => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </Select>
      );
    case 'stage':
      return (
        <Select className={cls} value={value} onChange={e => onChange(e.target.value)} aria-label="Value">
          <option value="">Choose a stage</option>
          {ws.pipelines
            .filter(p => !p.archived)
            .map(p => (
              <optgroup key={p.id} label={p.name}>
                {ws.stagesFor(p.id).map(s => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </optgroup>
            ))}
        </Select>
      );
    case 'pipeline':
      return (
        <Select className={cls} value={value} onChange={e => onChange(e.target.value)} aria-label="Value">
          <option value="">Choose a pipeline</option>
          {ws.pipelines.filter(p => !p.archived).map(p => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      );
    case 'tag':
      return (
        <Select className={cls} value={value} onChange={e => onChange(e.target.value)} aria-label="Value">
          <option value="">Choose a tag</option>
          {ws.tags.map(t => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </Select>
      );
    case 'choice':
      return (
        <Select className={cls} value={value} onChange={e => onChange(e.target.value)} aria-label="Value">
          <option value="">Choose one</option>
          {(def.choices ?? []).map(c => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Select>
      );
    case 'number':
      return <Input className={cn(cls, 'max-w-[140px]')} type="number" value={value} onChange={e => onChange(e.target.value)} aria-label="Value" placeholder="50000" />;
    default:
      return <Input className={cls} value={value} onChange={e => onChange(e.target.value)} aria-label="Value" placeholder="Website form" />;
  }
}

function ActionFields({
  action,
  templates,
  sequences,
  onChange,
}: {
  action: Action;
  templates: Array<{ id: string; name: string }>;
  sequences: Array<{ id: string; name: string; status: string }>;
  onChange: (patch: Partial<Action>) => void;
}) {
  const ws = useWorkspace();
  const setField = SET_FIELD_OPTIONS.find(f => f.value === action.field);

  if (action.type === 'createTask') {
    return (
      <div className="mt-2 flex flex-col gap-2">
        <Input value={action.title ?? ''} onChange={e => onChange({ title: e.target.value })} placeholder="Hand off to onboarding" maxLength={240} className="h-8 text-ui" aria-label="Task title" />
        <div className="flex flex-wrap items-center gap-2">
          <Select className="h-8 w-[120px] text-ui" value={action.taskType ?? 'To-do'} onChange={e => onChange({ taskType: e.target.value as Action['taskType'] })} aria-label="Task type">
            {TASK_TYPES.map(t => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>
          <Select className="h-8 w-[104px] text-ui" value={action.priority ?? 'Normal'} onChange={e => onChange({ priority: e.target.value as Action['priority'] })} aria-label="Priority">
            {['High', 'Normal', 'Low'].map(p => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </Select>
          <span className="text-meta text-ink-2">due in</span>
          <Input type="number" min={0} max={365} value={String(action.dueInDays ?? 1)} onChange={e => onChange({ dueInDays: Math.max(0, Number(e.target.value) || 0) })} className="h-8 w-[76px] text-ui" aria-label="Days from now" />
          <span className="text-meta text-ink-2">days, for</span>
          <MemberSelect value={action.memberId ?? 'owner'} onChange={v => onChange({ memberId: v })} ownerLabel="the record’s owner" />
        </div>
      </div>
    );
  }

  if (action.type === 'notify') {
    return (
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <MemberSelect value={action.memberId ?? 'owner'} onChange={v => onChange({ memberId: v })} ownerLabel="the record’s owner" />
        <Input value={action.message ?? ''} onChange={e => onChange({ message: e.target.value })} placeholder="What the notification should say" maxLength={240} className="h-8 min-w-[200px] flex-1 text-ui" aria-label="Message" />
      </div>
    );
  }

  if (action.type === 'sendEmail') {
    return (
      <div className="mt-2 flex flex-col gap-1.5">
        <Select className="h-8 text-ui" value={action.templateId ?? ''} onChange={e => onChange({ templateId: e.target.value })} aria-label="Email template">
          <option value="">Choose a template</option>
          {templates.map(t => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </Select>
        <p className="text-meta text-ink-3">Goes to the record’s contact, from its owner, with your footer and an unsubscribe link. Nothing is sent to a contact who has opted out.</p>
      </div>
    );
  }

  if (action.type === 'enrollSequence') {
    return (
      <div className="mt-2 flex flex-col gap-1.5">
        <Select className="h-8 text-ui" value={action.sequenceId ?? ''} onChange={e => onChange({ sequenceId: e.target.value })} aria-label="Sequence">
          <option value="">Choose a sequence</option>
          {sequences.map(s => (
            <option key={s.id} value={s.id}>
              {s.name}
              {s.status !== 'Active' ? ` (${s.status.toLowerCase()})` : ''}
            </option>
          ))}
        </Select>
        <p className="text-meta text-ink-3">Only the record’s contact is enrolled, and only if they haven’t opted out or been enrolled already.</p>
      </div>
    );
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <Select className="h-8 w-[168px] text-ui" value={action.field ?? 'owner'} onChange={e => onChange({ field: e.target.value as Action['field'], value: '' })} aria-label="Field">
        {SET_FIELD_OPTIONS.map(f => (
          <option key={f.value} value={f.value}>
            {f.label}
          </option>
        ))}
      </Select>
      <span className="text-meta text-ink-2">to</span>
      {setField?.kind === 'member' ? (
        <Select className="h-8 min-w-[168px] flex-1 text-ui" value={action.value ?? ''} onChange={e => onChange({ value: e.target.value })} aria-label="Value">
          <option value="">Choose a teammate</option>
          <option value="unassigned">Nobody (unassign it)</option>
          {ws.activeMembers.map(m => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </Select>
      ) : setField?.kind === 'tag' ? (
        <Select className="h-8 min-w-[168px] flex-1 text-ui" value={action.value ?? ''} onChange={e => onChange({ value: e.target.value })} aria-label="Value">
          <option value="">Choose a tag</option>
          {ws.tags.map(t => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </Select>
      ) : (
        <Select className="h-8 min-w-[168px] flex-1 text-ui" value={action.value ?? ''} onChange={e => onChange({ value: e.target.value })} aria-label="Value">
          <option value="">Choose one</option>
          {(setField?.choices ?? []).map(c => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Select>
      )}
    </div>
  );
}

function MemberSelect({ value, onChange, ownerLabel }: { value: string; onChange: (v: string) => void; ownerLabel: string }) {
  const ws = useWorkspace();
  return (
    <Select className="h-8 min-w-[168px] flex-1 text-ui" value={value} onChange={e => onChange(e.target.value)} aria-label="Teammate">
      <option value="owner">{ownerLabel}</option>
      {ws.activeMembers.map(m => (
        <option key={m.id} value={m.id}>
          {m.name}
        </option>
      ))}
    </Select>
  );
}
