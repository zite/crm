import { ArrowsClockwise, Broom, DownloadSimple, Kanban, Plus, Rows, Trash, Warning } from '@phosphor-icons/react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Avatar, Unassigned } from '../../ui/Avatar';
import { Badge, Count } from '../../ui/Chip';
import { Button } from '../../ui/Button';
import { EmptyState, ListSkeleton, PageHeader, StatStrip } from '../../ui/Layout';
import { Menu, MenuContent, MenuItem, MenuLabel, MenuRadioGroup, MenuRadioItem, MenuSeparator, MenuTrigger } from '../../ui/Menu';
import { Segmented } from '../../ui/Form';
import { cn } from '../../ui/cn';
import { CompanyMark, Money, StalledBadge } from '../../glyphs';
import { MemberPicker, StageChip } from '../../pickers/pickers';
import { BulkBar, BulkButton } from '../../records/BulkBar';
import { Ledger, type Column } from '../../records/Ledger';
import { SaveViewDialog } from '../../records/SaveViewDialog';
import { FilterChips, ListToolbar } from '../../records/Toolbar';
import { useListNav } from '../../records/useListNav';
import { useListState } from '../../records/useListState';
import { useAppActions } from '../../lib/app-actions';
import { downloadCsv } from '../../lib/csv';
import { addDays } from '@project/shared/dates';
import { dueLabel, dueState, shortDate, timeAgo, todayString } from '../../lib/format';
import { useDeals } from '../../lib/queries';
import { useDealActions } from '../../lib/mutations';
import { useDocumentTitle } from '../../lib/useDocumentTitle';
import { useWorkspace } from '../../lib/workspace';
import { DealBoard } from './DealBoard';
import { DealFilterMenu, dealFilterChips, type DealFilters } from './DealFilters';
import { dealStalledDays, givenName, groupDeals, GROUP_OPTIONS, totalsFor, type Deal } from './dealHelpers';
import { hasCents } from '../quotes/lineItems';
import type { ListDealsInputType } from 'zitejs/api';

type DealSort = NonNullable<ListDealsInputType['sort']>;
import { WonLostDialog } from './WonLostDialog';

const SORTS = [
  { value: 'position', label: 'Manual (board order)' },
  { value: 'closeDate', label: 'Close date' },
  { value: 'amount', label: 'Amount' },
  { value: 'weighted', label: 'Weighted amount' },
  { value: 'lastActivityAt', label: 'Last activity' },
  { value: 'openedAt', label: 'Created' },
  { value: 'name', label: 'Name' },
  { value: 'company', label: 'Company' },
] as const;

