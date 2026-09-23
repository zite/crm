import { Funnel, Kanban, Tag as TagIcon, User } from '@phosphor-icons/react';
import type { ListDealsInputType } from 'zitejs/api';
import { Button } from '../../ui/Button';
import { Avatar, Unassigned } from '../../ui/Avatar';
import { Menu, MenuCheckboxItem, MenuContent, MenuLabel, MenuSeparator, MenuSub, MenuSubContent, MenuSubTrigger, MenuTrigger } from '../../ui/Menu';
import { DEAL_TYPES, FORECAST_CATEGORIES } from '@project/shared/constants';
import { useWorkspace } from '../../lib/workspace';
import { shortDate } from '../../lib/format';

export type DealFilters = NonNullable<ListDealsInputType['filters']>;

/**
 * Deal filters as one menu plus removable chips. Every filter the endpoint
 * supports is reachable here — a filter with no control is a dead feature.
 */
export function DealFilterMenu({ filters, onChange }: { filters: DealFilters; onChange: (patch: Partial<DealFilters>) => void }) {
  const ws = useWorkspace();
  const toggle = <K extends keyof DealFilters>(key: K, value: string) => {
    const current = (filters[key] as string[] | undefined) ?? [];
    const next = current.includes(value) ? current.filter(v => v !== value) : [...current, value];
    onChange({ [key]: next.length ? next : undefined } as Partial<DealFilters>);
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
        {(['Open', 'Won', 'Lost'] as const).map(status => (
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
          <MenuSubTrigger icon={<Kanban size={16} />}>Stage</MenuSubTrigger>
          <MenuSubContent className="max-h-[320px] overflow-y-auto">
            {ws.stagesFor(filters.pipelineId ?? ws.defaultPipeline?.id ?? null).map(stage => (
              <MenuCheckboxItem key={stage.id} checked={(filters.stageIds ?? []).includes(stage.id)} onCheckedChange={() => toggle('stageIds', stage.id)} onSelect={e => e.preventDefault()}>
                {stage.name}
              </MenuCheckboxItem>
            ))}
          </MenuSubContent>
        </MenuSub>
        <MenuSub>
          <MenuSubTrigger>Forecast category</MenuSubTrigger>
          <MenuSubContent>
            {FORECAST_CATEGORIES.map(category => (
              <MenuCheckboxItem key={category} checked={(filters.forecastCategories ?? []).includes(category)} onCheckedChange={() => toggle('forecastCategories', category)} onSelect={e => e.preventDefault()}>
                {category}
              </MenuCheckboxItem>
            ))}
          </MenuSubContent>
        </MenuSub>
        <MenuSub>
          <MenuSubTrigger>Type</MenuSubTrigger>
          <MenuSubContent>
            {DEAL_TYPES.map(type => (
              <MenuCheckboxItem key={type} checked={(filters.types ?? []).includes(type)} onCheckedChange={() => toggle('types', type)} onSelect={e => e.preventDefault()}>
                {type}
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
          <MenuSubTrigger>Lost reason</MenuSubTrigger>
          <MenuSubContent className="max-h-[320px] overflow-y-auto">
            {ws.choicesFor('Lost Reason').map(choice => (
              <MenuCheckboxItem key={choice.id} checked={(filters.lostReasons ?? []).includes(choice.label)} onCheckedChange={() => toggle('lostReasons', choice.label)} onSelect={e => e.preventDefault()}>
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
        <MenuLabel>Needs attention</MenuLabel>
        <MenuCheckboxItem checked={Boolean(filters.stalled)} onCheckedChange={v => onChange({ stalled: v || undefined })} onSelect={e => e.preventDefault()}>
          Stalled in stage
        </MenuCheckboxItem>
        <MenuCheckboxItem checked={Boolean(filters.noNextStep)} onCheckedChange={v => onChange({ noNextStep: v || undefined })} onSelect={e => e.preventDefault()}>
          No next step
        </MenuCheckboxItem>
        <MenuCheckboxItem checked={Boolean(filters.closingOverdue)} onCheckedChange={v => onChange({ closingOverdue: v || undefined })} onSelect={e => e.preventDefault()}>
          Close date passed
        </MenuCheckboxItem>
        <MenuSeparator />
        <MenuCheckboxItem checked={Boolean(filters.archived)} onCheckedChange={v => onChange({ archived: v || undefined })} onSelect={e => e.preventDefault()}>
          Show archived
        </MenuCheckboxItem>
      </MenuContent>
    </Menu>
  );
}

/** Chips describing the active filters, each removable. */
export function dealFilterChips(filters: DealFilters, onChange: (patch: Partial<DealFilters>) => void, ws: ReturnType<typeof useWorkspace>) {
  const chips: Array<{ key: string; label: string; onRemove: () => void }> = [];
  const listChip = <K extends keyof DealFilters>(key: K, label: string, format: (value: string) => string) => {
    const values = (filters[key] as string[] | undefined) ?? [];
    if (!values.length) return;
    chips.push({
      key: String(key),
      label: values.length === 1 ? `${label}: ${format(values[0])}` : `${label}: ${values.length}`,
      onRemove: () => onChange({ [key]: undefined } as Partial<DealFilters>),
    });
  };
  listChip('status', 'Status', v => v);
  listChip('ownerIds', 'Owner', v => (v === 'none' ? 'Unassigned' : ws.memberName(v)));
  listChip('stageIds', 'Stage', v => ws.stageById(v)?.name ?? 'Stage');
  listChip('forecastCategories', 'Forecast', v => v);
  listChip('types', 'Type', v => v);
  listChip('sources', 'Source', v => v);
  listChip('lostReasons', 'Lost reason', v => v);
  listChip('tagIds', 'Tag', v => ws.tagById(v)?.name ?? 'Tag');
  const window = (fromKey: 'closeFrom' | 'closedFrom', toKey: 'closeTo' | 'closedTo', label: string) => {
    const from = filters[fromKey];
    const to = filters[toKey];
    if (!from && !to) return;
    chips.push({
      key: fromKey,
      label: `${label} ${from ? shortDate(from) : 'any'} – ${to ? shortDate(to) : 'any'}`,
      onRemove: () => onChange({ [fromKey]: undefined, [toKey]: undefined } as Partial<DealFilters>),
    });
  };
  window('closeFrom', 'closeTo', 'Closing');
  window('closedFrom', 'closedTo', 'Closed');
  if (filters.stalled) chips.push({ key: 'stalled', label: 'Stalled', onRemove: () => onChange({ stalled: undefined }) });
  if (filters.noNextStep) chips.push({ key: 'noNextStep', label: 'No next step', onRemove: () => onChange({ noNextStep: undefined }) });
  if (filters.closingOverdue) chips.push({ key: 'closingOverdue', label: 'Close date passed', onRemove: () => onChange({ closingOverdue: undefined }) });
  if (filters.archived) chips.push({ key: 'archived', label: 'Archived', onRemove: () => onChange({ archived: undefined }) });
  return chips;
}
