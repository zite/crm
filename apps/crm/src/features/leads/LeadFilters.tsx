import { Funnel, Tag as TagIcon, User } from '@phosphor-icons/react';
import { Button } from '../../ui/Button';
import { Menu, MenuCheckboxItem, MenuContent, MenuLabel, MenuRadioGroup, MenuRadioItem, MenuSeparator, MenuSub, MenuSubContent, MenuSubTrigger, MenuTrigger } from '../../ui/Menu';
import { LEAD_STATUSES } from '@project/shared/constants';
import { useWorkspace } from '../../lib/workspace';
import { shortDate } from '../../lib/format';
import type { LeadFilters } from './leadData';

/** The received-window presets, as days back from today. */
const WINDOWS: Array<{ value: string; label: string; days: number | null }> = [
  { value: 'any', label: 'Any time', days: null },
  { value: '1', label: 'Today', days: 0 },
  { value: '7', label: 'Last 7 days', days: 6 },
  { value: '30', label: 'Last 30 days', days: 29 },
  { value: '90', label: 'Last 90 days', days: 89 },
];

const dayBack = (today: string, days: number) => {
  const d = new Date(`${today}T00:00:00`);
  d.setDate(d.getDate() - days);
  return d.toLocaleDateString('en-CA');
};

export function windowValue(filters: LeadFilters, today: string) {
  if (!filters.receivedFrom) return 'any';
  const match = WINDOWS.find(w => w.days != null && dayBack(today, w.days) === filters.receivedFrom);
  return match?.value ?? 'custom';
}

/**
 * Lead filters as one menu plus removable chips. Every filter the endpoint
 * supports is reachable here — a filter with no control is a dead feature.
 */