/** Deals: the board by default, the ledger when you want to compare. */
export function DealsPage() {
  const ws = useWorkspace();
  const navigate = useNavigate();
  const actions = useAppActions();
  const dealActions = useDealActions();
  const [params, setParams] = useSearchParams();
  const [saveOpen, setSaveOpen] = useState(false);
  const [closing, setClosing] = useState<{ deals: Deal[]; outcome: 'Won' | 'Lost' } | null>(null);
  useDocumentTitle('Deals', ws.settings.organizationName);

  const viewId = params.get('view');
  const savedView = viewId ? ws.views.find(v => v.id === viewId) ?? null : null;

  const list = useListState<DealFilters, DealSort['key']>('deals', {
    layout: 'board',
    sort: { key: 'position', dir: 'asc' },
    groupBy: 'stage',
    columns: null,
    filters: { status: ['Open'] },
    search: '',
  });

  const pipelineId = list.state.filters.pipelineId ?? ws.defaultPipeline?.id ?? '';

  // Home links here with a reason: /deals?filter=stalled | noNextStep | closingSoon
  const linkFilter = params.get('filter');
  useEffect(() => {
    if (!linkFilter) return;
    const today = todayString();
    const base = { status: ['Open' as const], stalled: undefined, noNextStep: undefined, closeFrom: undefined, closeTo: undefined };
    if (linkFilter === 'stalled') list.setFilters({ ...base, stalled: true });
    else if (linkFilter === 'noNextStep') list.setFilters({ ...base, noNextStep: true });
    else if (linkFilter === 'closingSoon') list.setFilters({ ...base, closeFrom: today, closeTo: addDays(today, 14) });
    else return;
    list.setLayout('list');
    setParams(
      current => {
        const next = new URLSearchParams(current);
        next.delete('filter');
        return next;
      },
      { replace: true },
    );
  }, [linkFilter]);
  const query = useDeals({
    filters: { ...list.state.filters, pipelineId, search: list.state.search || undefined },
    sort: list.state.layout === 'board' ? ({ key: 'position', dir: 'asc' } as DealSort) : list.state.sort,
    limit: 1000,
  });
  const deals = query.data?.deals ?? [];
  const totals = useMemo(() => totalsFor(deals.filter(d => d.status === 'Open')), [deals]);
  const attention = useMemo(
    () => ({
      stalled: deals.filter(d => dealStalledDays(d, ws) > 0).length,
      noNextStep: deals.filter(d => d.status === 'Open' && !d.nextStep).length,
      overdue: deals.filter(d => d.status === 'Open' && d.closeDate && d.closeDate < ws.today).length,
    }),
    [deals, ws],
  );

  const nav = useListNav({
    items: deals,
    getId: d => d.id,
    onOpen: deal => navigate(`/deals/${deal.id}`),
    onPeek: deal => actions.openPeek({ type: 'deal', id: deal.id }),
    enabled: !actions.paletteOpen && !closing,
    // With a peek open, J/K walk the list *and* bring the sheet along.
    followFocus: actions.peek?.type === 'deal',
  });

  const chips = dealFilterChips(list.state.filters, list.setFilters, ws);
  const grouped = list.state.layout === 'list' ? groupDeals(deals, list.state.groupBy, ws) : null;

  const columns: Array<Column<Deal>> = [
    {
      key: 'name',
      header: 'Deal',
      sort: 'name',
      // No width: this is the column that absorbs whatever space is left.
      cell: deal => (
        <div className="flex items-center gap-2.5">
          <CompanyMark name={deal.companyName ?? deal.name} id={deal.companyId ?? deal.id} size="sm" />
          <div className="min-w-0">
            <div className="truncate font-medium text-ink">{deal.name}</div>
            <div className="truncate text-meta text-ink-3">{deal.companyName ?? 'No company'}</div>
          </div>
        </div>
      ),
    },
    {
      key: 'stage',
      header: 'Stage',
      sort: 'stage',
      width: '13%',
      interactive: true,
      cell: deal =>
        deal.status === 'Open' ? (
          <StageChip
            pipelineId={deal.pipelineId}
            stageId={deal.stageId}
            status={deal.status}
            onChange={
              ws.can('records.edit')
                ? stageId => {
                    const stage = ws.stageById(stageId);
                    if (stage?.kind === 'Won' || stage?.kind === 'Lost') setClosing({ deals: [deal], outcome: stage.kind });
                    else dealActions.setStage([deal.id], stageId, { status: 'Open' });
                  }
                : undefined
            }
          />
        ) : (
          <Badge tone={deal.status === 'Won' ? 'success' : 'danger'}>{deal.status}</Badge>
        ),
    },
    // Round amounts scan cleanly; one with real cents is shown in full rather than rounded into a different number.
    { key: 'amount', header: 'Amount', sort: 'amount', align: 'right', width: '10%', cell: deal => <Money value={deal.amount} cents={hasCents(deal.amount)} muted0 /> },
    { key: 'weighted', header: 'Weighted', sort: 'weighted', align: 'right', width: '10%', hide: 'xl', cell: deal => <span className="text-ink-2"><Money value={deal.weighted} /></span> },
    { key: 'closeDate', header: 'Close', sort: 'closeDate', width: '9%', hide: 'md', cell: deal => <span className={cn('tabular', deal.status === 'Open' && deal.closeDate && deal.closeDate < ws.today && 'text-danger')}>{deal.closeDate ? shortDate(deal.closeDate) : '—'}</span> },
    {
      key: 'nextStep',
      header: 'Next step',
      width: '16%',
      hide: 'lg',
      cell: deal => {
        const stalled = dealStalledDays(deal, ws);
        if (deal.status !== 'Open') return <span className="text-ink-3">{deal.lostReason ?? '—'}</span>;
        if (deal.nextStep) {
          const state = dueState(deal.nextStep.dueDate ?? undefined);
          return (
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="truncate">{deal.nextStep.title}</span>
              <span className={cn('shrink-0 text-meta', state === 'overdue' ? 'text-danger' : state === 'today' ? 'text-accent' : 'text-ink-3')}>{dueLabel(deal.nextStep.dueDate ?? undefined)}</span>
            </span>
          );
        }
        return stalled > 0 ? <StalledBadge days={stalled} /> : <span className="inline-flex items-center gap-1 text-warning"><Warning size={13} /> No next step</span>;
      },
    },
    {
      key: 'owner',
      header: 'Owner',
      sort: 'owner',
      width: '10%',
      interactive: true,
      cell: deal => {
        const owner = ws.memberById(deal.ownerId);
        const face = (
          <>
            <span>{owner ? <Avatar person={owner} size="xs" /> : <Unassigned size="xs" />}</span>
            <span className="truncate text-ui">{owner ? givenName(owner.name) : 'Unassigned'}</span>
          </>
        );
        // A viewer reads the owner; only an editor gets a control that opens.
        if (!ws.can('records.edit')) return <span className="flex items-center gap-1.5 px-1 py-1">{face}</span>;
        return <MemberPicker value={deal.ownerId} onChange={ownerId => dealActions.setOwner([deal.id], ownerId)} trigger={<button className="flex items-center gap-1.5 rounded-sm px-1 py-1 hover:bg-hover">{face}</button>} />;
      },
    },
    { key: 'activity', header: 'Last activity', sort: 'lastActivityAt', width: '9%', hide: 'xl', cell: deal => <span className="text-ink-3">{deal.lastActivityAt ? timeAgo(deal.lastActivityAt) : '—'}</span> },
  ];

  const exportCsv = () => {
    downloadCsv(
      'deals',
      ['Deal', 'Company', 'Stage', 'Status', 'Amount', 'Weighted', 'Close date', 'Owner', 'Next step', 'Last activity'],
      deals.map(d => [d.name, d.companyName ?? '', ws.stageById(d.stageId)?.name ?? '', d.status, d.amount ?? '', d.weighted, d.closeDate ?? '', ws.memberName(d.ownerId), d.nextStep?.title ?? '', d.lastActivityAt ?? '']),
    );
  };

  return (
    <div className="flex min-h-full flex-col">
      <PageHeader
        eyebrow={
          ws.pipelines.filter(p => !p.archived).length > 1 ? (
            <Menu>
              <MenuTrigger asChild>
                <button className="inline-flex items-center gap-1 rounded-sm px-1 py-0.5 text-meta font-medium text-ink-2 hover:bg-hover hover:text-ink">{ws.pipelineById(pipelineId)?.name ?? 'Pipeline'} ▾</button>
              </MenuTrigger>
              <MenuContent>
                <MenuLabel>Pipeline</MenuLabel>
                {ws.pipelines.filter(p => !p.archived).map(p => (
                  <MenuItem key={p.id} onSelect={() => list.setFilters({ pipelineId: p.id, stageIds: undefined })}>
                    {p.name}
                  </MenuItem>
                ))}
              </MenuContent>
            </Menu>
          ) : (
            <span>{ws.pipelineById(pipelineId)?.name}</span>
          )
        }
        title={savedView?.name ?? 'Deals'}
        description={savedView ? 'A saved view of your pipeline.' : 'Everything in flight, and what happens next on each one.'}
        actions={
          <>
            {ws.views.filter(v => v.scope === 'Deals').length > 0 && (
              <Menu>
                <MenuTrigger asChild>
                  <Button variant="secondary" size="sm">
                    Views
                  </Button>
                </MenuTrigger>
                <MenuContent align="end">
                  <MenuLabel>Saved views</MenuLabel>
                  {ws.viewsFor('Deals').map(view => (
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
            {ws.can('records.edit') && (
              <Button variant="primary" size="sm" leading={<Plus size={16} weight="bold" />} onClick={() => actions.openCreate('deal', { pipelineId })}>
                New deal
              </Button>
            )}
          </>
        }
      />

      <div className="px-5 pb-1 pt-5 sm:px-8">
        <StatStrip
          items={[
            { label: 'Open pipeline', value: <Money value={totals.amount} compact />, hint: `${totals.count} open deals` },
            { label: 'Weighted', value: <Money value={totals.weighted} compact />, hint: 'By stage probability' },
            { label: 'Stalled', value: attention.stalled, hint: 'Past the stage limit', onClick: () => list.setFilters({ stalled: true, status: ['Open'] }) },
            { label: 'No next step', value: attention.noNextStep, hint: 'Nothing scheduled', onClick: () => list.setFilters({ noNextStep: true, status: ['Open'] }) },
            { label: 'Close date passed', value: attention.overdue, hint: 'Needs a new date', onClick: () => list.setFilters({ closingOverdue: true, status: ['Open'] }) },
          ]}
        />
      </div>

      <ListToolbar
        className="mt-5"
        start={
          <>
            <DealFilterMenu filters={list.state.filters} onChange={patch => list.setFilters(patch)} />
            <Menu>
              <MenuTrigger asChild>
                <Button variant="ghost" size="sm">
                  {list.state.layout === 'board' ? 'Board order' : SORTS.find(s => s.value === list.state.sort.key)?.label ?? 'Sort'}
                </Button>
              </MenuTrigger>
              <MenuContent>
                <MenuLabel>Sort by</MenuLabel>
                {/* Board order stays in the list too — the ledger sorts by it, so leaving it out left the radio group with nothing checked. */}
                <MenuRadioGroup value={list.state.sort.key} onValueChange={key => list.setSort({ key: key as DealSort['key'], dir: key === 'name' || key === 'closeDate' ? 'asc' : 'desc' })}>
                  {SORTS.map(s => (
                    <MenuRadioItem key={s.value} value={s.value}>
                      {s.label}
                    </MenuRadioItem>
                  ))}
                </MenuRadioGroup>
                <MenuSeparator />
                <MenuLabel>Group by</MenuLabel>
                <MenuRadioGroup value={list.state.groupBy ?? 'none'} onValueChange={value => list.setGroupBy(value === 'none' ? null : value)}>
                  {GROUP_OPTIONS.map(option => (
                    <MenuRadioItem key={option.value} value={option.value}>
                      {option.label}
                    </MenuRadioItem>
                  ))}
                </MenuRadioGroup>
              </MenuContent>
            </Menu>
          </>
        }
        count={deals.length}
        countLabel="deal"
        search={list.state.search}
        onSearch={list.setSearch}
        layout={
          <Segmented
            size="sm"
            value={list.state.layout}
            onChange={value => list.setLayout(value)}
            options={[
              { value: 'board', label: '', icon: <Kanban size={16} />, title: 'Board' },
              { value: 'list', label: '', icon: <Rows size={16} />, title: 'List' },
            ]}
          />
        }
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
      <FilterChips chips={chips} onClear={chips.length ? () => list.reset() : undefined} />

      <div ref={nav.scrollRef} className="min-h-0 flex-1">
        {query.isPending ? (
          <ListSkeleton rows={8} />
        ) : deals.length === 0 ? (
          <EmptyState
            icon={<Kanban size={22} weight="duotone" />}
            title={list.isFiltered ? 'Nothing matches those filters' : 'No deals yet'}
            actions={
              list.isFiltered ? (
                <Button variant="secondary" onClick={() => list.reset()}>
                  Clear filters
                </Button>
              ) : (
                <Button variant="primary" onClick={() => actions.openCreate('deal', { pipelineId })}>
                  New deal
                </Button>
              )
            }
          >
            {list.isFiltered ? 'Try removing a filter, or clear them all.' : 'A deal is a revenue opportunity with a company — create one and it lands in the first stage.'}
          </EmptyState>
        ) : list.state.layout === 'board' ? (
          <DealBoard
            deals={deals}
            pipelineId={pipelineId}
            focusId={nav.focusId}
            onMove={(dealId, stageId, position) => {
              const stage = ws.stageById(stageId);
              const deal = deals.find(d => d.id === dealId);
              if (deal && (stage?.kind === 'Won' || stage?.kind === 'Lost')) setClosing({ deals: [deal], outcome: stage.kind });
              else dealActions.setStage([dealId], stageId, { position, status: 'Open' });
            }}
            onOpen={deal => navigate(`/deals/${deal.id}`)}
            onPeek={deal => actions.openPeek({ type: 'deal', id: deal.id })}
          />
        ) : (
          <Ledger
            rows={deals}
            columns={columns}
            getId={d => d.id}
            sort={list.state.sort}
            onSort={key => list.toggleSort(key as DealSort['key'])}
            onRowClick={deal => actions.openPeek({ type: 'deal', id: deal.id })}
            onRowDoubleClick={deal => navigate(`/deals/${deal.id}`)}
            focusId={nav.focusId}
            selected={ws.can('records.edit') ? nav.selected : undefined}
            onToggleSelect={ws.can('records.edit') ? nav.toggleSelect : undefined}
            onToggleAll={() => (nav.allSelected ? nav.clearSelection() : nav.selectAll())}
            groups={grouped?.map(group => ({ key: group.key, label: group.label, count: group.rows.length, meta: <Money value={totalsFor(group.rows).amount} compact />, rows: group.rows })) ?? undefined}
          />
        )}
      </div>

      <BulkBar count={nav.selected.size} noun="deal" onClear={nav.clearSelection}>
        <MemberPicker
          value={null}
          onChange={ownerId => {
            dealActions.setOwner([...nav.selected], ownerId);
            nav.clearSelection();
          }}
          trigger={<BulkButton>Assign</BulkButton>}
        />
        <BulkButton
          onClick={() => {
            const selectedDeals = deals.filter(d => nav.selected.has(d.id));
            setClosing({ deals: selectedDeals, outcome: 'Won' });
          }}
        >
          Mark won
        </BulkButton>
        <BulkButton
          onClick={() => {
            const selectedDeals = deals.filter(d => nav.selected.has(d.id));
            setClosing({ deals: selectedDeals, outcome: 'Lost' });
          }}
        >
          Mark lost
        </BulkButton>
        <BulkButton
          leading={<Trash size={15} />}
          onClick={async () => {
            const ids = [...nav.selected];
            const ok = await actions.confirm({ title: `Delete ${ids.length === 1 ? 'this deal' : `${ids.length} deals`}?`, description: 'Their line items, buying group and stage history go too. Activities and tasks stay on the company and contact.', confirmLabel: 'Delete', destructive: true });
            if (!ok) return;
            dealActions.remove.mutate(ids);
            nav.clearSelection();
          }}
        >
          Delete
        </BulkButton>
      </BulkBar>

      <SaveViewDialog open={saveOpen} onOpenChange={setSaveOpen} scope="Deals" config={{ layout: list.state.layout, filters: list.state.filters, sort: list.state.sort, groupBy: list.state.groupBy }} existing={savedView} />
      {closing && (
        <WonLostDialog
          open
          onOpenChange={open => !open && setClosing(null)}
          deals={closing.deals}
          outcome={closing.outcome}
          onDone={() => {
            setClosing(null);
            nav.clearSelection();
          }}
        />
      )}
    </div>
  );
}
