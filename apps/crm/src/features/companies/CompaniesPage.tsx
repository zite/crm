import { Archive, ArrowsClockwise, Buildings, CopySimple, DotsThree, DownloadSimple, FloppyDisk, Plus, Tag as TagIcon, Trash, UserPlus } from '@phosphor-icons/react';
import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Avatar, Unassigned } from '../../ui/Avatar';
import { Badge } from '../../ui/Chip';
import { Button } from '../../ui/Button';
import { EmptyState, ListSkeleton, PageHeader, StatStrip } from '../../ui/Layout';
import { Menu, MenuContent, MenuItem, MenuLabel, MenuRadioGroup, MenuRadioItem, MenuSeparator, MenuTrigger } from '../../ui/Menu';
import { CompanyMark, Money } from '../../glyphs';
import { MemberPicker, OptionsPicker, TagPicker } from '../../pickers/pickers';
import { BulkBar, BulkButton } from '../../records/BulkBar';
import { Ledger, type Column } from '../../records/Ledger';
import { SaveViewDialog } from '../../records/SaveViewDialog';
import { FilterChips, ListToolbar } from '../../records/Toolbar';
import { useListNav } from '../../records/useListNav';
import { useListState } from '../../records/useListState';
import { COMPANY_TYPES } from '@project/shared/constants';
import { useAppActions } from '../../lib/app-actions';
import { downloadCsv } from '../../lib/csv';
import { timeAgo } from '../../lib/format';
import { useDocumentTitle } from '../../lib/useDocumentTitle';
import { useWorkspace } from '../../lib/workspace';
import { CompanyFilterMenu, companyFilterChips } from './CompanyFilters';
import DeleteCompanyDialog from './DeleteCompanyDialog';
import { DuplicatesDialog } from './Duplicates';
import { COMPANY_GROUP_OPTIONS, COMPANY_SORTS, COMPANY_TYPE_TONE, companyTotals, groupCompanies, type Company, type CompanyFilters, type CompanySort } from './companyHelpers';
import { useCompanyActions } from './mutations';
import { useCompanies } from './queries';

