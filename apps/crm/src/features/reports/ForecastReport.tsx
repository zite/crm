import { useNavigate } from 'react-router-dom';
import { Avatar, Unassigned } from '../../ui/Avatar';
import { Card, EmptyState, PageBody, Skeleton } from '../../ui/Layout';
import { Segmented } from '../../ui/Form';
import { cn } from '../../ui/cn';
import { Money } from '../../glyphs';
import { ChartPieSlice } from '@phosphor-icons/react';
import { downloadCsv } from '../../lib/csv';
import { percent } from '../../lib/format';
import { useWorkspace } from '../../lib/workspace';
import { ControlBar } from './ControlBar';
import { DrillValue } from './charts';
import { useReportControls } from './controls';
import { openFilters, pushDealFilters, wonFilters } from './drill';
import { ReportTable, type ReportColumn } from './ReportTable';
import { useForecastReport } from './queries';
import type { ReportForecastOutputType } from 'zitejs/api';

type Row = ReportForecastOutputType['rows'][number];

/**
 * The call for the period: what each owner has already won, what they are
 * committing to, and the gap left over. Every cell opens the deals behind it,
 * because a forecast is only ever as good as the rows under it.
 */
export function ForecastReport() {
  const ws = useWorkspace();
  const navigate = useNavigate();
  const controls = useReportControls();
  const query = useForecastReport(controls.query);
  const data = query.data;
  const rows = data?.rows ?? [];

  const openDeals = (filters: Parameters<typeof pushDealFilters>[0]) => {
    pushDealFilters({ ...filters, ...(controls.pipelineId ? { pipelineId: controls.pipelineId } : {}) });
    navigate('/deals');
  };

  const total = rows.reduce(
    (sum, row) => ({
      quota: sum.quota + row.quota,
      won: sum.won + row.won.amount,
      commit: sum.commit + row.commit.amount,
      bestCase: sum.bestCase + row.bestCase.amount,
      pipeline: sum.pipeline + row.pipeline.amount,
    }),
    { quota: 0, won: 0, commit: 0, bestCase: 0, pipeline: 0 },
  );
  const totalGap = total.quota - (total.won + total.commit);

  const ownerFilter = (row: Row) => (row.memberId === 'none' ? ['none'] : [row.memberId]);
  const gapFor = (row: Row) => row.quota - (row.won.amount + row.commit.amount);

  const cell = (row: Row, bucket: Row['commit'], categories: string[]) => (
    <DrillValue
      onClick={bucket.deals ? () => openDeals(openFilters(data!.scope.periodStart, data!.scope.periodEnd, { ownerIds: ownerFilter(row), forecastCategories: categories })) : undefined}
      muted={!bucket.amount}
      title={bucket.deals ? `${bucket.deals} ${bucket.deals === 1 ? 'deal' : 'deals'}` : undefined}
    >
      <Money value={bucket.amount} compact muted0 />
    </DrillValue>
  );

  const columns: Array<ReportColumn<Row>> = [
    {
      key: 'owner',
      header: 'Owner',
      width: '24%',
      sticky: true,
      cell: row => (
        <span className="flex items-center gap-2.5">
          {row.member ? <Avatar person={row.member} size="xs" /> : <Unassigned size="xs" />}
          <span className="min-w-0 truncate">
            {row.name}
            {row.memberId === data?.me && <span className="ml-1.5 text-meta text-ink-3">You</span>}
          </span>
        </span>
      ),
    },
    {
      key: 'quota',
      header: 'Quota',
      align: 'right',
      width: '12%',
      // A row with no quota says so in the gap column; showing "$0" beside it reads
      // like a target of nothing rather than an absent one.
      cell: row => (row.quota ? <Money value={row.quota} compact /> : <span className="text-ink-3">—</span>),
      total: <Money value={total.quota} compact muted0 />,
    },
    {
      key: 'won',
      header: 'Closed won',
      align: 'right',
      width: '12%',
      cell: row => (
        <DrillValue onClick={row.won.deals ? () => openDeals(wonFilters(data!.scope.periodStart, data!.scope.periodEnd, ownerFilter(row))) : undefined} muted={!row.won.amount} title={`${row.won.deals} won`}>
          <Money value={row.won.amount} compact muted0 />
        </DrillValue>
      ),
      total: <Money value={total.won} compact muted0 />,
    },
    { key: 'commit', header: 'Commit', align: 'right', width: '12%', cell: row => cell(row, row.commit, ['Commit']), total: <Money value={total.commit} compact muted0 /> },
    { key: 'best', header: 'Best case', align: 'right', width: '12%', cell: row => cell(row, row.bestCase, ['Best Case']), total: <Money value={total.bestCase} compact muted0 /> },
    { key: 'pipeline', header: 'Pipeline', align: 'right', width: '12%', cell: row => cell(row, row.pipeline, ['Pipeline']), total: <Money value={total.pipeline} compact muted0 /> },
    {
      key: 'gap',
      header: 'Gap to quota',
      align: 'right',
      width: '16%',
      cell: row => {
        const gap = gapFor(row);
        if (!row.quota) return <span className="text-ink-3">No quota</span>;
        return (
          <span className={cn('tabular', gap > 0 ? 'text-ink' : 'text-success')}>
            {gap > 0 ? (
              <>
                <Money value={gap} compact /> to go
              </>
            ) : (
              <>
                <Money value={Math.abs(gap)} compact /> over
              </>
            )}
          </span>
        );
      },
      total: total.quota ? (
        <span className={cn(totalGap > 0 ? 'text-ink' : 'text-success')}>
          {totalGap > 0 ? (
            <>
              <Money value={totalGap} compact /> to go
            </>
          ) : (
            <>
              <Money value={Math.abs(totalGap)} compact /> over
            </>
          )}
        </span>
      ) : (
        <span className="text-ink-3">—</span>
      ),
    },
  ];

  const exportCsv = () => {
    if (!data) return;
    downloadCsv(
      `forecast-${data.scope.periodLabel.replace(/\s+/g, '-').toLowerCase()}`,
      ['Owner', 'Quota', 'Closed won', 'Won deals', 'Commit', 'Commit deals', 'Best case', 'Best case deals', 'Pipeline', 'Pipeline deals', 'Gap to quota'],
      [
        ...data.rows.map(row => [row.name, row.quota, row.won.amount, row.won.deals, row.commit.amount, row.commit.deals, row.bestCase.amount, row.bestCase.deals, row.pipeline.amount, row.pipeline.deals, gapFor(row)]),
        ['Total', total.quota, total.won, '', total.commit, '', total.bestCase, '', total.pipeline, '', totalGap],
      ],
    );
  };

  const isMine = controls.who.kind === 'me';

  return (
    <>
      <ControlBar
        onExport={data ? exportCsv : undefined}
        extra={
          <Segmented
            size="sm"
            value={isMine ? 'me' : 'team'}
            onChange={value => controls.set({ who: value === 'me' ? { kind: 'me' } : { kind: 'everyone' } })}
            options={[
              { value: 'me', label: 'My forecast' },
              { value: 'team', label: 'The team' },
            ]}
          />
        }
      />
      <PageBody className="flex flex-col gap-5">
        {query.isPending || !data ? (
          <Skeleton className="h-[360px] rounded-lg" />
        ) : (
          <>
            <Card>
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-line px-5 py-4 sm:px-6">
                <div>
                  <h3 className="text-title font-semibold text-ink">{data.scope.periodLabel} forecast</h3>
                  <p className="mt-0.5 text-meta text-ink-2">Won plus commit is the call. Open deals count when their close date falls in the period.</p>
                </div>
                <p className="tabular font-display text-display-sm text-ink">
                  <Money value={total.won + total.commit} compact />
                  <span className="ml-2 text-ui font-sans text-ink-2">called</span>
                </p>
              </div>
              <ReportTable
                rows={rows}
                columns={columns}
                getId={row => row.memberId}
                showTotal={rows.length > 1}
                totalLabel="All owners"
                highlightId={data.me}
                empty={
                  <EmptyState icon={<ChartPieSlice size={22} weight="duotone" />} title="Nothing to forecast yet" compact>
                    No deals close in {data.scope.periodLabel} for this filter, and nobody has a quota for it. Try a different period or widen the filters.
                  </EmptyState>
                }
              />
            </Card>

            <p className="text-meta text-ink-2">
              Commit, best case and pipeline come from each deal’s forecast category — set on the deal, or taken from its stage probability when nobody has set one. Click any figure to open the deals behind it.
            </p>
          </>
        )}
      </PageBody>
    </>
  );
}
