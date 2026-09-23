import { Funnel, User } from '@phosphor-icons/react';
import { TASK_PRIORITIES, TASK_TYPES } from '@project/shared/constants';
import { Button } from '../../ui/Button';
import { Menu, MenuCheckboxItem, MenuContent, MenuLabel, MenuRadioGroup, MenuRadioItem, MenuSeparator, MenuSub, MenuSubContent, MenuSubTrigger, MenuTrigger } from '../../ui/Menu';
import type { useWorkspace } from '../../lib/workspace';
import { useWorkspace as useWorkspaceHook } from '../../lib/workspace';

/**
 * Filters for the task queue. `due` and `related` are the two that a tab
 * doesn't already answer — everything else narrows inside the tab.
 */

export type DueWindow = 'any' | 'overdue' | 'today' | 'next7' | 'next30' | 'none';
export type RelatedKind = 'any' | 'deal' | 'contact' | 'company' | 'lead' | 'none';

export type TaskFilters = {
  ownerIds?: string[];
  types?: string[];
  priorities?: string[];
  due?: DueWindow;
  related?: RelatedKind;
};

export const DUE_WINDOWS: Array<{ value: DueWindow; label: string }> = [
  { value: 'any', label: 'Any due date' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'today', label: 'Due today' },
  { value: 'next7', label: 'Next 7 days' },
  { value: 'next30', label: 'Next 30 days' },
  { value: 'none', label: 'No due date' },
];

export const RELATED_KINDS: Array<{ value: RelatedKind; label: string }> = [
  { value: 'any', label: 'Anything' },
  { value: 'deal', label: 'A deal' },
  { value: 'contact', label: 'A contact' },
  { value: 'company', label: 'A company' },
  { value: 'lead', label: 'A lead' },
  { value: 'none', label: 'Nothing linked' },
];

export function TaskFilterMenu({ filters, onChange, showDue = true }: { filters: TaskFilters; onChange: (patch: Partial<TaskFilters>) => void; showDue?: boolean }) {
  const ws = useWorkspaceHook();
  const toggle = (key: 'ownerIds' | 'types' | 'priorities', value: string) => {
    const current = filters[key] ?? [];
    const next = current.includes(value) ? current.filter(v => v !== value) : [...current, value];
    onChange({ [key]: next.length ? next : undefined });
  };
  return (
    <Menu>
      <MenuTrigger asChild>
        <Button variant="secondary" size="sm" leading={<Funnel size={15} />}>
          Filter
        </Button>
      </MenuTrigger>
      <MenuContent className="min-w-[220px]">
        <MenuSub>
          <MenuSubTrigger icon={<User size={16} />}>Owner</MenuSubTrigger>
          <MenuSubContent className="max-h-[320px] overflow-y-auto">
            <MenuCheckboxItem checked={(filters.ownerIds ?? []).includes(ws.me.id)} onCheckedChange={() => toggle('ownerIds', ws.me.id)} onSelect={e => e.preventDefault()}>
              Mine
            </MenuCheckboxItem>
            <MenuCheckboxItem checked={(filters.ownerIds ?? []).includes('none')} onCheckedChange={() => toggle('ownerIds', 'none')} onSelect={e => e.preventDefault()}>
              Unassigned
            </MenuCheckboxItem>
            <MenuSeparator />
            {ws.activeMembers.map(m => (
              <MenuCheckboxItem key={m.id} checked={(filters.ownerIds ?? []).includes(m.id)} onCheckedChange={() => toggle('ownerIds', m.id)} onSelect={e => e.preventDefault()}>
                {m.name}
              </MenuCheckboxItem>
            ))}
          </MenuSubContent>
        </MenuSub>
        <MenuSub>
          <MenuSubTrigger>Type</MenuSubTrigger>
          <MenuSubContent>
            {TASK_TYPES.map(type => (
              <MenuCheckboxItem key={type} checked={(filters.types ?? []).includes(type)} onCheckedChange={() => toggle('types', type)} onSelect={e => e.preventDefault()}>
                {type}
              </MenuCheckboxItem>
            ))}
          </MenuSubContent>
        </MenuSub>
        <MenuSub>
          <MenuSubTrigger>Priority</MenuSubTrigger>
          <MenuSubContent>
            {TASK_PRIORITIES.map(priority => (
              <MenuCheckboxItem key={priority} checked={(filters.priorities ?? []).includes(priority)} onCheckedChange={() => toggle('priorities', priority)} onSelect={e => e.preventDefault()}>
                {priority}
              </MenuCheckboxItem>
            ))}
          </MenuSubContent>
        </MenuSub>
        {showDue && (
          <>
            <MenuSeparator />
            <MenuLabel>Due</MenuLabel>
            <MenuRadioGroup value={filters.due ?? 'any'} onValueChange={value => onChange({ due: value as DueWindow })}>
              {DUE_WINDOWS.map(option => (
                <MenuRadioItem key={option.value} value={option.value}>
                  {option.label}
                </MenuRadioItem>
              ))}
            </MenuRadioGroup>
          </>
        )}
        <MenuSeparator />
        <MenuLabel>Related to</MenuLabel>
        <MenuRadioGroup value={filters.related ?? 'any'} onValueChange={value => onChange({ related: value as RelatedKind })}>
          {RELATED_KINDS.map(option => (
            <MenuRadioItem key={option.value} value={option.value}>
              {option.label}
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuContent>
    </Menu>
  );
}

export function taskFilterChips(filters: TaskFilters, onChange: (patch: Partial<TaskFilters>) => void, ws: ReturnType<typeof useWorkspace>) {
  const chips: Array<{ key: string; label: string; onRemove: () => void }> = [];
  const listChip = (key: 'ownerIds' | 'types' | 'priorities', label: string, format: (value: string) => string) => {
    const values = filters[key] ?? [];
    if (!values.length) return;
    chips.push({ key, label: values.length === 1 ? `${label}: ${format(values[0])}` : `${label}: ${values.length}`, onRemove: () => onChange({ [key]: undefined }) });
  };
  listChip('ownerIds', 'Owner', v => (v === 'none' ? 'Unassigned' : ws.memberName(v)));
  listChip('types', 'Type', v => v);
  listChip('priorities', 'Priority', v => v);
  if (filters.due && filters.due !== 'any') {
    chips.push({ key: 'due', label: DUE_WINDOWS.find(d => d.value === filters.due)?.label ?? 'Due', onRemove: () => onChange({ due: 'any' }) });
  }
  if (filters.related && filters.related !== 'any') {
    chips.push({ key: 'related', label: `Related to ${RELATED_KINDS.find(r => r.value === filters.related)?.label.toLowerCase() ?? ''}`, onRemove: () => onChange({ related: 'any' }) });
  }
  return chips;
}
