import { ArrowDown, ArrowUp, CaretDown, CaretRight, Lock, Plus, Trash } from '@phosphor-icons/react';
import { useState } from 'react';
import { Badge } from '../../ui/Chip';
import { Button } from '../../ui/Button';
import { Field, Input, Switch } from '../../ui/Form';
import { Menu, MenuContent, MenuItem, MenuLabel, MenuTrigger } from '../../ui/Menu';
import { Tooltip } from '../../ui/Tooltip';
import { cn } from '../../ui/cn';
import { FIELD_TYPE_LABELS, LEAD_KEYS, type FormField, type FormFieldType } from './formData';

/**
 * The field builder. Adding, reordering and removing fields is the whole job,
 * so it is plain rows with the controls visible — no drag handles to hunt for,
 * and each row expands to its own settings.
 *
 * The email field is what makes a submission a person we can recognise, so it
 * can be relabelled but never removed or made optional.
 */
const NEW_FIELD_TYPES: FormFieldType[] = ['short_text', 'long_text', 'email', 'phone', 'number', 'select', 'checkbox'];

const SUGGESTED: Array<{ key: string; label: string; type: FormFieldType }> = [
  { key: 'companyName', label: 'Company', type: 'short_text' },
  { key: 'phone', label: 'Phone', type: 'phone' },
  { key: 'title', label: 'Job title', type: 'short_text' },
  { key: 'employees', label: 'How many people work there?', type: 'number' },
  { key: 'website', label: 'Website', type: 'short_text' },
  { key: 'country', label: 'Country', type: 'short_text' },
  { key: 'message', label: 'What are you trying to solve?', type: 'long_text' },
];

const keyFor = (label: string, taken: Set<string>) => {
  const base =
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .replace(/^[^a-z]+/, '')
      .slice(0, 40) || 'field';
  let key = base;
  let n = 2;
  while (taken.has(key)) key = `${base}_${n++}`;
  return key;
};

