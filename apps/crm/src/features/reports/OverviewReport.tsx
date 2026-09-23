import { Bar, BarChart, Cell } from 'recharts';
import { useNavigate } from 'react-router-dom';
import { Badge } from '../../ui/Chip';
import { Card, PageBody, Skeleton } from '../../ui/Layout';
import { ProgressBar } from '../../ui/Progress';
import { Money } from '../../glyphs';
import { downloadCsv } from '../../lib/csv';
import { percent } from '../../lib/format';
import { useWorkspace } from '../../lib/workspace';
import { ControlBar } from './ControlBar';
import { BarList, ChartFrame, ChartTooltip, DrillValue, ResponsiveContainer, Tooltip, XAxis, YAxis, useAxes, useChartInk } from './charts';
import { useReportControls } from './controls';
import { lostFilters, openFilters, pushDealFilters, wonFilters } from './drill';
import { usePipelineReport } from './queries';

/**
 * The first screen a sales lead opens: what is in flight, what landed, and
 * whether the number is going to be made. Everything below the figures is a
 * way into the deals behind them.
 */
export function OverviewReport() {
  const ws = useWorkspace();
  const navigate = useNavigate();
  const controls = useReportControls();
  const ink = useChartInk();
  const axes = useAxes(ink);
  const query = usePipelineReport({ ...controls.query, view: 'overview' });
  const data = query.data;

  const openDeals = (filters: Parameters<typeof pushDealFilters>[0]) => {
    pushDealFilters(filters);
    navigate('/deals');
  };

  const summary = data?.summary;
  const closed = (summary?.wonCount ?? 0) + (summary?.lostCount ?? 0);
  const winRate = closed ? (summary?.wonCount ?? 0) / closed : null;
  const avgDeal = summary?.wonCount ? (summary.wonAmount ?? 0) / summary.wonCount : null;
  const attainment = summary?.quota ? (summary.wonAmount ?? 0) / summary.quota : null;
  const toGo = Math.max(0, (summary?.quota ?? 0) - (summary?.wonAmount ?? 0));

  const exportCsv = () => {
    if (!data) return;
    downloadCsv(
      `overview-${data.scope.periodLabel.replace(/\s+/g, '-').toLowerCase()}`,
      ['Figure', 'Value'],
      [
        ['Period', data.scope.periodLabel],
        ['Open pipeline', data.summary.openAmount],
        ['Open pipeline (weighted)', data.summary.openWeighted],
        ['Closing this period', data.summary.closingAmount],
        ['Won', data.summary.wonAmount],
        ['Won deals', data.summary.wonCount],
        ['Lost', data.summary.lostAmount],
        ['Lost deals', data.summary.lostCount],
        ['Quota', data.summary.quota],
        ['Win rate', winRate == null ? '' : percent(winRate, 1)],
        ['Average deal size', avgDeal == null ? '' : Math.round(avgDeal)],
        ['Average sales cycle (days)', data.summary.cycleDays ?? ''],
        ...data.byStage.map(stage => [`Stage · ${stage.pipelineName} · ${stage.stageName}`, stage.amount] as Array<string | number>),
        ...data.lostByReason.map(reason => [`Lost · ${reason.reason}`, reason.amount] as Array<string | number>),
      ],
    );
  };

  const months = data?.months ?? [];
  const noWon = months.every(month => month.wonAmount === 0);

  return (
    <>
      <ControlBar onExport={data ? exportCsv : undefined} />
      <PageBody className="flex flex-col gap-5">
        {query.isPending || !data ? (
          <OverviewSkeleton />
        ) : (
          <>
            <div className="flex flex-col gap-5 lg:flex-row lg:items-stretch">
              <div className="flex min-w-0 flex-1 flex-col gap-5">
                <p className="font-display text-[26px] leading-9 text-ink sm:text-display-sm">
                  <DrillValue onClick={() => openDeals({ status: ['Open'], ...(controls.pipelineId ? { pipelineId: controls.pipelineId } : {}) })} className="font-display">
                    <Money value={data.summary.openAmount} compact />
                  </DrillValue>{' '}
                  <span className="text-ink-2">open pipeline</span> <span className="text-ink-3">·</span> <Money value={data.summary.openWeighted} compact className="font-display" />{' '}
                  <span className="text-ink-2">weighted</span>
                </p>

                <div className="grid flex-1 gap-px overflow-hidden rounded-lg border border-line bg-line shadow-hairline sm:grid-cols-2 xl:grid-cols-4">
                  <Figure
                    label={`Won · ${data.scope.periodLabel}`}
                    value={<Money value={data.summary.wonAmount} compact />}
                    hint={`${data.summary.wonCount === 1 ? '1 deal' : `${data.summary.wonCount} deals`} closed`}
                    onClick={() => openDeals(wonFilters(data.scope.periodStart, data.scope.periodEnd, controls.query.ownerIds))}
                  />
                  <Figure
                    label="Win rate"
                    value={winRate == null ? '—' : percent(winRate)}
                    hint={closed ? `${data.summary.wonCount} of ${closed} closed` : 'Nothing closed yet'}
                    onClick={closed ? () => openDeals({ status: ['Won', 'Lost'], closedFrom: data.scope.periodStart, closedTo: data.scope.periodEnd, ...(controls.query.ownerIds ? { ownerIds: controls.query.ownerIds } : {}) }) : undefined}
                  />
                  <Figure label="Average deal" value={avgDeal == null ? '—' : <Money value={Math.round(avgDeal)} compact />} hint={avgDeal == null ? 'No deals won yet' : 'Of the deals won'} />
                  <Figure
                    label="Sales cycle"
                    value={data.summary.cycleDays == null ? '—' : `${data.summary.cycleDays}d`}
                    hint={data.summary.cycleSample ? `Open to won, ${data.summary.cycleSample === 1 ? '1 deal' : `${data.summary.cycleSample} deals`}` : 'Needs a won deal'}
                  />
                </div>
              </div>

              <Card className="w-full shrink-0 p-5 sm:p-6 lg:w-[320px]">
                <h3 className="text-title font-semibold text-ink">Against quota</h3>
                <p className="mt-0.5 text-meta text-ink-2">{controls.whoLabel === 'Everyone' ? 'Everyone’s targets for this period' : `${controls.whoLabel} · ${data.scope.periodLabel}`}</p>
                {data.summary.quota > 0 ? (
                  <>
                    <p className="tabular mt-4 font-display text-display-sm text-ink">{attainment == null ? '—' : percent(attainment)}</p>
                    <ProgressBar className="mt-2" value={data.summary.wonAmount} max={data.summary.quota} tone={(attainment ?? 0) >= 1 ? 'success' : 'ink'} height={8} />
                    <p className="mt-2 text-meta text-ink-2">
                      <Money value={data.summary.wonAmount} compact /> of <Money value={data.summary.quota} compact />
                      {toGo > 0 && (
                        <>
                          {' '}
                          · <Money value={toGo} compact /> to go
                        </>
                      )}
                    </p>
                    <div className="mt-4 border-t border-line pt-3 text-meta text-ink-2">
                      <div className="flex items-baseline justify-between gap-2">
                        <span>Closing this period</span>
                        <DrillValue onClick={() => openDeals(openFilters(data.scope.periodStart, data.scope.periodEnd, { ownerIds: controls.query.ownerIds, pipelineId: controls.pipelineId }))} className="font-medium text-ink">
                          <Money value={data.summary.closingAmount} compact />
                        </DrillValue>
                      </div>
                      <div className="mt-1 flex items-baseline justify-between gap-2">
                        <span>Weighted</span>
                        <span className="tabular font-medium text-ink">
                          <Money value={data.summary.closingWeighted} compact />
                        </span>
                      </div>
                    </div>
                  </>
                ) : (
                  <p className="mt-4 text-body text-ink-2">
                    No quota is set for {data.scope.periodLabel}.{' '}
                    {ws.can('quotas.manage') ? (
                      <button type="button" className="text-accent underline decoration-accent/40 underline-offset-[3px] hover:decoration-accent" onClick={() => navigate('/reports/team')}>
                        Set one on Team & quotas
                      </button>
                    ) : (
                      'Ask a manager to set one.'
                    )}
                  </p>
                )}
              </Card>
            </div>

            <ChartFrame
              title="Won revenue by month"
              hint={months.some(month => month.month === data.currentMonth) ? 'The last twelve months. This month is in the pen.' : `The twelve months to ${months[months.length - 1]?.label ?? ''}.`}
              height={230}
              empty={noWon}
              emptyLabel="Nothing has been won in the last twelve months for this filter."
            >
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={months} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
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
                            { label: 'Won', value: ws.money(row.wonAmount) },
                            { label: 'Deals', value: row.wonCount },
                            { label: 'Lost', value: ws.money(row.lostAmount) },
                          ]}
                        />
                      );
                    }}
                  />
                  <Bar dataKey="wonAmount" radius={[3, 3, 0, 0]} maxBarSize={44} isAnimationActive={false}>
                    {months.map(month => (
                      <Cell key={month.month} fill={month.month === data.currentMonth ? ink.accent : ink.ink} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </ChartFrame>

            <div className="grid items-start gap-5 lg:grid-cols-2">
              <Card padded>
                <div className="mb-1 flex items-baseline justify-between gap-3">
                  <h3 className="text-title font-semibold text-ink">Open pipeline by stage</h3>
                  <span className="tabular text-meta text-ink-3">{data.summary.openCount} deals</span>
                </div>
                <p className="mb-3 text-meta text-ink-2">Everything open right now — not just what closes in {data.scope.periodLabel}.</p>
                <BarList
                  rows={data.byStage.map(stage => ({
                    key: stage.stageId,
                    label: ws.pipelines.filter(pipeline => !pipeline.archived).length > 1 && !controls.pipelineId ? `${stage.stageName} · ${stage.pipelineName}` : stage.stageName,
                    value: stage.amount,
                    figure: <Money value={stage.amount} compact />,
                    meta: `${stage.deals} ${stage.deals === 1 ? 'deal' : 'deals'} · ${ws.money(stage.weighted, { compact: true })} weighted`,
                  }))}
                  onSelect={stageId => openDeals({ status: ['Open'], stageIds: [stageId], ...(controls.query.ownerIds ? { ownerIds: controls.query.ownerIds } : {}) })}
                  emptyLabel="No open deals match these filters."
                />
              </Card>

              <Card padded>
                <div className="mb-3 flex items-baseline justify-between gap-3">
                  <h3 className="text-title font-semibold text-ink">Won and lost</h3>
                  <span className="text-meta text-ink-3">{data.scope.periodLabel}</span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="success">
                    {data.summary.wonCount} won · {ws.money(data.summary.wonAmount, { compact: true })}
                  </Badge>
                  <Badge tone="danger">
                    {data.summary.lostCount} lost · {ws.money(data.summary.lostAmount, { compact: true })}
                  </Badge>
                </div>
                {/* An empty track when nothing closed is decoration, not a split. */}
                {closed > 0 && (
                  <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-sunken" role="img" aria-label={`${data.summary.wonCount} won, ${data.summary.lostCount} lost, by deal count`}>
                    <span className="bg-success" style={{ width: `${(data.summary.wonCount / closed) * 100}%` }} />
                    <span className="bg-danger" style={{ width: `${(data.summary.lostCount / closed) * 100}%` }} />
                  </div>
                )}
                <h4 className="mb-1 mt-5 text-micro font-semibold uppercase text-ink-3">Why deals were lost</h4>
                <BarList
                  rows={data.lostByReason.map(reason => ({
                    key: reason.reason,
                    label: reason.reason,
                    value: reason.amount,
                    figure: <Money value={reason.amount} compact />,
                    meta: `${reason.deals} ${reason.deals === 1 ? 'deal' : 'deals'}`,
                    tone: 'danger' as const,
                  }))}
                  onSelect={reason => openDeals(lostFilters(data.scope.periodStart, data.scope.periodEnd, controls.query.ownerIds, reason === 'No reason given' ? undefined : [reason]))}
                  emptyLabel="Nothing was lost in this period."
                />
              </Card>
            </div>
          </>
        )}
      </PageBody>
    </>
  );
}

