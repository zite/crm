import { ArrowUUpLeft, ClockCounterClockwise, DownloadSimple, Funnel, MapPin, User, WarningCircle } from '@phosphor-icons/react';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { addDays } from '@project/shared/dates';
import type { ActivityKind } from '@project/shared/constants';
import { Avatar } from '../../ui/Avatar';
import { Badge } from '../../ui/Chip';
import { Button } from '../../ui/Button';
import { EmptyState, ListSkeleton, PageHeader } from '../../ui/Layout';
import { Menu, MenuCheckboxItem, MenuContent, MenuItem, MenuLabel, MenuRadioGroup, MenuRadioItem, MenuSeparator, MenuSub, MenuSubContent, MenuSubTrigger, MenuTrigger } from '../../ui/Menu';
import { Tabs } from '../../ui/Tabs';
import { cn } from '../../ui/cn';
import { ActivityGlyph } from '../../glyphs';
import { FilterChips, ListToolbar } from '../../records/Toolbar';
import { downloadCsv } from '../../lib/csv';
import { errorMessage } from '../../lib/errors';
import { duration as durationLabel, fullDate, time, todayString } from '../../lib/format';
import { useDocumentTitle } from '../../lib/useDocumentTitle';
import { useWorkspace } from '../../lib/workspace';
import { RelatedLink, relatedOf } from './taskHelpers';
import { OUTCOME_TONE, dayHeading, groupByDay, localDay, meetingMinutes, useActivities, type Activity } from './meetingHelpers';
import { TasksNav } from './TasksNav';

type Window = 'today' | 'week' | 'month' | 'quarter' | 'all';
type Related = 'any' | 'deal' | 'contact' | 'company' | 'lead' | 'none';

const RELATED: Array<{ value: Related; label: string }> = [
  { value: 'any', label: 'Anything' },
  { value: 'deal', label: 'A deal' },
  { value: 'contact', label: 'A contact' },
  { value: 'company', label: 'A company' },
  { value: 'lead', label: 'A lead' },
  { value: 'none', label: 'Nothing linked' },
];

const WINDOWS: Array<{ value: Window; label: string; days: number | null }> = [
  { value: 'today', label: 'Today', days: 0 },
  { value: 'week', label: 'Last 7 days', days: 7 },
  { value: 'month', label: 'Last 30 days', days: 30 },
  { value: 'quarter', label: 'Last 90 days', days: 90 },
  { value: 'all', label: 'All time', days: null },
];

const KIND_TABS: Array<{ value: 'all' | ActivityKind; label: string }> = [
  { value: 'all', label: 'Everything' },
  { value: 'Call', label: 'Calls' },
  { value: 'Email', label: 'Emails' },
  { value: 'Meeting', label: 'Meetings' },
  { value: 'Note', label: 'Notes' },
];

