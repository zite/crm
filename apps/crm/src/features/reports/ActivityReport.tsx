import { PhoneCall } from '@phosphor-icons/react';
import { useMemo } from 'react';
import { Avatar } from '../../ui/Avatar';
import { Card, EmptyState, PageBody, Skeleton } from '../../ui/Layout';
import { Tooltip as UiTooltip } from '../../ui/Tooltip';
import { cn } from '../../ui/cn';
import { downloadCsv } from '../../lib/csv';
import { percent } from '../../lib/format';
import { useWorkspace } from '../../lib/workspace';
import { ControlBar } from './ControlBar';
import { useReportControls } from './controls';
import { ReportTable, type ReportColumn } from './ReportTable';
import { useActivityReport } from './queries';
import type { ReportActivityOutputType } from 'zitejs/api';

type Person = ReportActivityOutputType['people'][number];

/**
 * What the team actually did, week by week. It counts work — calls, emails,
 * meetings, notes — and puts the two numbers worth coaching on beside it:
 * meetings already in the diary, and how long a new lead waits for an answer.
 *
 * Deliberately not a leaderboard: no ranks, no colour-coded judgement, just the
 * shape of the weeks.
 */
export function ActivityReport() {
  const ws = useWorkspace();
  const controls = useReportControls();
  const query = useActivityReport(controls.query);
  const data = query.data;

  const cells = useMemo(() => {
    const map = new Map<string, number>();
    for (const cell of data?.cells ?? []) map.set(`${cell.memberId}|${cell.week}`, cell.total);
    return map;
  }, [data]);
  const peak = Math.max(1, ...[...cells.values()]);

  const totals = (data?.people ?? []).reduce(
    (sum, person) => ({
      calls: sum.calls + person.calls,
      emails: sum.emails + person.emails,
      meetings: sum.meetings + person.meetings,
      notes: sum.notes + person.notes,
      total: sum.total + person.total,
      upcoming: sum.upcoming + person.upcomingMeetings,
      leads: sum.leads + person.leadsReceived,
      answered: sum.answered + person.leadsResponded,
      onTime: sum.onTime + person.withinTarget,
    }),
    { calls: 0, emails: 0, meetings: 0, notes: 0, total: 0, upcoming: 0, leads: 0, answered: 0, onTime: 0 },
  );

  const columns: Array<ReportColumn<Person>> = [
    {
      key: 'person',
      header: 'Teammate',
      width: '24%',
      sticky: true,
      cell: person => (
        <span className="flex items-center gap-2.5">
          <Avatar person={person.member} size="xs" />
          <span className="min-w-0 truncate">{person.name}</span>
        </span>
      ),
    },
    { key: 'calls', header: 'Calls', align: 'right', width: '9%', cell: person => <Muted value={person.calls} />, total: totals.calls },
    { key: 'emails', header: 'Emails', align: 'right', width: '9%', cell: person => <Muted value={person.emails} />, total: totals.emails },
    { key: 'meetings', header: 'Meetings', align: 'right', width: '10%', cell: person => <Muted value={person.meetings} />, total: totals.meetings },
    { key: 'notes', header: 'Notes', align: 'right', width: '9%', cell: person => <Muted value={person.notes} />, total: totals.notes },
    { key: 'total', header: 'All logged', align: 'right', width: '10%', cell: person => <span className="font-medium">{person.total.toLocaleString('en-US')}</span>, total: totals.total },
    { key: 'upcoming', header: 'Meetings booked', align: 'right', width: '13%', cell: person => <Muted value={person.upcomingMeetings} />, total: totals.upcoming },
    {
      key: 'response',
      header: 'First response',
      align: 'right',
      width: '16%',
      cell: person =>
        person.leadsReceived === 0 ? (
          <span className="text-ink-3">No leads</span>
        ) : person.avgResponseHours == null ? (
          <span className="text-warning">{person.leadsReceived} waiting</span>
        ) : (
          <span className={cn('tabular', person.avgResponseHours > (data?.targetHours ?? 24) && 'text-warning')}>
            {formatHours(person.avgResponseHours)}
            <span className="ml-1 text-meta text-ink-3">
              ({person.leadsResponded}/{person.leadsReceived})
            </span>
          </span>
        ),
      total: totals.leads ? (
        <span className="tabular">
          {totals.answered} of {totals.leads} answered
        </span>
      ) : (
        '—'
      ),
    },
  ];

  const exportCsv = () => {
    if (!data) return;
    downloadCsv(
      `activity-${data.scope.periodLabel.replace(/\s+/g, '-').toLowerCase()}`,
      ['Teammate', 'Calls', 'Emails', 'Meetings', 'Notes', 'All logged', 'Meetings booked ahead', 'Leads received', 'Leads answered', 'Average first response (hours)', `Answered within ${data.targetHours}h`],
      data.people.map(person => [person.name, person.calls, person.emails, person.meetings, person.notes, person.total, person.upcomingMeetings, person.leadsReceived, person.leadsResponded, person.avgResponseHours ?? '', person.withinTarget]),
    );
  };

  return (
    <>
      <ControlBar onExport={data ? exportCsv : undefined} />
      <PageBody className="flex flex-col gap-5">
        {query.isPending || !data ? (
          <div className="flex flex-col gap-5">
            <Skeleton className="h-[280px] rounded-lg" />
            <Skeleton className="h-[280px] rounded-lg" />
          </div>
        ) : data.people.length === 0 ? (
          <Card padded>
            <EmptyState icon={<PhoneCall size={22} weight="duotone" />} title="Nothing logged in this period" compact>
              Calls, emails, meetings and notes show up here as soon as the team logs them. Try a wider period, or clear the filters.
            </EmptyState>
          </Card>
        ) : (
          <>
            <Card padded>
              <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <h3 className="text-title font-semibold text-ink">Logged by week</h3>
                <span className="tabular text-meta text-ink-3">{totals.total.toLocaleString('en-US')} activities in {data.scope.periodLabel}</span>
              </div>
              <p className="mb-4 text-meta text-ink-2">Every call, email, meeting and note, by the week it happened. The busier the week, the stronger the block.</p>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] border-collapse">
                  <thead>
                    <tr className="text-micro font-semibold uppercase text-ink-3">
                      <th scope="col" className="sticky left-0 z-10 bg-card py-1 pr-3 text-left">
                        Teammate
                      </th>
                      {data.weeks.map(week => (
                        <th key={week.week} scope="col" className="px-1 py-1 text-center font-semibold">
                          {week.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.people.map(person => (
                      <tr key={person.memberId}>
                        <th scope="row" className="sticky left-0 z-10 bg-card py-1 pr-3 text-left text-ui font-normal text-ink">
                          <span className="flex items-center gap-2">
                            <Avatar person={person.member} size="xs" />
                            <span className="min-w-0 max-w-[140px] truncate">{person.name}</span>
                          </span>
                        </th>
                        {data.weeks.map(week => {
                          const count = cells.get(`${person.memberId}|${week.week}`) ?? 0;
                          // The wash tops out at 0.34 so ink text stays readable on the
                          // busiest cell in both themes — a heat map nobody can read is
                          // just decoration.
                          const intensity = count ? 0.08 + (count / peak) * 0.26 : 0;
                          return (
                            <td key={week.week} className="p-0.5">
                              <UiTooltip content={`${person.name} · week of ${week.label} · ${count} logged`}>
                                <div
                                  className={cn('tabular flex h-9 items-center justify-center rounded-sm text-meta text-ink', count === 0 && 'bg-sunken text-ink-3')}
                                  style={count ? { backgroundColor: `rgb(var(--primary) / ${intensity.toFixed(2)})` } : undefined}
                                >
                                  {count || '·'}
                                </div>
                              </UiTooltip>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            <Card>
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-line px-5 py-4 sm:px-6">
                <div>
                  <h3 className="text-title font-semibold text-ink">Per person</h3>
                  <p className="mt-0.5 text-meta text-ink-2">
                    Meetings booked counts meetings still ahead of today. First response is the average wait on leads assigned to a teammate in {data.scope.periodLabel} — the target is {data.targetHours}h.
                  </p>
                </div>
                {totals.leads > 0 && (
                  <p className="tabular shrink-0 text-right text-ui text-ink-2">
                    <span className="font-display text-display-sm text-ink">{percent(totals.onTime / totals.leads)}</span> answered within {data.targetHours}h
                    <span className="block text-meta text-ink-3">
                      {totals.onTime} of {totals.leads} assigned leads
                    </span>
                  </p>
                )}
              </div>
              <ReportTable rows={data.people} columns={columns} getId={person => person.memberId} showTotal={data.people.length > 1} totalLabel="Everyone" highlightId={ws.me.id} />
            </Card>
          </>
        )}
      </PageBody>
    </>
  );
}

function Muted({ value }: { value: number }) {
  return value === 0 ? <span className="text-ink-3">·</span> : <>{value.toLocaleString('en-US')}</>;
}

/** '3.5h' under a day, '1.4d' above it — nobody reads 34 hours as a day and a half. */
function formatHours(hours: number) {
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours < 24) return `${Math.round(hours * 10) / 10}h`;
  return `${Math.round((hours / 24) * 10) / 10}d`;
}
