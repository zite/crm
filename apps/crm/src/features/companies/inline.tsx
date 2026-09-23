import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Chipput } from '../../ui/Button';
import { FactRow } from '../../ui/Layout';
import { Input, Switch, Textarea } from '../../ui/Form';
import { cn } from '../../ui/cn';
import { DatePicker, OptionsPicker } from '../../pickers/pickers';
import { OptionPicker } from '../../pickers/OptionPicker';
import { displayValue, type CustomFieldDef } from '@project/shared/customFields';
import { fullDate } from '../../lib/format';
import { useWorkspace } from '../../lib/workspace';

/**
 * Editing a property where it sits. The value is a button; clicking it swaps in
 * an input. Enter saves, Esc puts the old value back, blur saves — the same
 * contract as the record title on a deal page.
 */
export function InlineText({
  value,
  onSave,
  placeholder = 'Add',
  multiline,
  inputMode,
  parse,
  render,
  className,
  disabled,
}: {
  value: string | null;
  onSave: (value: string | null) => void;
  placeholder?: string;
  multiline?: boolean;
  inputMode?: 'text' | 'numeric' | 'decimal' | 'tel' | 'email' | 'url';
  /** Turn the typed text into what gets saved; return undefined to reject it. */
  parse?: (raw: string) => string | null | undefined;
  render?: (value: string) => ReactNode;
  className?: string;
  disabled?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? '');
  const committed = useRef(false);

  useEffect(() => {
    if (!editing) setDraft(value ?? '');
  }, [value, editing]);

  const commit = () => {
    if (committed.current) return;
    committed.current = true;
    const raw = draft.trim();
    const next = parse ? parse(raw) : raw || null;
    setEditing(false);
    if (next === undefined) return;
    if ((next ?? '') !== (value ?? '')) onSave(next);
  };

  // Read-only (a viewer) has to look like the same fact, so it keeps the same
  // wrapping rules as the editable button — a multiline value still reads as
  // several lines, and a rendered value still truncates itself.
  if (disabled) {
    return (
      <span
        className={cn(
          'min-w-0 text-ui',
          multiline ? 'line-clamp-3 whitespace-pre-wrap' : value && render ? 'flex items-center' : 'truncate',
          value ? 'text-ink' : 'text-ink-3',
          className,
        )}
      >
        {value ? render?.(value) ?? value : '—'}
      </span>
    );
  }

  if (editing) {
    const shared = {
      autoFocus: true,
      value: draft,
      onBlur: commit,
      onKeyDown: (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && (!multiline || e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          commit();
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          committed.current = true;
          setDraft(value ?? '');
          setEditing(false);
        }
      },
    };
    return multiline ? (
      <Textarea {...shared} minRows={3} onChange={e => setDraft(e.target.value)} className={cn('text-ui', className)} />
    ) : (
      <Input {...shared} inputMode={inputMode} onChange={e => setDraft(e.target.value)} className={cn('h-8 text-ui', className)} />
    );
  }

  return (
    <button
      type="button"
      onClick={() => {
        committed.current = false;
        setDraft(value ?? '');
        setEditing(true);
      }}
      className={cn('-mx-2 flex min-h-7 w-full min-w-0 items-center rounded-sm px-2 py-0.5 text-left text-ui transition-colors hover:bg-hover', value ? 'text-ink' : 'text-ink-3', className)}
    >
      {/* A custom `render` may return a flex row (a link with a trailing glyph), and
          an ellipsis can't be put on one of those from the outside — so a rendered
          value gets a flex box and truncates itself, while plain text truncates here. */}
      <span className={cn('min-w-0 flex-1', multiline ? 'line-clamp-3 whitespace-pre-wrap' : value && render ? 'flex items-center' : 'truncate')}>
        {value ? render?.(value) ?? value : placeholder}
      </span>
    </button>
  );
}

/**
 * A picker renders its trigger as a chip with its own 8px of padding, while a
 * plain value sits flush against the grid. Pull the chip back so every value in
 * a facts rail starts on the same vertical line.
 */
export function ChipValue({ children }: { children: ReactNode }) {
  return <span className="-ml-2 flex min-w-0 max-w-full items-center">{children}</span>;
}

/** A yes/no property that reads as a sentence, not a raw checkbox. */
export function InlineSwitch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (value: boolean) => void; label: string; disabled?: boolean }) {
  if (disabled) return <span className="text-ui text-ink">{checked ? 'Yes' : 'No'}</span>;
  return (
    <span className="flex items-center gap-2">
      <Switch checked={checked} onCheckedChange={onChange} />
      <span className="text-ui text-ink-2">{checked ? label : 'No'}</span>
    </span>
  );
}