/** What the team actually did — the Monday-morning read. */
export function ActivityLogPage() {
  const ws = useWorkspace();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const [ownerIds, setOwnerIds] = useState<string[]>([]);
  const [window, setWindow] = useState<Window>('month');
  const [hasOutcome, setHasOutcome] = useState(false);
  const [related, setRelated] = useState<Related>('any');
  const today = todayString();
  useDocumentTitle('Activity log', ws.settings.organizationName);

  const kind = (KIND_TABS.find(t => t.value === params.get('kind'))?.value ?? 'all') as 'all' | ActivityKind;
  const setKind = (value: string) => setParams(value === 'all' ? {} : { kind: value }, { replace: true });

  const days = WINDOWS.find(w => w.value === window)?.days ?? null;
  const query = useActivities({
    filters: {
      ...(kind === 'all' ? {} : { kinds: [kind] }),
      ...(ownerIds.length ? { ownerIds } : {}),
      ...(days == null ? {} : { from: addDays(today, -days) }),
      to: today,
      ...(hasOutcome ? { hasOutcome: true } : {}),
      ...(related === 'any' ? {} : { relatedTo: related }),
      ...(search.trim() ? { search: search.trim() } : {}),
    },
    sort: 'desc',
    limit: 300,
    today,
  });

  const activities = query.data?.activities ?? [];
  const grouped = useMemo(() => groupByDay(activities), [activities]);
  const byKind = query.data?.byKind;

  const chips: Array<{ key: string; label: string; onRemove: () => void }> = [];
  if (ownerIds.length) chips.push({ key: 'owner', label: ownerIds.length === 1 ? `Owner: ${ownerIds[0] === 'none' ? 'Unassigned' : ws.memberName(ownerIds[0])}` : `Owner: ${ownerIds.length}`, onRemove: () => setOwnerIds([]) });
  if (window !== 'month') chips.push({ key: 'window', label: WINDOWS.find(w => w.value === window)?.label ?? '', onRemove: () => setWindow('month') });
  if (hasOutcome) chips.push({ key: 'outcome', label: 'Has an outcome', onRemove: () => setHasOutcome(false) });
  if (related !== 'any') chips.push({ key: 'related', label: `Related to ${RELATED.find(r => r.value === related)?.label.toLowerCase()}`, onRemove: () => setRelated('any') });

  const toggleOwner = (id: string) => setOwnerIds(current => (current.includes(id) ? current.filter(v => v !== id) : [...current, id]));

  // One definition of "cleared", so the chip bar's Clear all and the empty state's
  // Clear filters leave the page in the same state.
  const clearFilters = () => {
    setOwnerIds([]);
    setWindow('month');
    setHasOutcome(false);
    setRelated('any');
    setSearch('');
  };

  const exportCsv = () =>
    downloadCsv(
      'activity-log',
      ['When', 'Kind', 'Subject', 'Outcome', 'Direction', 'Duration (min)', 'Owner', 'Related to', 'Record', 'Notes'],
      activities.map(a => {
        const related = relatedOf(a);
        return [a.occurredAt, a.kind, a.subject, a.outcome ?? '', a.direction ?? '', a.durationMinutes ?? '', ws.memberName(a.ownerId), related?.kind ?? '', related?.name ?? '', (a.body ?? '').replace(/\s+/g, ' ').slice(0, 300)];
      }),
    );

  return (
    <div className="flex min-h-full flex-col">
      <PageHeader
        eyebrow="Tasks"
        title="Activity log"
        description="Every call, email, meeting and note the team has logged."
        tabs={
          <Tabs
            items={KIND_TABS.map(t => ({ value: t.value, label: t.label, count: t.value === 'all' ? query.data?.total ?? null : byKind?.[t.value] ?? null }))}
            value={kind}
            onChange={setKind}
            end={<TasksNav current="activity" />}
          />
        }
      />

      <ListToolbar
        className="mt-1"
        start={
          <Menu>
            <MenuTrigger asChild>
              <Button variant="secondary" size="sm" leading={<Funnel size={15} />}>
                Filter
              </Button>
            </MenuTrigger>
            <MenuContent className="min-w-[220px]">
              <MenuSub>
                <MenuSubTrigger icon={<User size={16} />}>Logged by</MenuSubTrigger>
                <MenuSubContent className="max-h-[320px] overflow-y-auto">
                  <MenuCheckboxItem checked={ownerIds.includes(ws.me.id)} onCheckedChange={() => toggleOwner(ws.me.id)} onSelect={e => e.preventDefault()}>
                    Me
                  </MenuCheckboxItem>
                  <MenuSeparator />
                  {ws.activeMembers.map(m => (
                    <MenuCheckboxItem key={m.id} checked={ownerIds.includes(m.id)} onCheckedChange={() => toggleOwner(m.id)} onSelect={e => e.preventDefault()}>
                      {m.name}
                    </MenuCheckboxItem>
                  ))}
                </MenuSubContent>
              </MenuSub>
              <MenuSeparator />
              <MenuLabel>When</MenuLabel>
              <MenuRadioGroup value={window} onValueChange={value => setWindow(value as Window)}>
                {WINDOWS.map(option => (
                  <MenuRadioItem key={option.value} value={option.value}>
                    {option.label}
                  </MenuRadioItem>
                ))}
              </MenuRadioGroup>
              <MenuSeparator />
              <MenuLabel>Related to</MenuLabel>
              <MenuRadioGroup value={related} onValueChange={value => setRelated(value as Related)}>
                {RELATED.map(option => (
                  <MenuRadioItem key={option.value} value={option.value}>
                    {option.label}
                  </MenuRadioItem>
                ))}
              </MenuRadioGroup>
              <MenuSeparator />
              <MenuCheckboxItem checked={hasOutcome} onCheckedChange={v => setHasOutcome(Boolean(v))} onSelect={e => e.preventDefault()}>
                Has an outcome
              </MenuCheckboxItem>
            </MenuContent>
          </Menu>
        }
        count={activities.length}
        countLabel="activity"
        countLabelPlural="activities"
        search={search}
        onSearch={setSearch}
        more={
          ws.can('data.export') ? (
            <MenuItem icon={<DownloadSimple size={16} />} onSelect={exportCsv}>
              Export CSV
            </MenuItem>
          ) : undefined
        }
      />
      <FilterChips chips={chips} onClear={chips.length ? clearFilters : undefined} />

      <div className="px-5 py-6 sm:px-8">
        {query.isPending ? (
          <ListSkeleton rows={8} className="rounded-lg border border-line bg-card" />
        ) : query.isError ? (
          // A failed fetch must not read as "Nothing logged yet".
          <EmptyState
            icon={<WarningCircle size={22} weight="duotone" />}
            title="The log didn’t load"
            actions={
              <Button variant="primary" onClick={() => void query.refetch()}>
                Try again
              </Button>
            }
          >
            {errorMessage(query.error, 'Something went wrong fetching the activity log.')}
          </EmptyState>
        ) : !activities.length ? (
          <EmptyState
            icon={<ClockCounterClockwise size={22} weight="duotone" />}
            title={chips.length || search ? 'Nothing matches those filters' : 'Nothing logged yet'}
            actions={
              chips.length || search ? (
                <Button variant="secondary" onClick={clearFilters}>
                  Clear filters
                </Button>
              ) : undefined
            }
          >
            {chips.length || search ? 'Try a wider date window, or clear the filters.' : 'Calls, emails, meetings and notes logged on any record collect here.'}
          </EmptyState>
        ) : (
          // Left-aligned on the page gutter so the log starts on the same edge as the title.
          <div className="flex w-full max-w-[920px] flex-col gap-7">
            {grouped.map(({ day, items }) => {
              const name = dayHeading(day, today);
              return (
                <section key={day} className="flex flex-col gap-2">
                  <div className="flex items-baseline gap-2">
                    <h2 className="text-title font-semibold text-ink">{name ?? fullDate(day)}</h2>
                    {name && <span className="text-meta text-ink-3">{fullDate(day)}</span>}
                    <span className="tabular ml-auto text-meta text-ink-3">{items.length === 1 ? '1 activity' : `${items.length} activities`}</span>
                  </div>
                  <ul className="overflow-hidden rounded-lg border border-line bg-card shadow-hairline">
                    {items.map((activity, index) => (
                      <ActivityRow key={activity.id} activity={activity} first={index === 0} />
                    ))}
                  </ul>
                </section>
              );
            })}
            {activities.length >= 300 && <p className="text-center text-meta text-ink-3">Showing the most recent 300. Narrow the window or the owner to see further back.</p>}
          </div>
        )}
      </div>
    </div>
  );
}

