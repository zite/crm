import { Bar, BarChart, Cell } from 'recharts';
import { UserPlus } from '@phosphor-icons/react';
import { useMemo } from 'react';
import { Card, EmptyState, PageBody, Skeleton } from '../../ui/Layout';
import { ProgressBar } from '../../ui/Progress';
import { cn } from '../../ui/cn';
import { Money } from '../../glyphs';
import { downloadCsv } from '../../lib/csv';
import { percent } from '../../lib/format';
import { useWorkspace } from '../../lib/workspace';
import { ControlBar } from './ControlBar';
import { BarList, ChartFrame, ChartTooltip, ResponsiveContainer, Tooltip, XAxis, YAxis, useAxes, useChartInk } from './charts';
import { useReportControls } from './controls';
import { ReportTable, type ReportColumn } from './ReportTable';
import { useLeadsReport } from './queries';
import type { ReportLeadsOutputType } from 'zitejs/api';

type SourceRow = ReportLeadsOutputType['bySource'][number];

/**
 * Inbound: where it comes from, what becomes of it, and how long people wait
 * for a reply. Leads are counted in the period they arrived, so a source's
 * conversion is always measured on the cohort it was counted in.
 */
export function LeadsReport() {
  const ws = useWorkspace();
  const controls = useReportControls();
  const ink = useChartInk();
  const axes = useAxes(ink);
  const query = useLeadsReport(controls.query);
  const data = query.data;

  const byWeek = useMemo(() => {
    const totals = new Map<string, number>();
    for (const cell of data?.cells ?? []) totals.set(cell.week, (totals.get(cell.week) ?? 0) + cell.leads);
    return (data?.weeks ?? []).map(week => ({ ...week, leads: totals.get(week.week) ?? 0 }));
  }, [data]);

  const perSourceWeek = useMemo(() => {
    const map = new Map<string, Map<string, number>>();
    for (const cell of data?.cells ?? []) {
      if (!map.has(cell.source)) map.set(cell.source, new Map());
      map.get(cell.source)!.set(cell.week, cell.leads);
    }
    return map;
  }, [data]);

  const thisWeek = useMemo(() => {
    const weeks = data?.weeks ?? [];
    const today = ws.today;
    return [...weeks].reverse().find(week => week.week <= today)?.week ?? null;
  }, [data, ws.today]);

  const funnel = data?.funnel;
  const peakWeek = Math.max(1, ...byWeek.map(week => week.leads));

  const columns: Array<ReportColumn<SourceRow>> = [
    { key: 'source', header: 'Source', width: '22%', sticky: true, cell: row => <span className="truncate">{row.source}</span> },
    { key: 'leads', header: 'Leads', align: 'right', width: '9%', cell: row => row.leads },
    {
      key: 'shape',
      header: 'By week',
      width: '20%',
      cell: row => {
        const weeks = perSourceWeek.get(row.source);
        return (
          <span className="flex h-6 items-end gap-px" role="img" aria-label={`${row.leads} leads across ${(data?.weeks ?? []).length} weeks`}>
            {(data?.weeks ?? []).map(week => {
              const count = weeks?.get(week.week) ?? 0;
              return <span key={week.week} className={cn('w-1.5 rounded-xs', count ? 'bg-primary/60' : 'bg-sunken')} style={{ height: `${count ? Math.max(12, (count / peakWeek) * 100) : 8}%` }} />;
            })}
          </span>
        );
      },
    },
    { key: 'worked', header: 'Worked', align: 'right', width: '10%', cell: row => <Rate value={row.worked} of={row.leads} /> },
    { key: 'qualified', header: 'Qualified', align: 'right', width: '11%', cell: row => <Rate value={row.qualified} of={row.leads} /> },
    { key: 'deals', header: 'Became a deal', align: 'right', width: '13%', cell: row => <Rate value={row.deals} of={row.leads} /> },
    { key: 'won', header: 'Won', align: 'right', width: '9%', cell: row => <Rate value={row.won} of={row.leads} /> },
    { key: 'value', header: 'Won value', align: 'right', width: '12%', cell: row => <Money value={row.wonAmount} compact muted0 /> },
  ];

  const exportCsv = () => {
    if (!data) return;
    downloadCsv(
      `leads-${data.scope.periodLabel.replace(/\s+/g, '-').toLowerCase()}`,
      ['Source', 'Leads', 'Worked', 'Qualified', 'Became a deal', 'Won', 'Won value'],
      [
        ...data.bySource.map(row => [row.source, row.leads, row.worked, row.qualified, row.deals, row.won, row.wonAmount]),
        ['All sources', data.funnel.leads, data.funnel.worked, data.funnel.qualified, data.funnel.deals, data.funnel.won, data.funnel.wonAmount],
      ],
    );
  };

  const steps = funnel
    ? [
        { key: 'leads', label: 'Arrived', value: funnel.leads },
        { key: 'worked', label: 'Picked up', value: funnel.worked },
        { key: 'qualified', label: 'Qualified', value: funnel.qualified },
        { key: 'deals', label: 'Became a deal', value: funnel.deals },
        { key: 'won', label: 'Won', value: funnel.won },
      ]
    : [];

  return (
    <>
      <ControlBar onExport={data ? exportCsv : undefined} />
      <PageBody className="flex flex-col gap-5">
        {query.isPending || !data ? (
          <div className="flex flex-col gap-5">
            <Skeleton className="h-[240px] rounded-lg" />
            <Skeleton className="h-[300px] rounded-lg" />
          </div>
        ) : data.funnel.leads === 0 ? (
          <Card padded>
            <EmptyState icon={<UserPlus size={22} weight="duotone" />} title="No leads arrived in this period" compact>
              Leads land here from web forms, imports and the New lead dialog. Try a wider period, or clear the filters.
            </EmptyState>
          </Card>
        ) : (
          <>
            <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
              <ChartFrame title="Leads by week" hint={`${data.funnel.leads} arrived in ${data.scope.periodLabel}. This week is in the pen.`} height={220}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={byWeek} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                    {axes.grid}
                    <XAxis dataKey="label" {...axes.xAxis} />
                    <YAxis {...axes.yAxis} width={32} allowDecimals={false} />
                    <Tooltip
                      cursor={{ fill: ink.sunken }}
                      content={({ active, payload }) => {
                        const row = active && payload?.length ? (payload[0].payload as (typeof byWeek)[number]) : null;
                        return row ? <ChartTooltip title={`Week of ${row.label}`} rows={[{ label: 'Leads', value: row.leads }]} /> : null;
                      }}
                    />
                    <Bar dataKey="leads" radius={[3, 3, 0, 0]} maxBarSize={40} isAnimationActive={false}>
                      {byWeek.map(week => (
                        <Cell key={week.week} fill={week.week === thisWeek ? ink.accent : ink.ink} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </ChartFrame>

              <Card padded>
                <h3 className="text-title font-semibold text-ink">Lead to won</h3>
                <p className="mb-4 mt-0.5 text-meta text-ink-2">Of the leads that arrived in {data.scope.periodLabel}.</p>
                <ol className="flex flex-col gap-3">
                  {steps.map((step, index) => {
                    const previous = steps[index - 1];
                    const share = steps[0].value ? step.value / steps[0].value : 0;
                    return (
                      <li key={step.key}>
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="text-ui text-ink">{step.label}</span>
                          <span className="tabular text-ui font-medium text-ink">
                            {step.value}
                            <span className="ml-1.5 text-meta font-normal text-ink-3">{percent(share)}</span>
                          </span>
                        </div>
                        <ProgressBar className="mt-1.5" value={step.value} max={steps[0].value || 1} tone={step.key === 'won' ? 'success' : 'ink'} height={6} />
                        {previous && previous.value > 0 && <p className="mt-1 text-meta text-ink-3">{percent(step.value / previous.value)} of {previous.label.toLowerCase()}</p>}
                      </li>
                    );
                  })}
                </ol>
                {data.funnel.wonAmount > 0 && (
                  <p className="mt-4 border-t border-line pt-3 text-meta text-ink-2">
                    Worth <Money value={data.funnel.wonAmount} compact className="font-medium text-ink" /> so far.
                  </p>
                )}
              </Card>
            </div>

            <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
              <Card>
                <div className="border-b border-line px-5 py-4 sm:px-6">
                  <h3 className="text-title font-semibold text-ink">By source</h3>
                  <p className="mt-0.5 text-meta text-ink-2">Every percentage is a share of the leads that source brought in.</p>
                </div>
                <ReportTable rows={data.bySource} columns={columns} getId={row => row.source} />
              </Card>

              <div className="flex flex-col gap-5">
                <Card padded>
                  <h3 className="text-title font-semibold text-ink">First response</h3>
                  <p className="mt-0.5 text-meta text-ink-2">Target is {data.response.targetHours} hours, set in Settings → General.</p>
                  <p className="tabular mt-4 font-display text-display-sm text-ink">{data.response.medianHours == null ? '—' : formatHours(data.response.medianHours)}</p>
                  <p className="text-meta text-ink-2">median wait{data.response.avgHours != null && <> · {formatHours(data.response.avgHours)} average</>}</p>
                  <div className="mt-4 flex flex-col gap-2 border-t border-line pt-3 text-ui">
                    <Line label={`Answered within ${data.response.targetHours}h`} value={data.response.withinTarget} total={data.funnel.leads} tone="success" />
                    <Line label="Answered later" value={Math.max(0, data.response.responded - data.response.withinTarget)} total={data.funnel.leads} tone="ink" />
                    <Line label="Never answered" value={data.response.unanswered} total={data.funnel.leads} tone={data.response.unanswered ? 'warning' : 'ink'} />
                  </div>
                </Card>

                <Card padded>
                  <h3 className="mb-1 text-title font-semibold text-ink">Disqualified</h3>
                  <p className="mb-3 text-meta text-ink-2">Why leads from this period were turned away.</p>
                  <BarList
                    rows={data.disqualified.map(reason => ({ key: reason.reason, label: reason.reason, value: reason.leads, figure: reason.leads, tone: 'ink' as const }))}
                    emptyLabel="Nothing was disqualified in this period."
                  />
                </Card>
              </div>
            </div>
          </>
        )}
      </PageBody>
    </>
  );
}

function Rate({ value, of }: { value: number; of: number }) {
  if (!of) return <span className="text-ink-3">—</span>;
  return (
    <span className="tabular">
      {value === 0 ? <span className="text-ink-3">0</span> : value}
      <span className="ml-1 text-meta text-ink-3">{percent(value / of)}</span>
    </span>
  );
}

function Line({ label, value, total, tone }: { label: string; value: number; total: number; tone: 'success' | 'ink' | 'warning' }) {
  const colour = { success: 'text-success', ink: 'text-ink', warning: 'text-warning' }[tone];
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="min-w-0 truncate text-ink-2">{label}</span>
      <span className={cn('tabular shrink-0 font-medium', colour)}>
        {value}
        {total > 0 && <span className="ml-1 text-meta font-normal text-ink-3">{percent(value / total)}</span>}
      </span>
    </div>
  );
}

function formatHours(hours: number) {
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours < 24) return `${Math.round(hours * 10) / 10}h`;
  return `${Math.round((hours / 24) * 10) / 10}d`;
}