export function FormFieldBuilder({ fields, onChange, disabled }: { fields: FormField[]; onChange: (fields: FormField[]) => void; disabled?: boolean }) {
  const [openId, setOpenId] = useState<string | null>(null);

  const patch = (index: number, next: Partial<FormField>) => onChange(fields.map((f, i) => (i === index ? { ...f, ...next } : f)));

  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= fields.length) return;
    const next = [...fields];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };

  const add = (type: FormFieldType, preset?: { key: string; label: string }) => {
    const taken = new Set(fields.map(f => f.key));
    const label = preset?.label ?? `${FIELD_TYPE_LABELS[type]} question`;
    const key = preset && !taken.has(preset.key) ? preset.key : keyFor(label, taken);
    const field: FormField = {
      id: `fld_${Date.now().toString(36)}_${key}`,
      key,
      type: key === 'email' ? 'email' : type,
      label,
      required: false,
      placeholder: null,
      help: null,
      options: type === 'select' ? ['First option'] : [],
    };
    onChange([...fields, field]);
    setOpenId(field.id);
  };

  const usedKeys = new Set(fields.map(f => f.key));
  const suggestions = SUGGESTED.filter(s => !usedKeys.has(s.key));

  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-col gap-1.5">
        {fields.map((field, index) => {
          const locked = field.key === 'email';
          const isOpen = openId === field.id;
          const mapped = (LEAD_KEYS as readonly string[]).includes(field.key);
          return (
            <li key={field.id} className={cn('rounded-lg border bg-card transition-colors', isOpen ? 'border-line-strong' : 'border-line')}>
              <div className="flex items-center gap-2 px-2 py-2">
                <button
                  type="button"
                  onClick={() => setOpenId(isOpen ? null : field.id)}
                  className="flex min-w-0 flex-1 items-center gap-2 rounded-sm px-1 py-1 text-left hover:bg-hover"
                  aria-expanded={isOpen}
                >
                  {isOpen ? <CaretDown size={13} className="shrink-0 text-ink-3" /> : <CaretRight size={13} className="shrink-0 text-ink-3" />}
                  <span className="min-w-0 flex-1 truncate text-ui text-ink">{field.label}</span>
                  <span className="shrink-0 text-meta text-ink-3">{FIELD_TYPE_LABELS[field.type]}</span>
                  {field.required && <Badge tone="neutral">Required</Badge>}
                  {mapped && !locked && <Badge tone="info">On the lead</Badge>}
                  {locked && (
                    <Badge tone="accent" icon={<Lock size={11} />}>
                      Always asked
                    </Badge>
                  )}
                </button>
                <div className="flex shrink-0 items-center gap-0.5">
                  <Tooltip content="Move up">
                    <Button variant="ghost" size="xs" icon aria-label={`Move ${field.label} up`} disabled={disabled || index === 0} onClick={() => move(index, -1)}>
                      <ArrowUp size={14} />
                    </Button>
                  </Tooltip>
                  <Tooltip content="Move down">
                    <Button variant="ghost" size="xs" icon aria-label={`Move ${field.label} down`} disabled={disabled || index === fields.length - 1} onClick={() => move(index, 1)}>
                      <ArrowDown size={14} />
                    </Button>
                  </Tooltip>
                  {/* A disabled button can't own a tooltip — nothing hovers it. The
                      email row explains itself with its "Always asked" badge. */}
                  <Tooltip content={locked ? '' : 'Remove'}>
                    <Button
                      variant="ghost"
                      size="xs"
                      icon
                      aria-label={locked ? 'The email field can’t be removed' : `Remove ${field.label}`}
                      disabled={disabled || locked}
                      onClick={() => onChange(fields.filter((_, i) => i !== index))}
                    >
                      <Trash size={14} />
                    </Button>
                  </Tooltip>
                </div>
              </div>

              {isOpen && (
                <div className="flex flex-col gap-3 border-t border-line px-3 py-3">
                  <Field label="Label">
                    <Input value={field.label} disabled={disabled} onChange={e => patch(index, { label: e.target.value })} className="h-8 text-ui" />
                  </Field>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Type">
                      <Menu>
                        <MenuTrigger asChild>
                          <Button variant="secondary" size="sm" className="w-full justify-between" disabled={disabled || locked}>
                            {FIELD_TYPE_LABELS[field.type]}
                            <CaretDown size={12} />
                          </Button>
                        </MenuTrigger>
                        <MenuContent>
                          {NEW_FIELD_TYPES.map(type => (
                            <MenuItem key={type} onSelect={() => patch(index, { type, options: type === 'select' ? (field.options.length ? field.options : ['First option']) : [] })}>
                              {FIELD_TYPE_LABELS[type]}
                            </MenuItem>
                          ))}
                        </MenuContent>
                      </Menu>
                    </Field>
                    <Field label="Placeholder">
                      <Input value={field.placeholder ?? ''} disabled={disabled} onChange={e => patch(index, { placeholder: e.target.value || null })} className="h-8 text-ui" placeholder="Optional" />
                    </Field>
                  </div>
                  <Field label="Help text" hint="A line under the field. Optional.">
                    <Input value={field.help ?? ''} disabled={disabled} onChange={e => patch(index, { help: e.target.value || null })} className="h-8 text-ui" />
                  </Field>
                  {field.type === 'select' && (
                    <Field label="Options" hint="One per line.">
                      <textarea
                        value={field.options.join('\n')}
                        disabled={disabled}
                        onChange={e => patch(index, { options: e.target.value.split('\n').map(o => o.replace(/^\s+/, '')) })}
                        onBlur={e => patch(index, { options: e.target.value.split('\n').map(o => o.trim()).filter(Boolean) })}
                        rows={Math.max(3, field.options.length + 1)}
                        className="w-full rounded-md border border-control/60 bg-card px-2.5 py-2 text-ui leading-6 text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25"
                      />
                    </Field>
                  )}
                  <div className="flex items-center gap-3">
                    <label htmlFor={`required-${field.id}`} className="text-ui font-medium text-ink">
                      Required
                    </label>
                    <Switch id={`required-${field.id}`} checked={field.required} disabled={disabled || locked} onCheckedChange={v => patch(index, { required: v })} />
                    {locked && <span className="text-meta text-ink-3">Every submission needs an email address.</span>}
                  </div>
                  <p className="text-meta text-ink-3">
                    {mapped ? `Answers land on the lead’s ${field.key === 'companyName' ? 'company' : field.key.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()}.` : 'Answers are kept on the submission and added to the lead’s message.'}
                  </p>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {!disabled && (
        <div className="flex flex-wrap items-center gap-1.5">
          <Menu>
            <MenuTrigger asChild>
              <Button variant="secondary" size="sm" leading={<Plus size={14} weight="bold" />}>
                Add field
              </Button>
            </MenuTrigger>
            <MenuContent>
              {suggestions.length > 0 && (
                <>
                  <MenuLabel>Lands on the lead</MenuLabel>
                  {suggestions.map(s => (
                    <MenuItem key={s.key} onSelect={() => add(s.type, s)}>
                      {s.label}
                    </MenuItem>
                  ))}
                </>
              )}
              <MenuLabel>Your own question</MenuLabel>
              {NEW_FIELD_TYPES.filter(t => t !== 'email').map(type => (
                <MenuItem key={type} onSelect={() => add(type)}>
                  {FIELD_TYPE_LABELS[type]}
                </MenuItem>
              ))}
            </MenuContent>
          </Menu>
          <span className="text-meta text-ink-3">{fields.length} of 30 fields</span>
        </div>
      )}
    </div>
  );
}