export function LeadFilterMenu({ filters, onChange }: { filters: LeadFilters; onChange: (patch: Partial<LeadFilters>) => void }) {
  const ws = useWorkspace();
  const toggle = <K extends keyof LeadFilters>(key: K, value: string) => {
    const current = (filters[key] as string[] | undefined) ?? [];
    const next = current.includes(value) ? current.filter(v => v !== value) : [...current, value];
    onChange({ [key]: next.length ? next : undefined } as Partial<LeadFilters>);
  };
  return (
    <Menu>
      <MenuTrigger asChild>
        <Button variant="secondary" size="sm" leading={<Funnel size={15} />}>
          Filter
        </Button>
      </MenuTrigger>
      <MenuContent className="min-w-[220px]">
        <MenuLabel>Status</MenuLabel>
        {LEAD_STATUSES.map(status => (
          <MenuCheckboxItem key={status} checked={(filters.status ?? []).includes(status)} onCheckedChange={() => toggle('status', status)} onSelect={e => e.preventDefault()}>
            {status}
          </MenuCheckboxItem>
        ))}
        <MenuSeparator />
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
          <MenuSubTrigger>Source</MenuSubTrigger>
          <MenuSubContent className="max-h-[320px] overflow-y-auto">
            {ws.choicesFor('Lead Source').map(choice => (
              <MenuCheckboxItem key={choice.id} checked={(filters.sources ?? []).includes(choice.label)} onCheckedChange={() => toggle('sources', choice.label)} onSelect={e => e.preventDefault()}>
                {choice.label}
              </MenuCheckboxItem>
            ))}
          </MenuSubContent>
        </MenuSub>
        <MenuSub>
          <MenuSubTrigger>Rating</MenuSubTrigger>
          <MenuSubContent>
            {(['Hot', 'Warm', 'Cold'] as const).map(rating => (
              <MenuCheckboxItem key={rating} checked={(filters.ratings ?? []).includes(rating)} onCheckedChange={() => toggle('ratings', rating)} onSelect={e => e.preventDefault()}>
                {rating}
              </MenuCheckboxItem>
            ))}
          </MenuSubContent>
        </MenuSub>
        <MenuSub>
          <MenuSubTrigger>Disqualify reason</MenuSubTrigger>
          <MenuSubContent className="max-h-[320px] overflow-y-auto">
            {ws.choicesFor('Disqualify Reason').map(choice => (
              <MenuCheckboxItem key={choice.id} checked={(filters.disqualifyReasons ?? []).includes(choice.label)} onCheckedChange={() => toggle('disqualifyReasons', choice.label)} onSelect={e => e.preventDefault()}>
                {choice.label}
              </MenuCheckboxItem>
            ))}
          </MenuSubContent>
        </MenuSub>
        {ws.tags.length > 0 && (
          <MenuSub>
            <MenuSubTrigger icon={<TagIcon size={16} />}>Tags</MenuSubTrigger>
            <MenuSubContent className="max-h-[320px] overflow-y-auto">
              {ws.tags.map(tag => (
                <MenuCheckboxItem key={tag.id} checked={(filters.tagIds ?? []).includes(tag.id)} onCheckedChange={() => toggle('tagIds', tag.id)} onSelect={e => e.preventDefault()}>
                  {tag.name}
                </MenuCheckboxItem>
              ))}
            </MenuSubContent>
          </MenuSub>
        )}
        <MenuSeparator />
        <MenuLabel>Came in</MenuLabel>
        <MenuRadioGroup
          value={windowValue(filters, ws.today)}
          onValueChange={value => {
            const window = WINDOWS.find(w => w.value === value);
            onChange({ receivedFrom: window?.days == null ? undefined : dayBack(ws.today, window.days), receivedTo: undefined });
          }}
        >
          {WINDOWS.map(w => (
            <MenuRadioItem key={w.value} value={w.value}>
              {w.label}
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
        <MenuSeparator />
        <MenuLabel>Needs attention</MenuLabel>
        <MenuCheckboxItem checked={Boolean(filters.noResponse)} onCheckedChange={v => onChange({ noResponse: v || undefined })} onSelect={e => e.preventDefault()}>
          No response yet
        </MenuCheckboxItem>
        <MenuCheckboxItem checked={Boolean(filters.hasPhone)} onCheckedChange={v => onChange({ hasPhone: v || undefined })} onSelect={e => e.preventDefault()}>
          Has a phone number
        </MenuCheckboxItem>
        <MenuCheckboxItem checked={filters.converted === true} onCheckedChange={v => onChange({ converted: v ? true : undefined })} onSelect={e => e.preventDefault()}>
          Converted
        </MenuCheckboxItem>
      </MenuContent>
    </Menu>
  );
}

/** Chips describing the active filters, each removable. */
export function leadFilterChips(filters: LeadFilters, onChange: (patch: Partial<LeadFilters>) => void, ws: ReturnType<typeof useWorkspace>, formName?: string | null) {
  const chips: Array<{ key: string; label: string; onRemove: () => void }> = [];
  const listChip = <K extends keyof LeadFilters>(key: K, label: string, format: (value: string) => string) => {
    const values = (filters[key] as string[] | undefined) ?? [];
    if (!values.length) return;
    // "Status: 3" tells you nothing. Name the first, count the rest.
    chips.push({
      key: String(key),
      label: values.length === 1 ? `${label}: ${format(values[0])}` : `${label}: ${format(values[0])} +${values.length - 1}`,
      onRemove: () => onChange({ [key]: undefined } as Partial<LeadFilters>),
    });
  };
  listChip('status', 'Status', v => v);
  listChip('ownerIds', 'Owner', v => (v === 'none' ? 'Unassigned' : ws.memberName(v)));
  listChip('sources', 'Source', v => v);
  listChip('ratings', 'Rating', v => v);
  listChip('disqualifyReasons', 'Reason', v => v);
  listChip('tagIds', 'Tag', v => ws.tagById(v)?.name ?? 'Tag');
  if (filters.formId) chips.push({ key: 'formId', label: `Form: ${formName ?? 'one form'}`, onRemove: () => onChange({ formId: undefined }) });
  if (filters.receivedFrom) {
    const preset = WINDOWS.find(w => w.value === windowValue(filters, ws.today));
    chips.push({ key: 'received', label: preset && preset.value !== 'custom' ? `Came in: ${preset.label.toLowerCase()}` : `Came in after ${shortDate(filters.receivedFrom)}`, onRemove: () => onChange({ receivedFrom: undefined, receivedTo: undefined }) });
  }
  if (filters.noResponse) chips.push({ key: 'noResponse', label: 'No response yet', onRemove: () => onChange({ noResponse: undefined }) });
  if (filters.hasPhone) chips.push({ key: 'hasPhone', label: 'Has a phone number', onRemove: () => onChange({ hasPhone: undefined }) });
  if (filters.converted) chips.push({ key: 'converted', label: 'Converted', onRemove: () => onChange({ converted: undefined }) });
  return chips;
}