/**
 * The custom fields an admin defined for this object, read from bootstrap and
 * written back through `mergeCustomValues` on the server. Each type gets the
 * control it deserves rather than a text box for everything.
 */
export function CustomFieldRows({
  object,
  values,
  onSave,
  canEdit,
}: {
  object: 'Company' | 'Contact';
  values: Record<string, unknown>;
  onSave: (patch: Record<string, unknown>) => void;
  canEdit: boolean;
}) {
  const ws = useWorkspace();
  const fields = ws.fieldsFor(object);
  if (!fields.length) return null;
  return (
    <>
      {fields.map(field => {
        const def = field as unknown as CustomFieldDef;
        const value = values[field.key];
        return (
          <FactRow key={field.id} label={field.label} align={field.type === 'Long Text' ? 'start' : 'center'}>
            {renderField(def, value, patch => onSave(patch), canEdit)}
          </FactRow>
        );
      })}
    </>
  );
}

function renderField(def: CustomFieldDef, value: unknown, onSave: (patch: Record<string, unknown>) => void, canEdit: boolean) {
  const key = def.key;
  switch (def.type) {
    case 'Checkbox':
      return <InlineSwitch checked={value === true} onChange={v => onSave({ [key]: v })} label="Yes" disabled={!canEdit} />;
    case 'Date':
      return canEdit ? (
        <ChipValue>
          <DatePicker value={typeof value === 'string' ? value : null} onChange={v => onSave({ [key]: v })} placeholder={`Set ${def.label.toLowerCase()}`} />
        </ChipValue>
      ) : (
        <span className="truncate text-ui">{typeof value === 'string' ? fullDate(value) : '—'}</span>
      );
    case 'Select':
      return canEdit ? (
        <ChipValue>
          <OptionsPicker
            options={def.options}
            value={typeof value === 'string' ? value : null}
            onChange={v => onSave({ [key]: v })}
            allowEmpty
            placeholder={`Set ${def.label.toLowerCase()}`}
            trigger={<Chipput placeholder={!value}>{(value as string) || `Set ${def.label.toLowerCase()}`}</Chipput>}
          />
        </ChipValue>
      ) : (
        <span className="truncate text-ui">{displayValue(def, value as never) || '—'}</span>
      );
    case 'Multi Select': {
      const list = Array.isArray(value) ? (value as string[]) : [];
      return canEdit ? (
        <ChipValue>
          <OptionPicker
            multiple
            options={def.options.map(o => ({ value: o, label: o }))}
            values={list}
            onToggle={(option, selected) => onSave({ [key]: selected ? [...list, option] : list.filter(v => v !== option) })}
            trigger={<Chipput placeholder={!list.length}>{list.length ? list.join(', ') : `Set ${def.label.toLowerCase()}`}</Chipput>}
          />
        </ChipValue>
      ) : (
        <span className="truncate text-ui">{list.join(', ') || '—'}</span>
      );
    }
    case 'Number':
    case 'Currency':
      return (
        <InlineText
          value={value == null || value === '' ? null : String(value)}
          onSave={v => onSave({ [key]: v })}
          placeholder={`Set ${def.label.toLowerCase()}`}
          inputMode="decimal"
          disabled={!canEdit}
          parse={raw => {
            if (!raw) return null;
            const n = Number(raw.replace(/[$,\s]/g, ''));
            return Number.isFinite(n) ? String(n) : undefined;
          }}
          render={v => <span className="tabular truncate">{Number(v).toLocaleString('en-US')}</span>}
        />
      );
    case 'Long Text':
      return <InlineText multiline value={typeof value === 'string' ? value : null} onSave={v => onSave({ [key]: v })} placeholder={`Add ${def.label.toLowerCase()}`} disabled={!canEdit} />;
    case 'URL':
      return (
        <InlineText
          value={typeof value === 'string' ? value : null}
          onSave={v => onSave({ [key]: v })}
          placeholder={`Add ${def.label.toLowerCase()}`}
          inputMode="url"
          disabled={!canEdit}
          render={v => (
            <a href={v} target="_blank" rel="noreferrer noopener" className="truncate text-accent hover:underline" onClick={e => e.stopPropagation()}>
              {v.replace(/^https?:\/\//, '')}
            </a>
          )}
        />
      );
    default:
      return <InlineText value={typeof value === 'string' ? value : null} onSave={v => onSave({ [key]: v })} placeholder={`Add ${def.label.toLowerCase()}`} disabled={!canEdit} />;
  }
}