function Figure({ label, value, hint, onClick }: { label: string; value: React.ReactNode; hint?: string; onClick?: () => void }) {
  const inner = (
    <>
      <div className="text-micro font-semibold uppercase text-ink-3">{label}</div>
      <div className="tabular mt-1 font-display text-[26px] leading-8 text-ink">{value}</div>
      <div className="mt-0.5 min-h-[18px] text-meta text-ink-2">{hint}</div>
    </>
  );
  const shell = 'flex flex-col justify-center bg-card px-5 py-4';
  return onClick ? (
    <button type="button" onClick={onClick} className={`${shell} text-left transition-colors hover:bg-hover/60`}>
      {inner}
    </button>
  ) : (
    <div className={shell}>{inner}</div>
  );
}

function OverviewSkeleton() {
  return (
    <div className="flex flex-col gap-5">
      <Skeleton className="h-9 w-[420px] max-w-full" />
      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <div className="grid gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="bg-card px-5 py-4">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="mt-2 h-7 w-24" />
              <Skeleton className="mt-2 h-3 w-16" />
            </div>
          ))}
        </div>
        <Skeleton className="h-[180px] rounded-lg" />
      </div>
      <Skeleton className="h-[290px] rounded-lg" />
      <div className="grid gap-5 lg:grid-cols-2">
        <Skeleton className="h-[260px] rounded-lg" />
        <Skeleton className="h-[260px] rounded-lg" />
      </div>
    </div>
  );
}
