import { Buildings, Funnel, Tag as TagIcon, User } from '@phosphor-icons/react';
import { Button } from '../../ui/Button';
import { Menu, MenuCheckboxItem, MenuContent, MenuLabel, MenuSeparator, MenuSub, MenuSubContent, MenuSubTrigger, MenuTrigger } from '../../ui/Menu';
import { COMPANY_TYPES } from '@project/shared/constants';
import { useWorkspace } from '../../lib/workspace';
import { STALE_OPTIONS, type CompanyFilters } from './companyHelpers';

/**
 * Company filters as one menu plus removable chips. Every filter the endpoint
 * supports is reachable here — a filter with no control is a dead feature.
 */
export function CompanyFilterMenu({ filters, onChange }: { filters: CompanyFilters; onChange: (patch: Partial<CompanyFilters>) => void }) {
  const ws = useWorkspace();
  const toggle = <K extends keyof CompanyFilters>(key: K, value: string) => {
    const current = (filters[key] as string[] | undefined) ?? [];
    const next = current.includes(value) ? current.filter(v => v !== value) : [...current, value];
    onChange({ [key]: next.length ? next : undefined } as Partial<CompanyFilters>);
  };
  const industries = ws.choicesFor('Industry');
  return (
    <Menu>
      <MenuTrigger asChild>
        <Button variant="secondary" size="sm" leading={<Funnel size={15} />}>
          Filter
        </Button>
      </MenuTrigger>
      <MenuContent className="min-w-[220px]">
        <MenuLabel>Type</MenuLabel>
        {COMPANY_TYPES.map(type => (
          <MenuCheckboxItem key={type} checked={(filters.types ?? []).includes(type)} onCheckedChange={() => toggle('types', type)} onSelect={e => e.preventDefault()}>
            {type}
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
        {industries.length > 0 && (
          <MenuSub>
            <MenuSubTrigger icon={<Buildings size={16} />}>Industry</MenuSubTrigger>
            <MenuSubContent className="max-h-[320px] overflow-y-auto">
              {industries.map(choice => (
                <MenuCheckboxItem key={choice.id} checked={(filters.industries ?? []).includes(choice.label)} onCheckedChange={() => toggle('industries', choice.label)} onSelect={e => e.preventDefault()}>
                  {choice.label}
                </MenuCheckboxItem>
              ))}
            </MenuSubContent>
          </MenuSub>
        )}
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
        <MenuLabel>Where things stand</MenuLabel>
        <MenuCheckboxItem checked={filters.hasOpenDeals === true} onCheckedChange={v => onChange({ hasOpenDeals: v ? true : undefined })} onSelect={e => e.preventDefault()}>
          Has an open deal
        </MenuCheckboxItem>
        <MenuCheckboxItem checked={filters.hasOpenDeals === false} onCheckedChange={v => onChange({ hasOpenDeals: v ? false : undefined })} onSelect={e => e.preventDefault()}>
          No open deals
        </MenuCheckboxItem>
        <MenuSub>
          <MenuSubTrigger>Nothing logged in…</MenuSubTrigger>
          <MenuSubContent>
            {STALE_OPTIONS.map(days => (
              <MenuCheckboxItem key={days} checked={filters.staleDays === days} onCheckedChange={v => onChange({ staleDays: v ? days : undefined })} onSelect={e => e.preventDefault()}>
                {days} days
              </MenuCheckboxItem>
            ))}
          </MenuSubContent>
        </MenuSub>
        <MenuSeparator />
        <MenuCheckboxItem checked={Boolean(filters.archived)} onCheckedChange={v => onChange({ archived: v || undefined })} onSelect={e => e.preventDefault()}>
          Show archived
        </MenuCheckboxItem>
      </MenuContent>
    </Menu>
  );
}

/** Chips describing the active filters, each removable. */
export function companyFilterChips(filters: CompanyFilters, onChange: (patch: Partial<CompanyFilters>) => void, ws: ReturnType<typeof useWorkspace>) {
  const chips: Array<{ key: string; label: string; onRemove: () => void }> = [];
  const listChip = <K extends keyof CompanyFilters>(key: K, label: string, format: (value: string) => string) => {
    const values = (filters[key] as string[] | undefined) ?? [];
    if (!values.length) return;
    chips.push({
      key: String(key),
      label: values.length === 1 ? `${label}: ${format(values[0])}` : `${label}: ${values.length}`,
      onRemove: () => onChange({ [key]: undefined } as Partial<CompanyFilters>),
    });
  };
  listChip('types', 'Type', v => v);
  listChip('ownerIds', 'Owner', v => (v === 'none' ? 'Unassigned' : ws.memberName(v)));
  listChip('industries', 'Industry', v => v);
  listChip('sources', 'Source', v => v);
  listChip('tagIds', 'Tag', v => ws.tagById(v)?.name ?? 'Tag');
  if (filters.hasOpenDeals === true) chips.push({ key: 'hasOpenDeals', label: 'Has an open deal', onRemove: () => onChange({ hasOpenDeals: undefined }) });
  if (filters.hasOpenDeals === false) chips.push({ key: 'hasOpenDeals', label: 'No open deals', onRemove: () => onChange({ hasOpenDeals: undefined }) });
  if (filters.staleDays) chips.push({ key: 'staleDays', label: `Quiet ${filters.staleDays} days`, onRemove: () => onChange({ staleDays: undefined }) });
  if (filters.parentCompanyId) chips.push({ key: 'parentCompanyId', label: 'Subsidiaries only', onRemove: () => onChange({ parentCompanyId: undefined }) });
  if (filters.archived) chips.push({ key: 'archived', label: 'Archived', onRemove: () => onChange({ archived: undefined }) });
  return chips;
}
