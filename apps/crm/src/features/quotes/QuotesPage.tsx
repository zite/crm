import { ArrowsClockwise, Bookmarks, DownloadSimple, Plus, Prohibit, Receipt } from '@phosphor-icons/react';
import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { voidQuote } from 'zitejs/api';
import { Avatar, Unassigned } from '../../ui/Avatar';
import { Button } from '../../ui/Button';
import { EmptyState, ListSkeleton, PageHeader, StatStrip } from '../../ui/Layout';
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from '../../ui/Menu';
import { cn } from '../../ui/cn';
import { CompanyMark, Money } from '../../glyphs';
import { BulkBar, BulkButton } from '../../records/BulkBar';
import { Ledger, type Column } from '../../records/Ledger';
import { SaveViewDialog } from '../../records/SaveViewDialog';
import { FilterChips, ListToolbar } from '../../records/Toolbar';
import { useListNav } from '../../records/useListNav';
import { useListState } from '../../records/useListState';
import { useAppActions } from '../../lib/app-actions';
import { downloadCsv } from '../../lib/csv';
import { addDays } from '@project/shared/dates';
import { shortDate, timeAgo } from '../../lib/format';
import { useDocumentTitle } from '../../lib/useDocumentTitle';
import { useWorkspace } from '../../lib/workspace';
import CreateQuoteDialog from './CreateQuoteDialog';
import { QuoteFilterMenu, quoteFilterChips, type QuoteUiFilters } from './QuoteFilters';
import { QuoteStatusBadge } from './quoteStatus';
import { hasCents } from './lineItems';
import { invalidateQuotes, useQuotes } from './queries';
import type { ListQuotesInputType, ListQuotesOutputType } from 'zitejs/api';

type Quote = ListQuotesOutputType['quotes'][number];
type QuoteSort = NonNullable<ListQuotesInputType['sort']>;

const SORTS = [
  { value: 'createdAt', label: 'Newest' },
  { value: 'number', label: 'Number' },
  { value: 'total', label: 'Total' },
  { value: 'sentAt', label: 'Sent' },
  { value: 'expiresOn', label: 'Expiry' },
  { value: 'company', label: 'Company' },
  { value: 'status', label: 'Status' },
] as const;

