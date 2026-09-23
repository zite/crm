import { ArrowDown, Warning } from '@phosphor-icons/react';
import { Bar, BarChart, Legend } from 'recharts';
import { useNavigate } from 'react-router-dom';
import { Card, PageBody, Skeleton } from '../../ui/Layout';
import { cn } from '../../ui/cn';
import { Money } from '../../glyphs';
import { downloadCsv } from '../../lib/csv';
import { percent } from '../../lib/format';
import { useWorkspace } from '../../lib/workspace';
import { ControlBar } from './ControlBar';
import { BarList, ChartFrame, ChartTooltip, DrillValue, ResponsiveContainer, Tooltip, XAxis, YAxis, useAxes, useChartInk } from './charts';
import { useReportControls, useRequiredPipeline } from './controls';
import { openFilters, pushDealFilters } from './drill';
import { usePipelineReport } from './queries';

/**
 * The pipeline itself: how far deals get, how long each stage holds them, what
 * has gone quiet, and whether there is enough in flight to make the number.
 *
 * A funnel only means something inside one pipeline, so this report always has
 * one selected.
 */
export function PipelineReport() {
  const ws = useWorkspace();
  const navigate = useNavigate();
  const controls = useReportControls();
  const pipelineId = useRequiredPipeline();
  const ink = useChartInk();
  const axes = useAxes(ink);
  const query = usePipelineReport({ ...controls.query, pipelineId, view: 'pipeline' });
  const data = query.data;

  const openDeals = (filters: Parameters<typeof pushDealFilters>[0]) => {
    pushDealFilters({ ...filters, pipelineId });
    navigate('/deals');
  };

  const remaining = Math.max(0, (data?.summary.quota ?? 0) - (data?.summary.wonAmount ?? 0));
  const coverage = remaining > 0 ? (data?.summary.closingWeighted ?? 0) / remaining : null;
  const timing = data?.stageTiming ?? [];
  const stalled = (data?.stalledByStage ?? []).filter(stage => stage.deals > 0);
  const stalledTotal = stalled.reduce((total, stage) => total + stage.deals, 0);
  const months = data?.months ?? [];
  const noMonths = months.every(month => !month.createdAmount && !month.wonAmount && !month.lostAmount);

  const exportCsv = () => {
    if (!data) return;
    downloadCsv(
      `pipeline-${data.scope.periodLabel.replace(/\s+/g, '-').toLowerCase()}`,
      ['Stage', 'Deals reached', 'Value reached', 'Conversion to next', 'Average days in stage', 'Stalled deals', 'Open deals now', 'Open value now'],
      data.funnel.map((step, index) => {
        const next = data.funnel[index + 1];
        const stage = data.byStage.find(row => row.stageId === step.stageId);
        const time = data.stageTiming.find(row => row.stageId === step.stageId);
        const stuck = data.stalledByStage.find(row => row.stageId === step.stageId);
        return [
          step.stageName,
          step.reached,
          step.amount,
          next && step.reached ? percent(next.reached / step.reached, 1) : '',
          time?.avgDays ?? '',
          stuck?.deals ?? 0,
          stage?.deals ?? 0,
          stage?.amount ?? 0,
        ];
      }),
    );
  };

  return (
    <>
      <ControlBar onExport={data ? exportCsv : undefined} pipelineRequired />
      <PageBody className="flex flex-col gap-5">
        {query.isPending || !data ? (
          <div className="flex flex-col gap-5">
            <Skeleton className="h-[120px] rounded-lg" />
            <div className="grid gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
              <Skeleton className="h-[420px] rounded-lg" />
              <Skeleton className="h-[420px] rounded-lg" />
            </div>
            <Skeleton className="h-[300px] rounded-lg" />
          </div>
        ) : (
          <>
            <Card padded>
              <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-4">
                <div className="min-w-0">
                  <h3 className="text-micro font-semibold uppercase text-ink-3">Pipeline coverage · {data.scope.periodLabel}</h3>
                  <p className="tabular mt-1 font-display text-display text-ink">{coverage == null ? '—' : `${coverage.toFixed(1)}×`}</p>
                </div>
                <p className="min-w-[260px] max-w-xl flex-1 text-body text-ink-2 text-pretty">
                  {data.summary.quota <= 0 ? (
                    <>No quota is set for {data.scope.periodLabel}, so there is nothing to cover yet. Set one on Team &amp; quotas and this becomes the number to watch.</>
                  ) : remaining <= 0 ? (
                    <>
                      The number is already made: <Money value={data.summary.wonAmount} compact /> won against a <Money value={data.summary.quota} compact /> quota. Everything still open is upside.
                    </>
                  ) : (
                    <>
                      There is <Money value={data.summary.closingWeighted} compact /> of weighted pipeline due to close in {data.scope.periodLabel}, against <Money value={remaining} compact /> still to find.
                      That is <strong className="font-semibold text-ink">{coverage?.toFixed(1)}× cover</strong> — sales teams usually want about three times the gap, because most open deals won’t land.
                    </>
                  )}
                  {controls.pipelineId && ws.pipelines.filter(pipeline => !pipeline.archived).length > 1 && data.summary.quota > 0 && (
                    <span className="text-ink-3"> Quotas aren’t split by pipeline, so looking at one pipeline on its own understates the cover.</span>
                  )}
                </p>
              </div>
            </Card>

            <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
              <Card padded>
                <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <h3 className="text-title font-semibold text-ink">Stage funnel</h3>
                  <span className="tabular text-meta text-ink-3">{data.cohort.total === 1 ? '1 deal' : `${data.cohort.total} deals`} opened in {data.scope.periodLabel}</span>
                </div>
                <p className="mb-4 text-meta text-ink-2">Deals that opened in this period, and the furthest stage each one reached.</p>
                {data.cohort.total === 0 ? (
                  <p className="py-10 text-center text-meta text-ink-2">No deals opened in {data.scope.periodLabel}. Try a wider period.</p>
                ) : (
                  <ol className="flex flex-col">
                    {data.funnel.map((step, index) => {
                      const next = data.funnel[index + 1];
                      const conversion = next && step.reached ? next.reached / step.reached : null;
                      const width = data.funnel[0]?.reached ? (step.reached / data.funnel[0].reached) * 100 : 0;
                      return (
                        <li key={step.stageId}>
                          <div className="flex items-center gap-3 py-1">
                            <span className="w-[108px] shrink-0 truncate text-ui text-ink sm:w-[132px]">{step.stageName}</span>
                            <span className="h-8 min-w-0 flex-1 overflow-hidden rounded-sm bg-sunken">
                              <span className="flex h-full items-center justify-end rounded-sm bg-primary/80 px-2 animate-bar-in" style={{ width: `${Math.max(step.reached > 0 ? 8 : 0, width)}%` }}>
                                {step.reached > 0 && <span className="tabular text-meta font-medium text-on-primary">{step.reached}</span>}
                              </span>
                            </span>
                            <span className="tabular w-[84px] shrink-0 text-right text-ui text-ink-2">
                              <Money value={step.amount} compact />
                            </span>
                          </div>
                          {next && (
                            <div className="flex items-center gap-2 py-0.5 pl-[108px] text-meta text-ink-3 sm:pl-[132px]">
                              <ArrowDown size={12} />
                              <span className="tabular">{conversion == null ? '—' : percent(conversion)}</span>
                              <span>reached {next.stageName}</span>
                            </div>
                          )}
                        </li>
                      );
                    })}
                    <li className="mt-3 flex items-center justify-between gap-3 border-t border-line pt-3 text-ui">
                      <span className="text-ink-2">Of those, closed so far</span>
                      <span className="flex items-center gap-3">
                        <span className={cn('tabular', data.cohort.won ? 'text-success' : 'text-ink-3')}>{data.cohort.won} won</span>
                        <span className={cn('tabular', data.cohort.lost ? 'text-danger' : 'text-ink-3')}>{data.cohort.lost} lost</span>
                        <span className="tabular text-ink-3">{data.cohort.open} still open</span>
                      </span>
                    </li>
                  </ol>
                )}
              </Card>

              <div className="flex flex-col gap-5">
                <Card padded>
                  <h3 className="mb-1 text-title font-semibold text-ink">Time in stage</h3>
                  <p className="mb-3 text-meta text-ink-2">Average days a deal sat in each stage before moving on, for moves made in {data.scope.periodLabel}.</p>
                  <BarList
                    // A column of empty tracks reading "—  No moves" is worse than
                    // saying it once, so a period with no moves at all falls through
                    // to the empty label.
                    rows={(timing.some(stage => stage.moves > 0) ? timing : []).map(stage => ({
                      key: stage.stageId,
                      label: stage.stageName,
                      value: stage.avgDays ?? 0,
                      figure: stage.avgDays == null ? <span className="text-ink-3">—</span> : `${stage.avgDays}d`,
                      meta: stage.moves ? `${stage.moves} ${stage.moves === 1 ? 'move' : 'moves'}` : 'No moves',
                    }))}
                    emptyLabel="No stage moves in this period."
                  />
                </Card>

                <Card padded>
                  <div className="mb-1 flex items-baseline justify-between gap-3">
                    <h3 className="text-title font-semibold text-ink">Stalled deals</h3>
                    {stalledTotal > 0 && (
                      <span className="inline-flex items-center gap-1 text-meta text-warning">
                        <Warning size={13} /> {stalledTotal} stuck
                      </span>
                    )}
                  </div>
                  <p className="mb-3 text-meta text-ink-2">Open deals sitting past their stage’s day limit, right now.</p>
                  <BarList
                    rows={stalled.map(stage => ({
                      key: stage.stageId,
                      label: stage.stageName,
                      value: stage.deals,
                      figure: `${stage.deals}`,
                      meta: <Money value={stage.amount} compact />,
                      tone: 'warning' as const,
                    }))}
                    onSelect={stageId => openDeals({ status: ['Open'], stalled: true, stageIds: [stageId], ...(controls.query.ownerIds ? { ownerIds: controls.query.ownerIds } : {}) })}
                    emptyLabel="Nothing is stalled. Good."
                  />
                </Card>
              </div>
            </div>

            <ChartFrame title="Created and closed by month" hint="Value opened against value won and lost, over the last twelve months." height={260} empty={noMonths} emptyLabel="No deals opened or closed in the last twelve months for this filter.">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={months} margin={{ top: 4, right: 4, bottom: 0, left: 0 }} barGap={2}>
                  {axes.grid}
                  <XAxis dataKey="label" {...axes.xAxis} />
                  <YAxis {...axes.yAxis} tickFormatter={value => ws.money(Number(value), { compact: true })} />
                  <Tooltip
                    cursor={{ fill: ink.sunken }}
                    content={({ active, payload }) => {
                      const row = active && payload?.length ? (payload[0].payload as (typeof months)[number]) : null;
                      if (!row) return null;
                      return (
                        <ChartTooltip
                          title={row.label}
                          rows={[
                            { label: `Created (${row.createdCount})`, value: ws.money(row.createdAmount) },
                            { label: `Won (${row.wonCount})`, value: ws.money(row.wonAmount) },
                            { label: `Lost (${row.lostCount})`, value: ws.money(row.lostAmount) },
                          ]}
                        />
                      );
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12, color: ink.ink2, paddingTop: 8 }} iconType="square" iconSize={9} />
                  <Bar name="Created" dataKey="createdAmount" fill={ink.ink} radius={[3, 3, 0, 0]} maxBarSize={16} isAnimationActive={false} />
                  <Bar name="Won" dataKey="wonAmount" fill={ink.success} radius={[3, 3, 0, 0]} maxBarSize={16} isAnimationActive={false} />
                  <Bar name="Lost" dataKey="lostAmount" fill={ink.danger} radius={[3, 3, 0, 0]} maxBarSize={16} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </ChartFrame>

            <Card padded>
              <div className="mb-3 flex items-baseline justify-between gap-3">
                <h3 className="text-title font-semibold text-ink">Open right now, by stage</h3>
                <DrillValue onClick={() => openDeals(openFilters(data.scope.periodStart, data.scope.periodEnd, { ownerIds: controls.query.ownerIds }))} className={cn('text-meta text-ink-3')}>
                  {data.summary.openCount} open deals
                </DrillValue>
              </div>
              <BarList
                rows={data.byStage.map(stage => ({
                  key: stage.stageId,
                  label: stage.stageName,
                  value: stage.amount,
                  figure: <Money value={stage.amount} compact />,
                  meta: `${stage.deals} ${stage.deals === 1 ? 'deal' : 'deals'} · ${ws.money(stage.weighted, { compact: true })} weighted`,
                }))}
                onSelect={stageId => openDeals({ status: ['Open'], stageIds: [stageId], ...(controls.query.ownerIds ? { ownerIds: controls.query.ownerIds } : {}) })}
                emptyLabel="No open deals in this pipeline."
              />
            </Card>
          </>
        )}
      </PageBody>
    </>
  );
}
