import { Buildings, CalendarBlank, CaretDown, Plus, Trophy, User, UserCircle, X } from '@phosphor-icons/react';
import { forwardRef, useEffect, useId, useMemo, useState, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '../ui/cn';
import { Avatar, Unassigned } from '../ui/Avatar';
import { Button, Chipput } from '../ui/Button';
import { Calendar } from '../ui/Calendar';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/Popover';
import { TagChip } from '../ui/Chip';
import { CompanyMark, StageMeter } from '../glyphs';
import { useWorkspace } from '../lib/workspace';
import { useSearch } from '../lib/queries';
import { fullDate, shortDate } from '../lib/format';
import type { ChoiceList } from '@project/shared/constants';
import { OptionPicker, type Option } from './OptionPicker';

/**
 * Pickers all take `value`, `onChange` and a `trigger`, and all open the same
 * searchable list. A trigger is usually a <Chipput> in a rail or row, or a
 * <FieldButton> in a form.
 */

/** Radix anchors popovers to their trigger, so this must forward its ref. */
export const FieldButton = forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> & { placeholder?: boolean; icon?: ReactNode; onClear?: () => void; invalid?: boolean }>(function FieldButton(
  { children, placeholder, icon, onClear, className, invalid, ...rest },
  ref,
) {
  return (
    <span className="relative flex">
      <button
        ref={ref}
        type="button"
        className={cn(
          'flex h-9 w-full items-center gap-2 rounded-md border border-control/60 bg-card px-2.5 text-body transition-colors hover:border-control focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25',
          placeholder ? 'text-ink-3' : 'text-ink',
          invalid && 'border-danger',
          onClear && 'pr-8',
          className,
        )}
        {...rest}
      >
        {icon}
        <span className="min-w-0 flex-1 truncate text-left">{children}</span>
        {/* Without a caret these read as text inputs: in New company, Type, Industry,
            Owner and Source were all bordered boxes you could only discover by
            clicking. The clear button, when there is one, sits over this. */}
        {!onClear && <CaretDown size={14} weight="bold" className="shrink-0 text-ink-3" />}
      </button>
      {onClear && (
        <button
          type="button"
          aria-label="Clear"
          onClick={e => {
            e.stopPropagation();
            onClear();
          }}
          className="absolute right-2 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-xs text-ink-3 hover:bg-hover hover:text-ink"
        >
          <X size={12} weight="bold" />
        </button>
      )}
    </span>
  );
});

export function MemberPicker({ value, onChange, trigger, includeUnassigned = true, label = 'Owner', align }: { value: string | null; onChange: (id: string | null) => void; trigger?: ReactNode; includeUnassigned?: boolean; label?: string; align?: 'start' | 'end' }) {
  const ws = useWorkspace();
  const options: Option[] = useMemo(
    () => [
      ...(includeUnassigned ? [{ value: '', label: 'Unassigned', icon: <Unassigned size="sm" /> }] : []),
      ...ws.activeMembers.map(m => ({ value: m.id, label: m.name, hint: m.id === ws.me.id ? 'You' : undefined, icon: <Avatar person={m} size="sm" />, keywords: m.email })),
    ],
    [ws.activeMembers, includeUnassigned, ws.me.id],
  );
  const member = ws.memberById(value);
  return (
    <OptionPicker
      options={options}
      value={value ?? ''}
      onSelect={v => onChange(v || null)}
      align={align}
      trigger={
        trigger ?? (
          <Chipput placeholder={!member} aria-label={label}>
            {member ? <Avatar person={member} size="xs" className="mr-1.5" /> : <UserCircle size={15} className="mr-1.5 text-ink-3" />}
            {member?.name ?? `Set ${label.toLowerCase()}`}
          </Chipput>
        )
      }
    />
  );
}

export function StagePicker({ pipelineId, value, onChange, trigger, align }: { pipelineId: string | null; value: string | null; onChange: (stageId: string) => void; trigger?: ReactNode; align?: 'start' | 'end' }) {
  const ws = useWorkspace();
  const options: Option[] = ws.stagesFor(pipelineId).filter(s => !s.archived).map(s => ({
    value: s.id,
    label: s.name,
    hint: s.kind === 'Open' ? `${s.probability}%` : s.kind,
    group: s.kind === 'Open' ? 'Open' : 'Closed',
  }));
  const stage = ws.stageById(value);
  return (
    <OptionPicker
      options={options}
      value={value}
      onSelect={onChange}
      align={align}
      trigger={trigger ?? <Chipput placeholder={!stage}>{stage?.name ?? 'Set stage'}</Chipput>}
    />
  );
}

export function PipelinePicker({ value, onChange, trigger }: { value: string | null; onChange: (id: string) => void; trigger?: ReactNode }) {
  const ws = useWorkspace();
  const options = ws.pipelines.filter(p => !p.archived).map(p => ({ value: p.id, label: p.name }));
  const pipeline = ws.pipelineById(value);
  return <OptionPicker options={options} value={value} onSelect={onChange} trigger={trigger ?? <Chipput placeholder={!pipeline}>{pipeline?.name ?? 'Pipeline'}</Chipput>} />;
}

export function ChoicePicker({ list, value, onChange, trigger, placeholder, allowEmpty = true }: { list: ChoiceList; value: string | null; onChange: (v: string | null) => void; trigger?: ReactNode; placeholder?: string; allowEmpty?: boolean }) {
  const ws = useWorkspace();
  const options: Option[] = [...(allowEmpty ? [{ value: '', label: placeholder ?? 'None' }] : []), ...ws.choicesFor(list).map(c => ({ value: c.label, label: c.label }))];
  return (
    <OptionPicker
      options={options}
      value={value ?? ''}
      onSelect={v => onChange(v || null)}
      trigger={trigger ?? <Chipput placeholder={!value}>{value ?? placeholder ?? `Set ${list.toLowerCase()}`}</Chipput>}
    />
  );
}

export function OptionsPicker({ options, value, onChange, trigger, placeholder, allowEmpty }: { options: string[]; value: string | null; onChange: (v: string | null) => void; trigger?: ReactNode; placeholder?: string; allowEmpty?: boolean }) {
  const list: Option[] = [...(allowEmpty ? [{ value: '', label: placeholder ?? 'None' }] : []), ...options.map(o => ({ value: o, label: o }))];
  return <OptionPicker options={list} value={value ?? ''} onSelect={v => onChange(v || null)} trigger={trigger ?? <Chipput placeholder={!value}>{value ?? placeholder ?? 'Choose'}</Chipput>} />;
}

export function TagPicker({ values, onChange, trigger }: { values: string[]; onChange: (ids: string[]) => void; trigger?: ReactNode }) {
  const ws = useWorkspace();
  const options: Option[] = ws.tags.map(t => ({ value: t.id, label: t.name, hint: t.description ?? undefined }));
  return (
    <OptionPicker
      multiple
      options={options}
      values={values}
      onToggle={(id, selected) => onChange(selected ? [...values, id] : values.filter(v => v !== id))}
      trigger={trigger ?? <Chipput placeholder={!values.length}>{values.length ? `${values.length} tags` : 'Add tags'}</Chipput>}
    />
  );
}

export function TagRow({ tagIds, onChange, className }: { tagIds: string[]; onChange?: (ids: string[]) => void; className?: string }) {
  const ws = useWorkspace();
  const tags = tagIds.map(id => ws.tagById(id)).filter(Boolean);
  if (!tags.length && !onChange) return null;
  return (
    <div className={cn('flex flex-wrap items-center gap-1.5', className)}>
      {tags.map(t => (
        <TagChip key={t!.id} name={t!.name} color={t!.color} onRemove={onChange ? () => onChange(tagIds.filter(id => id !== t!.id)) : undefined} />
      ))}
      {onChange && (
        <TagPicker
          values={tagIds}
          onChange={onChange}
          trigger={
            <button type="button" className="inline-flex h-6 items-center gap-1 rounded-sm px-1.5 text-meta text-ink-3 hover:bg-hover hover:text-ink">
              <Plus size={12} weight="bold" /> Tag
            </button>
          }
        />
      )}
    </div>
  );
}

export function DatePicker({ value, onChange, trigger, placeholder = 'Set date', align = 'start', clearable = true }: { value: string | null; onChange: (day: string | null) => void; trigger?: ReactNode; placeholder?: string; align?: 'start' | 'end'; clearable?: boolean }) {
  const [open, setOpen] = useState(false);
  const selected = value ? new Date(`${value}T00:00:00`) : undefined;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {trigger ?? (
          <Chipput placeholder={!value}>
            <CalendarBlank size={14} className="mr-1.5 text-ink-3" />
            {value ? shortDate(value) : placeholder}
          </Chipput>
        )}
      </PopoverTrigger>
      <PopoverContent align={align} className="w-auto p-0">
        <Calendar
          selected={selected}
          onSelect={d => {
            onChange(d ? d.toLocaleDateString('en-CA') : null);
            setOpen(false);
          }}
        />
        <div className="flex items-center justify-between border-t border-line px-2 py-1.5">
          <Button
            variant="ghost"
            size="xs"
            onClick={() => {
              onChange(new Date().toLocaleDateString('en-CA'));
              setOpen(false);
            }}
          >
            Today
          </Button>
          {clearable && value && (
            <Button
              variant="ghost"
              size="xs"
              onClick={() => {
                onChange(null);
                setOpen(false);
              }}
            >
              Clear
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Server-backed search over companies, contacts, deals or leads. */
export function RecordPicker({
  kind,
  value,
  onChange,
  trigger,
  placeholder,
  footer,
  label,
}: {
  kind: 'company' | 'contact' | 'deal' | 'lead';
  value: { id: string; name: string } | null;
  onChange: (record: { id: string; name: string; companyId?: string | null } | null) => void;
  trigger?: ReactNode;
  placeholder?: string;
  footer?: ReactNode;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const { data, isFetching } = useSearch(query, [kind], open);
  const icon = { company: <Buildings size={15} />, contact: <User size={15} />, deal: <Trophy size={15} />, lead: <User size={15} /> }[kind];
  const options: Option[] = (data?.hits ?? []).map(h => ({
    value: h.id,
    label: h.title,
    hint: h.subtitle ?? undefined,
    icon: kind === 'company' ? <CompanyMark name={h.title} id={h.id} size="xs" /> : icon,
  }));

  // Type three letters and press Enter — the whole point of a search picker, and
  // the rows were plain buttons with no highlight, so the keyboard dead-ended at
  // the input. Arrow keys move; Enter takes the highlighted hit.
  const [active, setActive] = useState(0);
  const listId = useId();
  useEffect(() => setActive(0), [query, kind]);

  const choose = (option: Option) => {
    const hit = data?.hits.find(h => h.id === option.value);
    onChange({ id: option.value, name: option.label, companyId: hit?.companyId ?? null });
    setOpen(false);
    setQuery('');
  };

  const onInputKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!options.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(i => (e.key === 'ArrowDown' ? Math.min(i + 1, options.length - 1) : Math.max(i - 1, 0)));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(options[Math.min(active, options.length - 1)]);
    }
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {trigger ?? (
          <Chipput placeholder={!value} aria-label={label ?? `Choose a ${kind}`}>
            {value?.name ?? placeholder ?? `Link a ${kind}`}
          </Chipput>
        )}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[320px] p-0">
        <div className="border-b border-line px-2.5">
          <input
            autoFocus
            role="combobox"
            aria-expanded
            aria-controls={listId}
            aria-activedescendant={options.length ? `${listId}-${active}` : undefined}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={onInputKeyDown}
            placeholder={`Search ${kind === 'company' ? 'companies' : `${kind}s`}`}
            className="h-9 w-full bg-transparent text-ui text-ink outline-none placeholder:text-ink-3"
          />
        </div>
        <div id={listId} role="listbox" className="max-h-[280px] overflow-y-auto p-1">
          {query.trim().length < 2 ? (
            <div className="px-2 py-6 text-center text-ui text-ink-3">Type to search</div>
          ) : isFetching && !options.length ? (
            <div className="px-2 py-6 text-center text-ui text-ink-3">Searching…</div>
          ) : options.length === 0 ? (
            <div className="px-2 py-6 text-center text-ui text-ink-3">Nothing matches “{query}”</div>
          ) : (
            options.map((o, i) => (
              <button
                key={o.value}
                id={`${listId}-${i}`}
                type="button"
                role="option"
                aria-selected={i === active}
                ref={i === active ? el => el?.scrollIntoView({ block: 'nearest' }) : undefined}
                onMouseMove={() => setActive(i)}
                onClick={() => choose(o)}
                className={cn('flex w-full items-center gap-2.5 rounded-sm px-2 py-1.5 text-left text-ui', i === active && 'bg-hover')}
              >
                {o.icon}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-ink">{o.label}</span>
                  {o.hint && <span className="block truncate text-meta text-ink-3">{o.hint}</span>}
                </span>
              </button>
            ))
          )}
        </div>
        {(footer || value) && (
          <div className="flex items-center gap-1 border-t border-line p-1">
            {footer}
            {value && (
              <Button
                variant="ghost"
                size="xs"
                className="ml-auto"
                onClick={() => {
                  onChange(null);
                  setOpen(false);
                }}
              >
                Clear
              </Button>
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

/** A deal's stage as a meter plus its name — the standard inline stage control. */
export function StageChip({ pipelineId, stageId, status, onChange, className }: { pipelineId: string | null; stageId: string | null; status: 'Open' | 'Won' | 'Lost'; onChange?: (stageId: string) => void; className?: string }) {
  const ws = useWorkspace();
  const stage = ws.stageById(stageId);
  const content = (
    <span className={cn('inline-flex items-center gap-2 truncate', className)}>
      <StageMeter stageId={stageId} pipelineId={pipelineId} status={status} />
      <span className="truncate">{stage?.name ?? '—'}</span>
    </span>
  );
  if (!onChange) return content;
  return <StagePicker pipelineId={pipelineId} value={stageId} onChange={onChange} trigger={<Chipput>{content}</Chipput>} />;
}

export { fullDate };