/** Companies: the book of business as a ledger you can sort, group and act on. */
export function CompaniesPage() {
  const ws = useWorkspace();
  const navigate = useNavigate();
  const actions = useAppActions();
  const companyActions = useCompanyActions();
  const [params, setParams] = useSearchParams();
  const [saveOpen, setSaveOpen] = useState(false);
  const [dupesOpen, setDupesOpen] = useState(false);
  const [deleting, setDeleting] = useState<Company[] | null>(null);
  useDocumentTitle('Companies', ws.settings.organizationName);

  const viewId = params.get('view');
  const savedView = viewId ? ws.views.find(v => v.id === viewId) ?? null : null;

  const list = useListState<CompanyFilters, CompanySort['key']>('companies', {
    layout: 'list',
    sort: { key: 'openValue', dir: 'desc' },
    groupBy: 'none',
    columns: null,
    filters: {},
    search: '',
  });

  const query = useCompanies({
    filters: { ...list.state.filters, search: list.state.search || undefined },
    sort: list.state.sort,
    limit: 1000,
  });
  const companies = query.data?.companies ?? [];
  const totals = useMemo(() => companyTotals(companies), [companies]);

  const nav = useListNav({
    items: companies,
    getId: c => c.id,
    onOpen: company => navigate(`/companies/${company.id}`),
    onPeek: company => actions.openPeek({ type: 'company', id: company.id }),
    enabled: !actions.paletteOpen && !deleting && !dupesOpen && !saveOpen,
    // With a peek open, J/K walk the list behind it and bring the sheet along.
    followFocus: actions.peek?.type === 'company',
  });

  const chips = companyFilterChips(list.state.filters, list.setFilters, ws);
  const grouped = groupCompanies(companies, list.state.groupBy, ws);
  const canEdit = ws.can('records.edit');

  const columns: Array<Column<Company>> = [
    {
      key: 'name',
      header: 'Company',
      sort: 'name',
      width: '24%',
      cell: company => (
        <div className="flex items-center gap-2.5">
          <CompanyMark name={company.name} id={company.id} logoUrl={company.logoUrl} size="sm" />
          <div className="min-w-0">
            <div className="truncate font-medium text-ink">{company.name}</div>
            <div className="truncate text-meta text-ink-3">{company.domain ?? company.city ?? 'No domain'}</div>
          </div>
          {company.archived && <Badge tone="warning">Archived</Badge>}
        </div>
      ),
    },
    {
      key: 'type',
      header: 'Type',
      sort: 'type',
      // A badge can't be ellipsised into a readable word, so the column carries a width
      // that fits "Prospect" and steps out below lg rather than reading "Prospe…".
      width: '11%',
      hide: 'lg',
      cell: company => (company.type ? <Badge tone={COMPANY_TYPE_TONE[company.type] ?? 'neutral'}>{company.type}</Badge> : <span className="text-ink-3">—</span>),
    },
    { key: 'industry', header: 'Industry', sort: 'industry', width: '11%', hide: 'lg', cell: company => <span className="truncate text-ink-2">{company.industry ?? '—'}</span> },
    {
      key: 'owner',
      header: 'Owner',
      sort: 'owner',
      width: '11%',
      interactive: true,
      cell: company => {
        const owner = ws.memberById(company.ownerId);
        const trigger = (
          <span className="flex items-center gap-1.5 rounded-sm px-1 py-1">
            {owner ? <Avatar person={owner} size="xs" /> : <Unassigned size="xs" />}
            <span className="truncate text-ui">{owner?.name.split(' ')[0] ?? 'Unassigned'}</span>
          </span>
        );
        if (!canEdit) return trigger;
        return <MemberPicker value={company.ownerId} onChange={ownerId => companyActions.setOwner([company.id], ownerId)} trigger={<button className="flex items-center hover:bg-hover">{trigger}</button>} />;
      },
    },
    { key: 'employees', header: 'Employees', sort: 'employees', align: 'right', width: '8%', hide: 'xl', cell: company => <span className="tabular text-ink-2">{company.employees ? company.employees.toLocaleString('en-US') : '—'}</span> },
    { key: 'contacts', header: 'People', sort: 'contacts', align: 'right', width: '8%', hide: 'lg', cell: company => <span className={company.contactCount ? 'tabular text-ink' : 'tabular text-ink-3'}>{company.contactCount}</span> },
    { key: 'openDeals', header: 'Open', sort: 'openDeals', align: 'right', width: '7%', cell: company => <span className={company.openDealCount ? 'tabular text-ink' : 'tabular text-ink-3'}>{company.openDealCount}</span> },
    { key: 'openValue', header: 'Pipeline', sort: 'openValue', align: 'right', width: '11%', cell: company => <Money value={company.openDealValue} muted0 /> },
    { key: 'lastActivityAt', header: 'Last activity', sort: 'lastActivityAt', width: '10%', hide: 'md', cell: company => <span className="text-ink-3">{company.lastActivityAt ? timeAgo(company.lastActivityAt) : 'Never'}</span> },
  ];

  const exportCsv = () => {
    downloadCsv(
      'companies',
      ['Company', 'Domain', 'Type', 'Industry', 'Owner', 'Employees', 'Annual revenue', 'Contacts', 'Open deals', 'Open pipeline', 'Won revenue', 'City', 'Country', 'Source', 'Customer since', 'Last activity'],
      companies.map(c => [
        c.name,
        c.domain ?? '',
        c.type ?? '',
        c.industry ?? '',
        ws.memberName(c.ownerId),
        c.employees ?? '',
        c.annualRevenue ?? '',
        c.contactCount,
        c.openDealCount,
        c.openDealValue,
        c.wonValue,
        c.city ?? '',
        c.country ?? '',
        c.source ?? '',
        c.customerSince ?? '',
        c.lastActivityAt ?? '',
      ]),
    );
  };

  const selected = () => companies.filter(c => nav.selected.has(c.id));

  return (
    <div className="flex min-h-full flex-col">
      <PageHeader
        eyebrow={savedView ? <button className="hover:text-ink" onClick={() => setParams({})}>Companies</button> : undefined}
        title={savedView?.name ?? 'Companies'}
        description={savedView ? 'A saved view of the book of business.' : 'Everyone you sell to, and what is open with each of them.'}
        actions={
          <>
            {ws.viewsFor('Companies').length > 0 && (
              <Menu>
                <MenuTrigger asChild>
                  <Button variant="secondary" size="sm">
                    Views
                  </Button>
                </MenuTrigger>
                <MenuContent align="end">
                  <MenuLabel>Saved views</MenuLabel>
                  {ws.viewsFor('Companies').map(view => (
                    <MenuItem
                      key={view.id}
                      onSelect={() => {
                        list.applyConfig(view.config as never);
                        setParams({ view: view.id });
                      }}
                    >
                      {view.name}
                    </MenuItem>
                  ))}
                  <MenuSeparator />
                  <MenuItem onSelect={() => setSaveOpen(true)}>Save current as view…</MenuItem>
                </MenuContent>
              </Menu>
            )}
            {canEdit && (
              <Button variant="primary" size="sm" leading={<Plus size={16} weight="bold" />} onClick={() => actions.openCreate('company')}>
                New company
              </Button>
            )}
          </>
        }
      />

      <div className="px-5 pb-1 pt-5 sm:px-8">
        <StatStrip
          items={[
            { label: 'Companies', value: totals.count.toLocaleString('en-US'), hint: `${totals.contacts.toLocaleString('en-US')} people` },
            { label: 'Open pipeline', value: <Money value={totals.openValue} compact />, hint: 'Across every open deal' },
            { label: 'Won revenue', value: <Money value={totals.wonValue} compact />, hint: 'Closed won, all time' },
            { label: 'Customers', value: totals.customers, hint: 'Type is Customer', onClick: () => list.setFilters({ types: ['Customer'] }) },
            { label: 'No open deal', value: totals.noOpenDeals, hint: 'Nothing in flight', onClick: () => list.setFilters({ hasOpenDeals: false }) },
          ]}
        />
      </div>

      <ListToolbar
        className="mt-5"
        start={
          <>
            <CompanyFilterMenu filters={list.state.filters} onChange={patch => list.setFilters(patch)} />
            <Menu>
              <MenuTrigger asChild>
                <Button variant="ghost" size="sm">
                  {COMPANY_SORTS.find(s => s.value === list.state.sort.key)?.label ?? 'Sort'}
                </Button>
              </MenuTrigger>
              <MenuContent>
                <MenuLabel>Sort by</MenuLabel>
                <MenuRadioGroup value={list.state.sort.key} onValueChange={key => list.setSort({ key: key as CompanySort['key'], dir: key === 'name' ? 'asc' : 'desc' })}>
                  {COMPANY_SORTS.map(s => (
                    <MenuRadioItem key={s.value} value={s.value}>
                      {s.label}
                    </MenuRadioItem>
                  ))}
                </MenuRadioGroup>
                <MenuSeparator />
                <MenuLabel>Group by</MenuLabel>
                <MenuRadioGroup value={list.state.groupBy ?? 'none'} onValueChange={value => list.setGroupBy(value === 'none' ? null : value)}>
                  {COMPANY_GROUP_OPTIONS.map(option => (
                    <MenuRadioItem key={option.value} value={option.value}>
                      {option.label}
                    </MenuRadioItem>
                  ))}
                </MenuRadioGroup>
              </MenuContent>
            </Menu>
          </>
        }
        count={companies.length}
        countLabel="company"
        countLabelPlural="companies"
        search={list.state.search}
        onSearch={list.setSearch}
        more={
          <>
            <MenuItem icon={<CopySimple size={16} />} onSelect={() => setDupesOpen(true)}>
              Find duplicates
            </MenuItem>
            {ws.can('data.export') && (
              <MenuItem icon={<DownloadSimple size={16} />} onSelect={exportCsv}>
                Export CSV
              </MenuItem>
            )}
            <MenuItem icon={<FloppyDisk size={16} />} onSelect={() => setSaveOpen(true)}>
              Save as view…
            </MenuItem>
            <MenuItem icon={<ArrowsClockwise size={16} />} onSelect={() => query.refetch()}>
              Refresh
            </MenuItem>
          </>
        }
      />
      <FilterChips chips={chips} onClear={chips.length ? () => list.reset() : undefined} />

      <div ref={nav.scrollRef} className="min-h-0 flex-1">
        {query.isPending ? (
          <ListSkeleton rows={10} />
        ) : companies.length === 0 ? (
          <EmptyState
            icon={<Buildings size={22} weight="duotone" />}
            title={list.isFiltered ? 'Nothing matches those filters' : 'No companies yet'}
            actions={
              list.isFiltered ? (
                <Button variant="secondary" onClick={() => list.reset()}>
                  Clear filters
                </Button>
              ) : canEdit ? (
                <Button variant="primary" onClick={() => actions.openCreate('company')}>
                  New company
                </Button>
              ) : undefined
            }
          >
            {list.isFiltered
              ? 'Try removing a filter, or clear them all.'
              : 'A company is an organization you sell to. Add one and its people, deals and history all hang off it.'}
          </EmptyState>
        ) : (
          <Ledger
            rows={companies}
            columns={columns}
            getId={c => c.id}
            sort={list.state.sort}
            onSort={key => list.toggleSort(key as CompanySort['key'])}
            // Clicking a row is also where the keyboard picks up, so J/K carry on from
            // the row you peeked rather than jumping back to the top of the list.
            onRowClick={company => {
              nav.setFocusId(company.id);
              actions.openPeek({ type: 'company', id: company.id });
            }}
            onRowDoubleClick={company => navigate(`/companies/${company.id}`)}
            focusId={nav.focusId}
            selected={nav.selected}
            onToggleSelect={nav.toggleSelect}
            onToggleAll={() => (nav.allSelected ? nav.clearSelection() : nav.selectAll())}
            groups={
              grouped?.map(group => ({
                key: group.key,
                label: group.label,
                count: group.rows.length,
                meta: <Money value={companyTotals(group.rows).openValue} compact />,
                rows: group.rows,
              })) ?? undefined
            }
            rowMenu={company => (
              <Menu>
                <MenuTrigger asChild>
                  <Button variant="ghost" size="xs" icon aria-label={`Actions for ${company.name}`}>
                    <DotsThree size={16} weight="bold" />
                  </Button>
                </MenuTrigger>
                <MenuContent align="end">
                  <MenuItem onSelect={() => navigate(`/companies/${company.id}`)}>Open company</MenuItem>
                  {canEdit && (
                    <MenuItem icon={<Plus size={16} />} onSelect={() => actions.openCreate('deal', { companyId: company.id, companyName: company.name })}>
                      New deal
                    </MenuItem>
                  )}
                  {canEdit && (
                    <MenuItem icon={<UserPlus size={16} />} onSelect={() => actions.openCreate('contact', { companyId: company.id, companyName: company.name })}>
                      New contact
                    </MenuItem>
                  )}
                  {company.domain && <MenuItem onSelect={() => void navigator.clipboard?.writeText(company.domain as string)}>Copy domain</MenuItem>}
                  {canEdit && (
                    <>
                      <MenuSeparator />
                      <MenuItem icon={<Archive size={16} />} onSelect={() => companyActions.archive([company.id], !company.archived)}>
                        {company.archived ? 'Restore' : 'Archive'}
                      </MenuItem>
                    </>
                  )}
                </MenuContent>
              </Menu>
            )}
          />
        )}
      </div>

      <BulkBar count={nav.selected.size} noun="company" onClear={nav.clearSelection}>
        <MemberPicker
          value={null}
          onChange={ownerId => {
            companyActions.setOwner([...nav.selected], ownerId);
            nav.clearSelection();
          }}
          trigger={<BulkButton>Assign</BulkButton>}
        />
        <OptionsPicker
          options={[...COMPANY_TYPES]}
          value={null}
          allowEmpty={false}
          onChange={type => {
            if (!type) return;
            companyActions.setType([...nav.selected], type);
            nav.clearSelection();
          }}
          trigger={<BulkButton>Set type</BulkButton>}
        />
        <TagPicker
          values={[]}
          onChange={tagIds => {
            if (!tagIds.length) return;
            companyActions.addTags([...nav.selected], tagIds);
          }}
          trigger={<BulkButton leading={<TagIcon size={15} />}>Tag</BulkButton>}
        />
        <BulkButton
          leading={<Archive size={15} />}
          onClick={() => {
            companyActions.archive([...nav.selected], !list.state.filters.archived);
            nav.clearSelection();
          }}
        >
          {list.state.filters.archived ? 'Restore' : 'Archive'}
        </BulkButton>
        <BulkButton leading={<Trash size={15} />} onClick={() => setDeleting(selected())}>
          Delete
        </BulkButton>
      </BulkBar>

      {deleting && <DeleteCompanyDialog open onOpenChange={value => !value && setDeleting(null)} companies={deleting} onDone={() => { setDeleting(null); nav.clearSelection(); }} />}
      <DuplicatesDialog open={dupesOpen} onOpenChange={setDupesOpen} type="company" />
      <SaveViewDialog
        open={saveOpen}
        onOpenChange={setSaveOpen}
        scope="Companies"
        config={{ layout: list.state.layout, filters: list.state.filters, sort: list.state.sort, groupBy: list.state.groupBy }}
        existing={savedView}
      />
    </div>
  );
}