function ActivityRow({ activity, first }: { activity: Activity; first: boolean }) {
  const ws = useWorkspace();
  const author = ws.memberById(activity.ownerId ?? activity.createdById);
  const related = relatedOf(activity);
  const minutes = activity.kind === 'Meeting' || activity.kind === 'Call' ? meetingMinutes(activity) : null;
  // A subject of "Call · No Answer" beside a "No Answer" badge says it twice; the badge
  // carries the tone, so the title gives the suffix up.
  const title = activity.subject || activity.kind;
  const suffix = activity.outcome ? ` · ${activity.outcome}` : '';
  const heading = (suffix && title.endsWith(suffix) ? title.slice(0, -suffix.length) : title) || activity.kind;
  return (
    <li className={cn('flex items-start gap-3 px-4 py-3', !first && 'border-t border-line')}>
      <ActivityGlyph kind={activity.kind} className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="truncate text-ui font-medium text-ink">{heading}</span>
          {activity.outcome && <Badge tone={OUTCOME_TONE[activity.outcome] ?? 'neutral'}>{activity.outcome}</Badge>}
          {activity.kind === 'Email' && activity.delivery && activity.delivery !== 'Sent' && <Badge tone={activity.delivery === 'Failed' ? 'danger' : 'neutral'}>{activity.delivery}</Badge>}
          {activity.direction === 'Inbound' && (
            <Badge tone="info" icon={<ArrowUUpLeft size={12} />}>
              Inbound
            </Badge>
          )}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-meta text-ink-2">
          {author && (
            <span className="inline-flex items-center gap-1.5">
              <Avatar person={author} size="xs" />
              {author.name}
            </span>
          )}
          {related && <RelatedLink related={related} className="text-meta" />}
          {minutes ? <span className="text-ink-3">{durationLabel(minutes)}</span> : null}
          {activity.location && (
            <span className="inline-flex items-center gap-1 text-ink-3">
              <MapPin size={12} /> {activity.location}
            </span>
          )}
        </div>
        {activity.body && <p className="mt-1.5 line-clamp-2 text-ui text-ink-2 text-pretty">{activity.body.replace(/@\[([^\]]+)\]\(member:[^)]+\)/g, '@$1')}</p>}
      </div>
      <span className="tabular shrink-0 text-meta text-ink-3" title={`${fullDate(localDay(activity.occurredAt))} ${time(activity.occurredAt)}`}>
        {time(activity.occurredAt)}
      </span>
    </li>
  );
}
