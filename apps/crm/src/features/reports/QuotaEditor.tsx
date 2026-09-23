import { ArrowsClockwise } from '@phosphor-icons/react';
import { useEffect, useMemo, useState } from 'react';
import { Avatar } from '../../ui/Avatar';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Layout';
import { Input } from '../../ui/Form';
import { Badge } from '../../ui/Chip';
import { cn } from '../../ui/cn';
import { useWorkspace } from '../../lib/workspace';
import { useQuotas, useSaveQuota } from './queries';
import type { PeriodKind } from '@project/shared/dates';
import type { ListQuotasOutputType } from 'zitejs/api';

type QuotaRow = ListQuotasOutputType['rows'][number];
type Metric = 'Revenue' | 'Deals Won' | 'Meetings' | 'Calls';

/**
 * Setting the numbers. One period, one metric, every teammate in a column of
 * inputs — edit as many as you like and save once, because a quota round is a
 * single decision, not twelve.
 *
 * An empty field clears the quota rather than storing a zero, so "no target"
 * and "a target of nothing" stay different things.
 */
export function QuotaEditor({ period, periodStart, metric, today }: { period: PeriodKind; periodStart: string; metric: Metric; today: string }) {
  const ws = useWorkspace();
  const query = useQuotas({ period, periodStart, metric, today });
  const save = useSaveQuota();
  const data = query.data;

  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const signature = `${period}|${periodStart}|${metric}`;
  const [loadedFor, setLoadedFor] = useState('');

  // Reload the inputs whenever the period or metric changes — and after a save,
  // so the fields show what the server actually kept.
  useEffect(() => {
    if (!data) return;
    const key = `${signature}|${query.dataUpdatedAt}`;
    if (loadedFor === key) return;
    setDrafts(Object.fromEntries(data.rows.map(row => [row.memberId, row.target == null ? '' : row.target.toLocaleString('en-US')])));
    setLoadedFor(key);
  }, [data, signature, query.dataUpdatedAt, loadedFor]);

  const rows = data?.rows ?? [];
  const parsed = useMemo(() => {
    const out = new Map<string, number | null>();
    for (const row of rows) {
      const raw = (drafts[row.memberId] ?? '').replace(/[,$\s]/g, '').trim();
      out.set(row.memberId, raw === '' ? null : Number(raw));
    }
    return out;
  }, [drafts, rows]);

  const invalid = rows.filter(row => {
    const value = parsed.get(row.memberId);
    return value != null && (!Number.isFinite(value) || value < 0);
  });
  const changed = rows.filter(row => {
    const value = parsed.get(row.memberId);
    return (value ?? null) !== (row.target ?? null) && !(value != null && !Number.isFinite(value));
  });

  const money = metric === 'Revenue';
  const unit = metric === 'Revenue' ? ws.settings.currency : metric === 'Deals Won' ? 'deals' : metric.toLowerCase();

  const copyPrevious = () => {
    if (!data) return;
    setDrafts(current => {
      const next = { ...current };
      for (const row of data.rows) next[row.memberId] = row.previousTarget == null ? '' : row.previousTarget.toLocaleString('en-US');
      return next;
    });
  };

  const submit = () => {
    if (!data || !changed.length || invalid.length) return;
    save.mutate({
      period,
      periodStart,
      metric,
      today,
      entries: changed.map(row => ({ memberId: row.memberId, target: parsed.get(row.memberId) ?? null })),
    });
  };

  const hasPrevious = rows.some(row => row.previousTarget != null);

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 border-b border-line px-5 py-4 sm:px-6">
        <div className="min-w-0">
          <h3 className="text-title font-semibold text-ink">Quotas · {data?.periodLabel ?? ''}</h3>
          <p className="mt-0.5 text-meta text-ink-2">
            {metric} targets per teammate. Leave a field empty for no quota.{' '}
            {money ? 'Amounts are in whole ' + ws.settings.currency + '.' : ''}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="secondary" size="sm" leading={<ArrowsClockwise size={15} />} disabled={!hasPrevious} onClick={copyPrevious} title={hasPrevious ? undefined : 'Nothing was set last period'}>
            Copy {data?.previousLabel ?? 'last period'}
          </Button>
          <Button variant="primary" size="sm" disabled={!changed.length || invalid.length > 0} loading={save.isPending} onClick={submit}>
            {changed.length ? `Save ${changed.length === 1 ? '1 quota' : `${changed.length} quotas`}` : 'Save quotas'}
          </Button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] border-collapse text-ui">
          <thead>
            <tr className="bg-sunken text-micro font-semibold uppercase text-ink-3">
              <th scope="col" className="h-9 px-3 text-left font-semibold">
                Teammate
              </th>
              <th scope="col" className="h-9 px-3 text-left font-semibold">
                Role
              </th>
              <th scope="col" className="h-9 px-3 text-right font-semibold">
                {data?.previousLabel ?? 'Last period'}
              </th>
              <th scope="col" className="h-9 px-3 text-right font-semibold">
                Target
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map(row => {
              const value = parsed.get(row.memberId);
              const bad = value != null && (!Number.isFinite(value) || value < 0);
              const isChanged = changed.some(other => other.memberId === row.memberId);
              return (
                <tr key={row.memberId} className="h-[46px] border-b border-line last:border-b-0">
                  <td className="px-3">
                    <span className="flex items-center gap-2.5">
                      <Avatar person={row.member} size="xs" />
                      <span className="min-w-0 truncate">{row.name}</span>
                    </span>
                  </td>
                  <td className="px-3">
                    <Badge tone={row.role === 'Viewer' ? 'neutral' : 'neutral'}>{row.role}</Badge>
                  </td>
                  <td className="tabular px-3 text-right text-ink-3">{row.previousTarget == null ? '—' : format(row.previousTarget, money, ws)}</td>
                  <td className="px-3 text-right">
                    <span className="inline-flex items-center gap-1.5">
                      {isChanged && <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-label="Changed" />}
                      <Input
                        value={drafts[row.memberId] ?? ''}
                        onChange={event => setDrafts(current => ({ ...current, [row.memberId]: event.target.value }))}
                        // Group the thousands once they stop typing — six digits in a
                        // row is not a number anybody can check at a glance.
                        onBlur={() => setDrafts(current => ({ ...current, [row.memberId]: groupDigits(current[row.memberId] ?? '') }))}
                        onFocus={event => event.target.select()}
                        onKeyDown={event => {
                          if (event.key === 'Enter') submit();
                        }}
                        inputMode="decimal"
                        invalid={bad}
                        aria-label={`${metric} quota for ${row.name}`}
                        placeholder="No quota"
                        className={cn('tabular h-8 w-[136px] text-right text-ui')}
                      />
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line px-5 py-3 text-meta text-ink-2 sm:px-6">
        {invalid.length > 0 ? (
          <span className="text-danger">A quota has to be a number, and can’t be negative.</span>
        ) : (
          <span>
            Set in {unit} for {data?.periodLabel ?? 'this period'}. Changing the period above changes which quota you are editing.
          </span>
        )}
      </div>
    </Card>
  );
}

function format(value: number, money: boolean, ws: ReturnType<typeof useWorkspace>) {
  return money ? ws.money(value, { compact: true }) : value.toLocaleString('en-US');
}

/** '250000' → '250,000', leaving anything that isn't a plain number alone. */
function groupDigits(raw: string) {
  const clean = raw.replace(/[,$\s]/g, '').trim();
  if (clean === '') return '';
  const value = Number(clean);
  return Number.isFinite(value) && value >= 0 ? value.toLocaleString('en-US') : raw;
}
