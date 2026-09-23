import { ArrowLeft, ArrowsClockwise, Broom, Cards, DownloadSimple, Plus, Prohibit, Trash, UserCircle, WarningCircle } from '@phosphor-icons/react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Avatar, Unassigned } from '../../ui/Avatar';
import { Button } from '../../ui/Button';
import { EmptyState, ListSkeleton, PageHeader, StatStrip } from '../../ui/Layout';
import { Menu, MenuContent, MenuItem, MenuLabel, MenuRadioGroup, MenuRadioItem, MenuSeparator, MenuTrigger } from '../../ui/Menu';
import { CompanyMark, LeadStatusBadge } from '../../glyphs';
import { MemberPicker, OptionsPicker } from '../../pickers/pickers';
import { BulkBar, BulkButton } from '../../records/BulkBar';
import { Ledger, type Column } from '../../records/Ledger';
import { SaveViewDialog } from '../../records/SaveViewDialog';
import { FilterChips, ListToolbar } from '../../records/Toolbar';
import { useListNav } from '../../records/useListNav';
import { useListState } from '../../records/useListState';
import { useAppActions } from '../../lib/app-actions';
import { downloadCsv } from '../../lib/csv';
import { errorMessage } from '../../lib/errors';
import { shortDate, timeAgo } from '../../lib/format';
import { useDocumentTitle } from '../../lib/useDocumentTitle';
import { useWorkspace } from '../../lib/workspace';
import { LEAD_STATUSES } from '@project/shared/constants';
import { DisqualifyDialog } from './DisqualifyDialog';
import { LeadFilterMenu, leadFilterChips } from './LeadFilters';
import { LeadScore, ResponseCell } from './LeadGlyphs';
import { isNeglected, useLeadActions, useLeads, type Lead, type LeadFilters, type LeadSort } from './leadData';

const SORTS = [
  { value: 'receivedAt', label: 'Newest first' },
  { value: 'score', label: 'Score' },
  { value: 'name', label: 'Name' },
  { value: 'company', label: 'Company' },
  { value: 'owner', label: 'Owner' },
  { value: 'source', label: 'Source' },
  { value: 'firstResponseAt', label: 'First response' },
  { value: 'lastActivityAt', label: 'Last activity' },
] as const;