/** Quotes: a ledger of what has been offered, and where each one stands. */
export function QuotesPage() {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const actions = useAppActions();
  const [params, setParams] = useSearchParams();
  const [saveOpen, setSaveOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  useDocumentTitle('Quotes', ws.settings.organizationName);

  const viewId = params.get('view');
  const savedView = viewId ? ws.views.find(v => v.id === viewId) ?? null : null;

  const list = useListState<QuoteUiFilters, QuoteSort['key']>('quotes', {
    layout: 'list',
    sort: { key: 'createdAt', dir: 'desc' },
    groupBy: null,
    columns: null,
    filters: {},
    search: '',
  });

  const query = useQuotes({
    filters: {
      status: list.state.filters.status as NonNullable<ListQuotesInputType['filters']>['status'],
      ownerIds: list.state.filters.ownerIds,
      companyId: list.state.filters.companyId,
      expiringDays: list.state.filters.expiringSoon ? 7 : undefined,
      search: list.state.search || undefined,
    },
    sort: list.state.sort,
    limit: 500,
  });
  const quotes = query.data?.quotes ?? [];

  const stats = useMemo(() => {
    const open = quotes.filter(q => q.status === 'Sent' || q.status === 'Viewed');
    const accepted = quotes.filter(q => q.status === 'Accepted');
    const drafts = quotes.filter(q => q.status === 'Draft');
    const soon = open.filter(q => q.expiresOn && q.expiresOn <= addDays(ws.today, 7));
    const sum = (rows: Quote[]) => rows.reduce((a, q) => a + q.total, 0);
    return { open, accepted, drafts, soon, sum };
  }, [quotes, ws.today]);

  const nav = useListNav({
    items: quotes,
    getId: q => q.id,
    onOpen: quote => navigate(`/quotes/${quote.id}`),
    enabled: !actions.paletteOpen,
  });

  const chips = quoteFilterChips(list.state.filters, list.setFilters, ws);

  const columns: Array<Column<Quote>> = [
    {
      key: 'number',
      header: 'Number',
      sort: 'number',
      width: '104px',
      cell: quote => <span className="font-mono text-meta tracking-[0.03em] text-ink-2">{quote.number}</span>,
    },
    {
      key: 'title',
      header: 'Quote',
      sort: 'title',
      cell: quote => (
        <div className="flex items-center gap-2.5">
          <CompanyMark name={quote.companyName ?? quote.title} id={quote.companyId ?? quote.id} size="sm" />
          <div className="min-w-0">
            <div className="truncate font-medium text-ink">{quote.title || 'Untitled quote'}</div>
            <div className="truncate text-meta text-ink-3">{quote.companyName ?? 'No company'}</div>
          </div>
        </div>
      ),
    },
    { key: 'deal', header: 'Deal', width: '19%', hide: 'lg', cell: quote => <span className="truncate text-ink-2">{quote.dealName ?? '—'}</span> },
    { key: 'status', header: 'Status', sort: 'status', width: '132px', cell: quote => <QuoteStatusBadge status={quote.status} /> },
    // Round totals scan cleanly; one with real cents is shown in full rather than rounded into a different number.
    { key: 'total', header: 'Total', sort: 'total', align: 'right', width: '124px', cell: quote => <Money value={quote.total} cents={hasCents(quote.total)} muted0 /> },
    { key: 'sentAt', header: 'Sent', sort: 'sentAt', width: '96px', hide: 'md', cell: quote => <span className="text-ink-2">{quote.sentAt ? timeAgo(quote.sentAt) : '—'}</span> },
    {
      key: 'expiresOn',
      header: 'Expires',
      sort: 'expiresOn',
      width: '96px',
      hide: 'md',
      cell: quote => {
        const lapsed = quote.expiresOn && quote.expiresOn < ws.today && (quote.status === 'Sent' || quote.status === 'Viewed' || quote.status === 'Expired');
        return <span className={cn('tabular', lapsed ? 'text-warning' : 'text-ink-2')}>{quote.expiresOn ? shortDate(quote.expiresOn) : '—'}</span>;
      },
    },
    {
      key: 'owner',
      header: 'Owner',
      sort: 'owner',
      width: '124px',
      hide: 'xl',
      cell: quote => {
        const owner = ws.memberById(quote.ownerId);
        return (
          <span className="flex items-center gap-1.5">
            {owner ? <Avatar person={owner} size="xs" /> : <Unassigned size="xs" />}
            <span className="truncate text-ui text-ink-2">{owner?.name.split(' ')[0] ?? 'Unassigned'}</span>
          </span>
        );
      },
    },
  ];

  const exportCsv = () =>
    downloadCsv(
      'quotes',
      ['Number', 'Title', 'Company', 'Deal', 'Status', 'Subtotal', 'Discount', 'Tax', 'Total', 'Sent', 'Expires', 'Owner', 'Accepted by'],
      quotes.map(q => [q.number, q.title, q.companyName ?? '', q.dealName ?? '', q.status, q.subtotal, q.discountTotal, q.tax, q.total, q.sentAt ?? '', q.expiresOn ?? '', ws.memberName(q.ownerId), q.acceptedName ?? '']),
    );

  const bulkVoid = async () => {
    const ids = [...nav.selected];
    const ok = await actions.confirm({
      title: ids.length === 1 ? 'Void this quote?' : `Void ${ids.length} quotes?`,
      description: 'Each buyer’s link will say the quote has been withdrawn. The records and their numbers stay.',
      confirmLabel: 'Void',
      destructive: true,
    });
    if (!ok) return;
    try {
      const result = await voidQuote({ ids });
      invalidateQuotes(qc);
      nav.clearSelection();
      if (result.failed.length) toast.error(result.failed[0].message);
      else toast.success(result.voided === 1 ? 'Quote voided' : `${result.voided} quotes voided`);
    } catch (e) {
      toast.error((e as Error)?.message ?? 'Couldn’t void those quotes');
    }
  };

  return (
    <div className="flex min-h-full flex-col">
      <PageHeader
        title={savedView?.name ?? 'Quotes'}
        description={savedView ? 'A saved view of your quotes.' : 'What you have offered, what the buyer has seen, and what they said.'}
        actions={
          <>
            {ws.viewsFor('Quotes').length > 0 && (
              <Menu>
                <MenuTrigger asChild>
                  <Button variant="secondary" size="sm">
                    Views
                  </Button>
                </MenuTrigger>
                <MenuContent align="end">
                  <MenuLabel>Saved views</MenuLabel>
                  {ws.viewsFor('Quotes').map(view => (
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
            {ws.can('quotes.manage') && (
              <Button variant="primary" size="sm" leading={<Plus size={16} weight="bold" />} onClick={() => setCreateOpen(true)}>
                New quote
              </Button>
            )}
          </>
        }
      />

      <div className="px-5 pb-1 pt-5 sm:px-8">
        <StatStrip
          items={[
            { label: 'Out for signature', value: <Money value={stats.sum(stats.open)} compact />, hint: `${stats.open.length} sent or opened`, onClick: () => list.setFilters({ status: ['Sent', 'Viewed'], expiringSoon: undefined }) },
            { label: 'Accepted', value: <Money value={stats.sum(stats.accepted)} compact />, hint: `${stats.accepted.length} signed off`, onClick: () => list.setFilters({ status: ['Accepted'], expiringSoon: undefined }) },
            { label: 'Drafts', value: stats.drafts.length, hint: 'Not sent yet', onClick: () => list.setFilters({ status: ['Draft'], expiringSoon: undefined }) },
            { label: 'Expiring in 7 days', value: stats.soon.length, hint: 'Still unanswered', onClick: () => list.setFilters({ expiringSoon: true, status: undefined }) },
          ]}
        />
      </div>

      <ListToolbar
        className="mt-5"
        start={
          <>
            <QuoteFilterMenu filters={list.state.filters} onChange={patch => list.setFilters(patch)} />
            <Menu>
              <MenuTrigger asChild>
                <Button variant="ghost" size="sm">
                  {SORTS.find(s => s.value === list.state.sort.key)?.label ?? 'Sort'}
                </Button>
              </MenuTrigger>
              <MenuContent>
                <MenuLabel>Sort by</MenuLabel>
                {SORTS.map(s => (
                  <MenuItem key={s.value} onSelect={() => list.setSort({ key: s.value as QuoteSort['key'], dir: s.value === 'number' || s.value === 'company' || s.value === 'expiresOn' ? 'asc' : 'desc' })}>
                    {s.label}
                  </MenuItem>
                ))}
              </MenuContent>
            </Menu>
          </>
        }
        count={quotes.length}
        countLabel="quote"
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
            <MenuItem icon={<Bookmarks size={16} />} onSelect={() => setSaveOpen(true)}>
              Save as view…
            </MenuItem>
          </>
        }
      />
      <FilterChips chips={chips} onClear={chips.length ? () => list.reset() : undefined} />

      <div ref={nav.scrollRef} className="min-h-0 flex-1">
        {query.isPending ? (
          <ListSkeleton rows={8} />
        ) : quotes.length === 0 ? (
          <EmptyState
            icon={<Receipt size={22} weight="duotone" />}
            title={list.isFiltered ? 'Nothing matches those filters' : 'No quotes yet'}
            actions={
              list.isFiltered ? (
                <Button variant="secondary" onClick={() => list.reset()}>
                  Clear filters
                </Button>
              ) : ws.can('quotes.manage') ? (
                <Button variant="primary" onClick={() => setCreateOpen(true)}>
                  New quote
                </Button>
              ) : undefined
            }
          >
            {list.isFiltered
              ? 'Try removing a filter, or clear them all.'
              : 'A quote is a priced proposal you send to a buyer: your line items, your terms, and a private link they can accept or decline. Accepting lands straight on the deal.'}
          </EmptyState>
        ) : (
          <Ledger
            rows={quotes}
            columns={columns}
            getId={q => q.id}
            sort={list.state.sort}
            onSort={key => list.toggleSort(key as QuoteSort['key'])}
            onRowClick={quote => navigate(`/quotes/${quote.id}`)}
            focusId={nav.focusId}
            selected={ws.can('quotes.manage') ? nav.selected : undefined}
            onToggleSelect={ws.can('quotes.manage') ? nav.toggleSelect : undefined}
            onToggleAll={() => (nav.allSelected ? nav.clearSelection() : nav.selectAll())}
          />
        )}
      </div>

      <BulkBar count={nav.selected.size} noun="quote" onClear={nav.clearSelection}>
        <BulkButton leading={<Prohibit size={15} />} onClick={() => void bulkVoid()}>
          Void
        </BulkButton>
      </BulkBar>

      <CreateQuoteDialog open={createOpen} onOpenChange={setCreateOpen} defaults={{}} />
      <SaveViewDialog open={saveOpen} onOpenChange={setSaveOpen} scope="Quotes" config={{ layout: 'list', filters: list.state.filters, sort: list.state.sort }} existing={savedView} />
    </div>
  );
}
