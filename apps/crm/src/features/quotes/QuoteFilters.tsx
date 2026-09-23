import { Buildings, Funnel, User } from '@phosphor-icons/react';
import { Button } from '../../ui/Button';
import { Menu, MenuCheckboxItem, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuSub, MenuSubContent, MenuSubTrigger, MenuTrigger } from '../../ui/Menu';
import { RecordPicker } from '../../pickers/pickers';
import { useWorkspace } from '../../lib/workspace';
import { QUOTE_STATUSES } from '@project/shared/constants';

/** What the ledger filters on. `expiringSoon` maps to the endpoint's seven-day window. */
export type QuoteUiFilters = {
  status?: string[];
  ownerIds?: string[];
  companyId?: string;
  companyName?: string;
  expiringSoon?: boolean;
};

export function QuoteFilterMenu({ filters, onChange }: { filters: QuoteUiFilters; onChange: (patch: Partial<QuoteUiFilters>) => void }) {
  const ws = useWorkspace();
  const toggle = (key: 'status' | 'ownerIds', value: string) => {
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
        <MenuLabel>Status</MenuLabel>
        {QUOTE_STATUSES.map(status => (
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
        <RecordPicker
          kind="company"
          value={filters.companyId ? { id: filters.companyId, name: filters.companyName ?? 'Company' } : null}
          onChange={record => onChange({ companyId: record?.id, companyName: record?.name })}
          trigger={
            <MenuItem icon={<Buildings size={16} />} onSelect={e => e.preventDefault()}>
              {filters.companyName ? `Company: ${filters.companyName}` : 'Company…'}
            </MenuItem>
          }
        />
        <MenuSeparator />
        <MenuLabel>Needs attention</MenuLabel>
        <MenuCheckboxItem checked={Boolean(filters.expiringSoon)} onCheckedChange={v => onChange({ expiringSoon: v || undefined })} onSelect={e => e.preventDefault()}>
          Expiring in 7 days
        </MenuCheckboxItem>
      </MenuContent>
    </Menu>
  );
}

export function quoteFilterChips(filters: QuoteUiFilters, onChange: (patch: Partial<QuoteUiFilters>) => void, ws: ReturnType<typeof useWorkspace>) {
  const chips: Array<{ key: string; label: string; onRemove: () => void }> = [];
  if (filters.status?.length) {
    chips.push({
      key: 'status',
      label: filters.status.length === 1 ? `Status: ${filters.status[0]}` : `Status: ${filters.status.length}`,
      onRemove: () => onChange({ status: undefined }),
    });
  }
  if (filters.ownerIds?.length) {
    chips.push({
      key: 'ownerIds',
      label: filters.ownerIds.length === 1 ? `Owner: ${filters.ownerIds[0] === 'none' ? 'Unassigned' : ws.memberName(filters.ownerIds[0])}` : `Owner: ${filters.ownerIds.length}`,
      onRemove: () => onChange({ ownerIds: undefined }),
    });
  }
  if (filters.companyId) chips.push({ key: 'companyId', label: `Company: ${filters.companyName ?? 'chosen'}`, onRemove: () => onChange({ companyId: undefined, companyName: undefined }) });
  if (filters.expiringSoon) chips.push({ key: 'expiringSoon', label: 'Expiring in 7 days', onRemove: () => onChange({ expiringSoon: undefined }) });
  return chips;
}
