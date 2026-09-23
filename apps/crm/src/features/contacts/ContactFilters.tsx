import { Funnel, Tag as TagIcon, User } from '@phosphor-icons/react';
import { Button } from '../../ui/Button';
import { Menu, MenuCheckboxItem, MenuContent, MenuLabel, MenuSeparator, MenuSub, MenuSubContent, MenuSubTrigger, MenuTrigger } from '../../ui/Menu';
import { useWorkspace } from '../../lib/workspace';
import { STALE_OPTIONS, type ContactFilters } from './contactHelpers';

/**
 * Contact filters as one menu plus removable chips. Everything the endpoint
 * supports is reachable here, including the two that keep a team out of
 * trouble: do not contact and unsubscribed.
 */
export function ContactFilterMenu({ filters, onChange }: { filters: ContactFilters; onChange: (patch: Partial<ContactFilters>) => void }) {
  const ws = useWorkspace();
  const toggle = <K extends keyof ContactFilters>(key: K, value: string) => {
    const current = (filters[key] as string[] | undefined) ?? [];
    const next = current.includes(value) ? current.filter(v => v !== value) : [...current, value];
    onChange({ [key]: next.length ? next : undefined } as Partial<ContactFilters>);
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
        <MenuLabel>Who they are</MenuLabel>
        <MenuCheckboxItem checked={Boolean(filters.noCompany)} onCheckedChange={v => onChange({ noCompany: v || undefined })} onSelect={e => e.preventDefault()}>
          Has no company
        </MenuCheckboxItem>
        <MenuCheckboxItem checked={filters.hasEmail === false} onCheckedChange={v => onChange({ hasEmail: v ? false : undefined })} onSelect={e => e.preventDefault()}>
          Has no email
        </MenuCheckboxItem>
        <MenuCheckboxItem checked={filters.hasOpenDeals === true} onCheckedChange={v => onChange({ hasOpenDeals: v ? true : undefined })} onSelect={e => e.preventDefault()}>
          On an open deal
        </MenuCheckboxItem>
        <MenuSeparator />
        <MenuLabel>Can we email them</MenuLabel>
        <MenuCheckboxItem checked={filters.doNotContact === true} onCheckedChange={v => onChange({ doNotContact: v ? true : undefined })} onSelect={e => e.preventDefault()}>
          Do not contact
        </MenuCheckboxItem>
        <MenuCheckboxItem checked={filters.unsubscribed === true} onCheckedChange={v => onChange({ unsubscribed: v ? true : undefined })} onSelect={e => e.preventDefault()}>
          Unsubscribed
        </MenuCheckboxItem>
        <MenuSeparator />
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

export function contactFilterChips(filters: ContactFilters, onChange: (patch: Partial<ContactFilters>) => void, ws: ReturnType<typeof useWorkspace>) {
  const chips: Array<{ key: string; label: string; onRemove: () => void }> = [];
  const listChip = <K extends keyof ContactFilters>(key: K, label: string, format: (value: string) => string) => {
    const values = (filters[key] as string[] | undefined) ?? [];
    if (!values.length) return;
    chips.push({
      key: String(key),
      label: values.length === 1 ? `${label}: ${format(values[0])}` : `${label}: ${values.length}`,
      onRemove: () => onChange({ [key]: undefined } as Partial<ContactFilters>),
    });
  };
  listChip('ownerIds', 'Owner', v => (v === 'none' ? 'Unassigned' : ws.memberName(v)));
  listChip('sources', 'Source', v => v);
  listChip('tagIds', 'Tag', v => ws.tagById(v)?.name ?? 'Tag');
  if (filters.noCompany) chips.push({ key: 'noCompany', label: 'No company', onRemove: () => onChange({ noCompany: undefined }) });
  if (filters.hasEmail === false) chips.push({ key: 'hasEmail', label: 'No email', onRemove: () => onChange({ hasEmail: undefined }) });
  if (filters.hasOpenDeals === true) chips.push({ key: 'hasOpenDeals', label: 'On an open deal', onRemove: () => onChange({ hasOpenDeals: undefined }) });
  if (filters.doNotContact === true) chips.push({ key: 'doNotContact', label: 'Do not contact', onRemove: () => onChange({ doNotContact: undefined }) });
  if (filters.unsubscribed === true) chips.push({ key: 'unsubscribed', label: 'Unsubscribed', onRemove: () => onChange({ unsubscribed: undefined }) });
  if (filters.staleDays) chips.push({ key: 'staleDays', label: `Quiet ${filters.staleDays} days`, onRemove: () => onChange({ staleDays: undefined }) });
  if (filters.companyId) chips.push({ key: 'companyId', label: 'One company', onRemove: () => onChange({ companyId: undefined }) });
  if (filters.archived) chips.push({ key: 'archived', label: 'Archived', onRemove: () => onChange({ archived: undefined }) });
  return chips;
}