/** Leads: the ledger. The review deck is one click away, and it's where new leads belong. */
export function LeadsPage() {
  const ws = useWorkspace();
  const navigate = useNavigate();
  const actions = useAppActions();
  const leadActions = useLeadActions();
  const [params, setParams] = useSearchParams();
  const [saveOpen, setSaveOpen] = useState(false);
  const [disqualifying, setDisqualifying] = useState<string[] | null>(null);
  useDocumentTitle('Leads', ws.settings.organizationName);

  const viewId = params.get('view');
  const savedView = viewId ? ws.views.find(v => v.id === viewId) ?? null : null;

  const list = useListState<LeadFilters, LeadSort['key']>('leads', {
    layout: 'list',
    sort: { key: 'receivedAt', dir: 'desc' },
    groupBy: null,
    columns: null,
    filters: { status: ['New', 'Working', 'Nurturing'] },
    search: '',
  });

  // `?form=<id>` arrives from a form's "Leads from this form" link. It belongs
  // to the link, not to the list, so leaving the link drops it again.
  const formParam = params.get('form');
  useEffect(() => {
    if (formParam) {
      if (list.state.filters.formId !== formParam) list.setFilters({ formId: formParam, status: undefined });
    } else if (list.state.filters.formId) {
      list.setFilters({ formId: undefined });
    }
  }, [formParam]);

  const query = useLeads({
    filters: { ...list.state.filters, search: list.state.search || undefined },
    sort: list.state.sort,
    limit: 1000,
  });
  const leads = query.data?.leads ?? [];
  const formName = leads.find(l => l.formId === list.state.filters.formId)?.formName ?? null;
  const responseHours = query.data?.responseHours ?? ws.settings.preferences.leadResponseHours;

  // The tiles are entry points into the whole inbox, so they read the whole
  // inbox. Deriving them from the filtered rows made every one of them say 0 the
  // moment a filter matched nothing — and "To review: 0" over 26 leads is a lie.
  const everything = useLeads({ filters: {}, sort: { key: 'receivedAt', dir: 'desc' }, limit: 1000 });

  const stats = useMemo(() => {
    const rows = everything.data?.leads ?? [];
    const open = rows.filter(l => l.status === 'New' || l.status === 'Working');
    return {
      untriaged: rows.filter(l => l.status === 'New').length,
      mine: open.filter(l => l.ownerId === ws.me.id).length,
      unassigned: open.filter(l => !l.ownerId).length,
      neglected: rows.filter(l => isNeglected(l, responseHours)).length,
      hot: rows.filter(l => l.rating === 'Hot' && l.status !== 'Disqualified').length,
    };
  }, [everything.data, responseHours, ws.me.id]);

  const nav = useListNav({
    items: leads,
    getId: l => l.id,
    onOpen: lead => navigate(`/leads/${lead.id}`),
    onPeek: lead => actions.openPeek({ type: 'lead', id: lead.id }),
    // With a peek open, J/K walk the list and the sheet comes along.
    followFocus: actions.peek?.type === 'lead',
    enabled: !actions.paletteOpen && !disqualifying && !saveOpen,
  });

  const chips = leadFilterChips(
    list.state.filters,
    patch => {
      if ('formId' in patch && !patch.formId) setParams({});
      list.setFilters(patch);
    },
    ws,
    formName,
  );
  const canEdit = ws.can('records.edit');

  const columns: Array<Column<Lead>> = [
    {
      key: 'name',
      header: 'Lead',
      sort: 'name',
      width: '22%',
      cell: lead => (
        <div className="flex items-center gap-2.5">
          <CompanyMark name={lead.companyName ?? lead.name} id={lead.companyName ?? lead.id} size="sm" />
          <div className="min-w-0">
            <div className="truncate font-medium text-ink">{lead.name}</div>
            <div className="truncate text-meta text-ink-3">{lead.email ?? 'No email'}</div>
          </div>
        </div>
      ),
    },
    {
      key: 'company',
      header: 'Company',
      sort: 'company',
      width: '15%',
      hide: 'md',
      cell: lead => (
        <div className="min-w-0">
          <div className="truncate text-ink">{lead.companyName ?? '—'}</div>
          {lead.employees ? <div className="truncate text-meta text-ink-3">{lead.employees.toLocaleString('en-US')} people</div> : null}
        </div>
      ),
    },
    { key: 'title', header: 'Title', width: '13%', hide: 'xl', cell: lead => <span className="truncate text-ink-2">{lead.title ?? '—'}</span> },
    {
      key: 'source',
      header: 'Source',
      sort: 'source',
      width: '11%',
      hide: 'lg',
      cell: lead => (
        <div className="min-w-0">
          <div className="truncate text-ink-2">{lead.source ?? '—'}</div>
          {lead.formName && <div className="truncate text-meta text-ink-3">{lead.formName}</div>}
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      sort: 'status',
      width: '11%',
      interactive: true,
      cell: lead =>
        canEdit && !lead.convertedAt ? (
          <OptionsPicker
            options={[...LEAD_STATUSES]}
            value={lead.status}
            allowEmpty={false}
            onChange={value => {
              if (!value) return;
              if (value === 'Disqualified') setDisqualifying([lead.id]);
              else leadActions.setStatus([lead.id], value as Lead['status']);
            }}
            trigger={
              <button className="rounded-sm px-1 py-1 hover:bg-hover" aria-label={`Status: ${lead.status}`}>
                <LeadStatusBadge status={lead.status} />
              </button>
            }
          />
        ) : (
          <LeadStatusBadge status={lead.status} />
        ),
    },
    { key: 'score', header: 'Score', sort: 'score', width: '10%', cell: lead => <LeadScore score={lead.score} rating={lead.rating} /> },
    {
      key: 'owner',
      header: 'Owner',
      sort: 'owner',
      width: '10%',
      interactive: true,
      hide: 'sm',
      cell: lead => {
        const owner = ws.memberById(lead.ownerId);
        const trigger = (
          <button className="flex items-center gap-1.5 rounded-sm px-1 py-1 hover:bg-hover">
            <span>{owner ? <Avatar person={owner} size="xs" /> : <Unassigned size="xs" />}</span>
            <span className="truncate text-ui">{owner?.name.split(' ')[0] ?? 'Unassigned'}</span>
          </button>
        );
        return canEdit ? <MemberPicker value={lead.ownerId} onChange={ownerId => leadActions.setOwner([lead.id], ownerId)} trigger={trigger} /> : trigger;
      },
    },
    { key: 'received', header: 'Received', sort: 'receivedAt', width: '9%', hide: 'md', cell: lead => <span className="text-ink-2" title={lead.receivedAt ? shortDate(lead.receivedAt.slice(0, 10)) : ''}>{lead.receivedAt ? timeAgo(lead.receivedAt) : '—'}</span> },
    {
      key: 'response',
      header: 'First response',
      sort: 'firstResponseAt',
      width: '12%',
      hide: 'lg',
      cell: lead => <ResponseCell receivedAt={lead.receivedAt} firstResponseAt={lead.firstResponseAt} responseHours={responseHours} neglected={isNeglected(lead, responseHours)} />,
    },
  ];

  const exportCsv = () => {
    downloadCsv(
      'leads',
      ['Name', 'Email', 'Phone', 'Company', 'Title', 'Employees', 'Source', 'Form', 'Status', 'Score', 'Rating', 'Owner', 'Received', 'First response', 'Disqualify reason'],
      leads.map(l => [
        l.name,
        l.email ?? '',
        l.phone ?? '',
        l.companyName ?? '',
        l.title ?? '',
        l.employees ?? '',
        l.source ?? '',
        l.formName ?? '',
        l.status,
        l.score,
        l.rating,
        ws.memberName(l.ownerId),
        l.receivedAt ?? '',
        l.firstResponseAt ?? '',
        l.disqualifyReason ?? '',
      ]),
    );
  };

  return (
    <div className="flex min-h-full flex-col">
      <PageHeader
        // An eyebrow only when it does something: the way back out of a saved view.
        eyebrow={
          savedView ? (
            <button type="button" className="inline-flex items-center gap-1 hover:text-ink" onClick={() => { setParams({}); list.reset(); }}>
              <ArrowLeft size={13} /> All leads
            </button>
          ) : undefined
        }
        title={savedView?.name ?? 'Leads'}
        description={savedView ? 'A saved view of your leads.' : 'Everyone who has raised a hand, and how quickly we answered.'}
        actions={
          <>
            {ws.viewsFor('Leads').length > 0 && (
              <Menu>
                <MenuTrigger asChild>
                  <Button variant="secondary" size="sm">
                    Views
                  </Button>
                </MenuTrigger>
                <MenuContent align="end">
                  <MenuLabel>Saved views</MenuLabel>
                  {ws.viewsFor('Leads').map(view => (
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
            <Button variant="secondary" size="sm" leading={<Cards size={16} />} onClick={() => navigate('/leads/review')}>
              Review{stats.untriaged > 0 ? ` ${stats.untriaged}` : ''}
            </Button>
            {canEdit && (
              <Button variant="primary" size="sm" leading={<Plus size={16} weight="bold" />} onClick={() => actions.openCreate('lead')}>
                New lead
              </Button>
            )}
          </>
        }
      />

      <div className="px-5 pb-1 pt-5 sm:px-8">
        <StatStrip
          items={[
            { label: 'To review', value: stats.untriaged, hint: 'New and untouched', onClick: () => navigate('/leads/review') },
            { label: 'Mine', value: stats.mine, hint: 'New or working', onClick: () => list.setFilters({ ownerIds: [ws.me.id], status: ['New', 'Working'] }) },
            { label: 'Unassigned', value: stats.unassigned, hint: 'Nobody owns them', onClick: () => list.setFilters({ ownerIds: ['none'], status: ['New', 'Working'] }) },
            { label: 'No response yet', value: stats.neglected, hint: `Past ${responseHours}h`, onClick: () => list.setFilters({ noResponse: true, status: ['New', 'Working'] }) },
            { label: 'Hot', value: stats.hot, hint: 'Scoring 65 or more', onClick: () => list.setFilters({ ratings: ['Hot'] }) },
          ]}
        />
      </div>

      <ListToolbar
        className="mt-5"
        start={
          <>
            <LeadFilterMenu filters={list.state.filters} onChange={patch => list.setFilters(patch)} />
            <Menu>
              <MenuTrigger asChild>
                <Button variant="ghost" size="sm">
                  {SORTS.find(s => s.value === list.state.sort.key)?.label ?? 'Sort'}
                </Button>
              </MenuTrigger>
              <MenuContent>
                <MenuLabel>Sort by</MenuLabel>
                <MenuRadioGroup value={list.state.sort.key} onValueChange={key => list.setSort({ key: key as LeadSort['key'], dir: key === 'name' || key === 'company' ? 'asc' : 'desc' })}>
                  {SORTS.map(s => (
                    <MenuRadioItem key={s.value} value={s.value}>
                      {s.label}
                    </MenuRadioItem>
                  ))}
                </MenuRadioGroup>
              </MenuContent>
            </Menu>
          </>
        }
        count={leads.length}
        countLabel="lead"
        search={list.state.search}
        onSearch={list.setSearch}
        more={
          <>
            <MenuItem icon={<DownloadSimple size={16} />} onSelect={exportCsv}>
              Export CSV
            </MenuItem>
            <MenuItem icon={<ArrowsClockwise size={16} />} onSelect={() => query.refetch()}>
              Refresh
            </MenuItem>
            <MenuItem icon={<Broom size={16} />} onSelect={() => setSaveOpen(true)}>
              Save as view…
            </MenuItem>
          </>
        }
      />
      <FilterChips chips={chips} onClear={chips.length || list.state.search ? () => list.reset() : undefined} />

      <div ref={nav.scrollRef} className="min-h-0 flex-1">
        {query.isPending ? (
          <ListSkeleton rows={8} />
        ) : query.isError ? (
          <EmptyState
            icon={<WarningCircle size={22} weight="duotone" />}
            title="The list didn’t load"
            actions={
              <Button variant="primary" onClick={() => void query.refetch()}>
                Try again
              </Button>
            }
          >
            {errorMessage(query.error, 'Something went wrong fetching your leads.')}
          </EmptyState>
        ) : leads.length === 0 ? (
          <EmptyState
            icon={<UserCircle size={22} weight="duotone" />}
            title={list.isFiltered ? 'Nothing matches those filters' : 'No leads yet'}
            actions={
              list.isFiltered ? (
                <Button variant="secondary" onClick={() => list.reset()}>
                  Clear filters
                </Button>
              ) : (
                <>
                  {canEdit && (
                    <Button variant="primary" onClick={() => actions.openCreate('lead')}>
                      New lead
                    </Button>
                  )}
                  <Button variant="secondary" onClick={() => navigate('/outreach/forms')}>
                    Set up a web form
                  </Button>
                </>
              )
            }
          >
            {list.isFiltered ? 'Try removing a filter, or clear them all.' : 'A lead is someone who raised a hand but isn’t a contact yet. They arrive from web forms, events and outbound — triage them in the review deck.'}
          </EmptyState>
        ) : (
          <Ledger
            rows={leads}
            columns={columns}
            getId={l => l.id}
            sort={list.state.sort}
            onSort={key => list.toggleSort(key as LeadSort['key'])}
            onRowClick={lead => actions.openPeek({ type: 'lead', id: lead.id })}
            onRowDoubleClick={lead => navigate(`/leads/${lead.id}`)}
            focusId={nav.focusId}
            selected={nav.selected}
            onToggleSelect={nav.toggleSelect}
            onToggleAll={() => (nav.allSelected ? nav.clearSelection() : nav.selectAll())}
          />
        )}
      </div>

      {canEdit && (
        <BulkBar count={nav.selected.size} noun="lead" onClear={nav.clearSelection}>
          <MemberPicker
            value={null}
            onChange={ownerId => {
              leadActions.setOwner([...nav.selected], ownerId);
              nav.clearSelection();
            }}
            trigger={<BulkButton>Assign</BulkButton>}
          />
          <OptionsPicker
            options={['New', 'Working', 'Nurturing', 'Qualified']}
            value={null}
            allowEmpty={false}
            onChange={value => {
              if (!value) return;
              leadActions.setStatus([...nav.selected], value as Lead['status']);
              nav.clearSelection();
            }}
            trigger={<BulkButton>Set status</BulkButton>}
          />
          <BulkButton leading={<Prohibit size={15} />} onClick={() => setDisqualifying([...nav.selected])}>
            Disqualify
          </BulkButton>
          <BulkButton
            leading={<Trash size={15} />}
            onClick={async () => {
              const ids = [...nav.selected];
              const ok = await actions.confirm({
                title: `Delete ${ids.length === 1 ? 'this lead' : `${ids.length} leads`}?`,
                description: 'Their notes, calls and tasks go too. Leads that were converted keep the contact, company and deal they became.',
                confirmLabel: 'Delete',
                destructive: true,
              });
              if (!ok) return;
              leadActions.remove.mutate(ids);
              nav.clearSelection();
            }}
          >
            Delete
          </BulkButton>
        </BulkBar>
      )}

      <SaveViewDialog open={saveOpen} onOpenChange={setSaveOpen} scope="Leads" config={{ layout: 'list', filters: list.state.filters, sort: list.state.sort }} existing={savedView} />
      <DisqualifyDialog
        open={Boolean(disqualifying)}
        onOpenChange={open => !open && setDisqualifying(null)}
        leadIds={disqualifying ?? []}
        leadName={disqualifying?.length === 1 ? leads.find(l => l.id === disqualifying[0])?.name : null}
        onDone={() => {
          setDisqualifying(null);
          nav.clearSelection();
        }}
      />
    </div>
  );
}
