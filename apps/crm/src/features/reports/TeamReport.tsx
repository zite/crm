import { Target } from '@phosphor-icons/react';
import { useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { Avatar } from '../../ui/Avatar';
import { Button } from '../../ui/Button';
import { Card, EmptyState, PageBody, Skeleton } from '../../ui/Layout';
import { Menu, MenuContent, MenuLabel, MenuRadioGroup, MenuRadioItem, MenuTrigger } from '../../ui/Menu';
import { cn } from '../../ui/cn';
import { Money } from '../../glyphs';
import { downloadCsv } from '../../lib/csv';
import { percent } from '../../lib/format';
import { useWorkspace } from '../../lib/workspace';
import { ControlBar } from './ControlBar';
import { DrillValue } from './charts';
import { useReportControls } from './controls';
import { pushDealFilters, wonFilters } from './drill';
import { QuotaEditor } from './QuotaEditor';
import { useTeamReport } from './queries';

const METRICS = ['Revenue', 'Deals Won', 'Meetings', 'Calls'] as const;
type Metric = (typeof METRICS)[number];

/**
 * Attainment, and the place quotas are set. Each rep gets a bar and the number
 * beside it — the bar is the shape, the figure is the fact, so nobody has to
 * read a colour to know where they stand.
 */
export function TeamReport() {
  const ws = useWorkspace();
  const navigate = useNavigate();
  const controls = useReportControls();
  const [metric, setMetric] = useState<Metric>('Revenue');
  const query = useTeamReport({ ...controls.query, metric });
  const data = query.data;
  const rows = data?.rows ?? [];
  const canManage = ws.can('quotas.manage');

  const money = metric === 'Revenue';
  const figure = (value: number) => (money ? <Money value={value} compact /> : value.toLocaleString('en-US'));

  const totals = rows.reduce((sum, row) => ({ quota: sum.quota + row.quota, actual: sum.actual + row.actual }), { quota: 0, actual: 0 });

  const exportCsv = () => {
    if (!data) return;
    downloadCsv(
      `attainment-${metric.replace(/\s+/g, '-').toLowerCase()}-${data.scope.periodLabel.replace(/\s+/g, '-').toLowerCase()}`,
      ['Teammate', `Quota (${metric})`, `Actual (${metric})`, 'Attainment', 'Deals won', 'Won value', 'Open pipeline', 'Open weighted'],
      data.rows.map(row => [row.name, row.quota, row.actual, row.quota ? percent(row.actual / row.quota, 1) : '', row.wonDeals, row.wonAmount, row.openAmount, row.openWeighted]),
    );
  };

  return (
    <>
      <ControlBar
        onExport={data ? exportCsv : undefined}
        extra={
          <Menu>
            <MenuTrigger asChild>
              <Button variant="secondary" size="sm" leading={<Target size={15} />}>
                {metric}
              </Button>
            </MenuTrigger>
            <MenuContent align="end">
              <MenuLabel>Measure against</MenuLabel>
              <MenuRadioGroup value={metric} onValueChange={value => setMetric(value as Metric)}>
                {METRICS.map(option => (
                  <MenuRadioItem key={option} value={option}>
                    {option}
                  </MenuRadioItem>
                ))}
              </MenuRadioGroup>
            </MenuContent>
          </Menu>
        }
      />
      <PageBody className="flex flex-col gap-5">
        {query.isPending || !data ? (
          <div className="flex flex-col gap-5">
            <Skeleton className="h-[320px] rounded-lg" />
            <Skeleton className="h-[280px] rounded-lg" />
          </div>
        ) : (
          <>
            <Card padded>
              <div className="mb-5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <div>
                  <h3 className="text-title font-semibold text-ink">Attainment · {data.scope.periodLabel}</h3>
                  <p className="mt-0.5 text-meta text-ink-2">{metric === 'Revenue' ? 'Closed-won value against each quota.' : metric === 'Deals Won' ? 'Deals closed won against each quota.' : `${metric} logged against each quota.`}</p>
                </div>
                {totals.quota > 0 && (
                  <p className="tabular text-ui text-ink-2">
                    <span className="font-display text-display-sm text-ink">{percent(totals.actual / totals.quota)}</span> of {money ? ws.money(totals.quota, { compact: true }) : totals.quota.toLocaleString('en-US')} across the team
                  </p>
                )}
              </div>

              {rows.length === 0 ? (
                <EmptyState icon={<Target size={22} weight="duotone" />} title="Nobody to show yet" compact>
                  No quotas are set and nothing has been closed in {data.scope.periodLabel} for this filter.
                </EmptyState>
              ) : (
                <ul className="flex flex-col gap-4">
                  {rows.map(row => {
                    const attainment = row.quota ? row.actual / row.quota : null;
                    const made = attainment != null && attainment >= 1;
                    return (
                      <li key={row.memberId} className={cn('rounded-md px-1 py-1', row.memberId === data.me && 'bg-accent/[0.07] dark:bg-accent/10')}>
                        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                          <span className="flex min-w-0 items-center gap-2.5">
                            <Avatar person={row.member} size="xs" />
                            <span className="truncate text-ui text-ink">{row.name}</span>
                            {row.memberId === data.me && <span className="text-meta text-ink-3">You</span>}
                          </span>
                          <span className="tabular shrink-0 text-ui text-ink">
                            {metric === 'Revenue' ? (
                              <DrillValue
                                onClick={
                                  row.wonDeals
                                    ? () => {
                                        pushDealFilters(wonFilters(data.scope.periodStart, data.scope.periodEnd, [row.memberId]));
                                        navigate('/deals');
                                      }
                                    : undefined
                                }
                              >
                                {figure(row.actual)}
                              </DrillValue>
                            ) : (
                              figure(row.actual)
                            )}
                            <span className="text-ink-3"> of </span>
                            {row.quota ? figure(row.quota) : <span className="text-ink-3">no quota</span>}
                            {attainment != null && <span className={cn('ml-2 font-medium', made ? 'text-success' : 'text-ink-2')}>{percent(attainment)}</span>}
                          </span>
                        </div>
                        {row.quota > 0 ? (
                          <div
                            className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-sunken"
                            role="img"
                            aria-label={`${percent(attainment ?? 0)} of quota`}
                            title={`${money ? ws.money(row.actual) : row.actual} of ${money ? ws.money(row.quota) : row.quota}`}
                          >
                            <span className={cn('block h-full rounded-full animate-bar-in', made ? 'bg-success' : 'bg-primary/70')} style={{ width: `${Math.min(100, (attainment ?? 0) * 100)}%` }} />
                          </div>
                        ) : (
                          <div className="mt-2 h-2.5 w-full rounded-full border border-dashed border-line-strong" role="img" aria-label="No quota set" />
                        )}
                        <p className="mt-1 text-meta text-ink-3">
                          {row.wonDeals === 1 ? '1 deal won' : `${row.wonDeals} deals won`} · <Money value={row.openAmount} compact /> open, <Money value={row.openWeighted} compact /> weighted
                        </p>
                      </li>
                    );
                  })}
                </ul>
              )}
              {totals.quota > 0 ? (
                <p className="mt-5 border-t border-line pt-3 text-meta text-ink-3">Each bar runs from nothing to that person’s own quota, so the lengths show attainment rather than deal size.</p>
              ) : (
                rows.length > 0 && <p className="mt-5 border-t border-line pt-3 text-meta text-ink-3">Nobody has a quota for {data.scope.periodLabel}, so there is nothing to measure against yet.</p>
              )}
            </Card>

            {canManage ? (
              <QuotaEditor period={controls.period} periodStart={controls.from} metric={metric} today={ws.today} />
            ) : (
              <p className="text-meta text-ink-2">Only managers and admins can set quotas. Yours is shown above.</p>
            )}
          </>
        )}
      </PageBody>
    </>
  );
}
