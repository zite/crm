import { ArrowSquareOut, CalendarBlank, CalendarPlus, CheckCircle, DotsThree, MapPin, Prohibit, UserMinus, WarningCircle } from '@phosphor-icons/react';
import { useMemo, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { updateActivity } from 'zitejs/api';
import { addDays } from '@project/shared/dates';
import { Avatar } from '../../ui/Avatar';
import { Badge } from '../../ui/Chip';
import { Button } from '../../ui/Button';
import { EmptyState, ListSkeleton, PageHeader } from '../../ui/Layout';
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from '../../ui/Menu';
import { Segmented } from '../../ui/Form';
import { Tabs } from '../../ui/Tabs';
import { cn } from '../../ui/cn';
import { ActivityGlyph } from '../../glyphs';
import { ListToolbar } from '../../records/Toolbar';
import { useAppActions } from '../../lib/app-actions';
import { errorMessage } from '../../lib/errors';
import { duration as durationLabel, fullDate, time, todayString } from '../../lib/format';
import { invalidate } from '../../lib/queries';
import { useDocumentTitle } from '../../lib/useDocumentTitle';
import { useWorkspace } from '../../lib/workspace';
import { RelatedLink, pathFor, relatedOf } from './taskHelpers';
import { OUTCOME_TONE, dayHeading, groupByDay, joinUrl, localDay, meetingMinutes, useActivities, type Meeting } from './meetingHelpers';
import { RescheduleMeetingDialog } from './RescheduleMeetingDialog';
import { TasksNav } from './TasksNav';

const OUTCOMES: Array<{ value: 'Completed' | 'No Show' | 'Canceled'; label: string; icon: ReactNode }> = [
  { value: 'Completed', label: 'It happened', icon: <CheckCircle size={16} /> },
  { value: 'No Show', label: 'They didn’t show', icon: <UserMinus size={16} /> },
  { value: 'Canceled', label: 'It was canceled', icon: <Prohibit size={16} /> },
];

/** The agenda: what is booked, who is in it, and what came of the ones that have been. */
export function MeetingsPage() {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const actions = useAppActions();
  const [params, setParams] = useSearchParams();
  const [rescheduling, setRescheduling] = useState<Meeting | null>(null);
  const [search, setSearch] = useState('');
  const today = todayString();
  useDocumentTitle('Meetings', ws.settings.organizationName);

  const when = params.get('when') === 'past' ? 'past' : 'upcoming';
  const scope = params.get('who') === 'team' ? 'team' : 'mine';
  const setParam = (key: string, value: string, fallback: string) => {
    const next = new URLSearchParams(params);
    if (value === fallback) next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true });
  };

  const ownerIds = scope === 'mine' ? [ws.me.id] : undefined;
  // A day either side of the window, because the server buckets on UTC days and we bucket on local ones.
  const query = useActivities({
    filters: {
      kinds: ['Meeting'],
      ...(ownerIds ? { ownerIds } : {}),
      ...(when === 'upcoming' ? { from: addDays(today, -1) } : { to: addDays(today, 1) }),
      ...(search.trim() ? { search: search.trim() } : {}),
    },
    sort: when === 'upcoming' ? 'asc' : 'desc',
    limit: 300,
    today,
  });

  const meetings = useMemo(() => {
    const rows = query.data?.activities ?? [];
    return rows.filter(m => (when === 'upcoming' ? localDay(m.occurredAt) >= today : localDay(m.occurredAt) < today));
  }, [query.data, when, today]);

  const days = useMemo(() => groupByDay(meetings), [meetings]);
  const canEdit = ws.can('records.edit');

  const setOutcome = async (meeting: Meeting, outcome: 'Completed' | 'No Show' | 'Canceled') => {
    try {
      await updateActivity({ id: meeting.id, outcome });
      invalidate(qc, 'timeline', 'home', 'deals', 'deal');
      toast.success(outcome === 'Completed' ? 'Logged as held' : outcome === 'No Show' ? 'Logged as a no show' : 'Logged as canceled');
    } catch (e) {
      toast.error(errorMessage(e, 'Couldn’t log that outcome'));
    }
  };

  return (
    <div className="flex min-h-full flex-col">
      <PageHeader
        eyebrow="Tasks"
        title="Meetings"
        description="Everything on the calendar, in the order it happens."
        actions={
          canEdit && (
            <Button variant="primary" size="sm" leading={<CalendarPlus size={16} weight="bold" />} onClick={() => actions.openCreate('activity', { kind: 'Meeting' })}>
              Log a meeting
            </Button>
          )
        }
        tabs={
          <Tabs
            items={[
              { value: 'upcoming', label: 'Upcoming' },
              { value: 'past', label: 'Past' },
            ]}
            value={when}
            onChange={value => setParam('when', value, 'upcoming')}
            end={<TasksNav current="meetings" />}
          />
        }
      />

      <ListToolbar
        className="mt-1"
        start={
          <Segmented
            size="sm"
            value={scope}
            onChange={value => setParam('who', value, 'mine')}
            options={[
              { value: 'mine', label: 'Mine' },
              { value: 'team', label: 'Everyone' },
            ]}
          />
        }
        count={meetings.length}
        countLabel="meeting"
        search={search}
        onSearch={setSearch}
      />

      <div className="px-5 py-6 sm:px-8">
        {query.isPending ? (
          <ListSkeleton rows={6} className="rounded-lg border border-line bg-card" />
        ) : query.isError ? (
          // A failed fetch must not read as "Nothing booked".
          <EmptyState
            icon={<WarningCircle size={22} weight="duotone" />}
            title="The agenda didn’t load"
            actions={
              <Button variant="primary" onClick={() => void query.refetch()}>
                Try again
              </Button>
            }
          >
            {errorMessage(query.error, 'Something went wrong fetching your meetings.')}
          </EmptyState>
        ) : !meetings.length ? (
          <EmptyState
            icon={<CalendarBlank size={22} weight="duotone" />}
            title={search ? 'No meeting matches that' : when === 'upcoming' ? 'Nothing booked' : 'No meetings before today'}
            actions={
              search ? (
                <Button variant="secondary" onClick={() => setSearch('')}>
                  Clear search
                </Button>
              ) : canEdit && when === 'upcoming' ? (
                <Button variant="primary" onClick={() => actions.openCreate('activity', { kind: 'Meeting' })}>
                  Log a meeting
                </Button>
              ) : undefined
            }
          >
            {search
              ? 'Try a shorter search, or switch between upcoming and past.'
              : when === 'upcoming'
                ? `${scope === 'mine' ? 'You have' : 'The team has'} nothing on the calendar from today onwards. Meetings booked through a meeting link land here automatically.`
                : 'Meetings you have already held will collect here with their outcome.'}
          </EmptyState>
        ) : (
          // Left-aligned, not centred: the header, the toolbar and the agenda all
          // start on the page gutter, so nothing steps sideways as you scroll down.
          <div className="flex w-full max-w-[920px] flex-col gap-7">
            {days.map(({ day, items }) => {
              const name = dayHeading(day, today);
              return (
                <section key={day} className="flex flex-col gap-2">
                  <div className="flex items-baseline gap-2">
                    <h2 className="text-title font-semibold text-ink">{name ?? fullDate(day)}</h2>
                    {name && <span className="text-meta text-ink-3">{fullDate(day)}</span>}
                    <span className="tabular ml-auto text-meta text-ink-3">{items.length === 1 ? '1 meeting' : `${items.length} meetings`}</span>
                  </div>
                  <ul className="overflow-hidden rounded-lg border border-line bg-card shadow-hairline">
                    {items.map((meeting, index) => (
                      <MeetingRow
                        key={meeting.id}
                        meeting={meeting}
                        first={index === 0}
                        canEdit={canEdit}
                        onOutcome={setOutcome}
                        onReschedule={() => setRescheduling(meeting)}
                      />
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        )}
      </div>

      <RescheduleMeetingDialog meeting={rescheduling} onOpenChange={open => !open && setRescheduling(null)} />
    </div>
  );
}

function MeetingRow({
  meeting,
  first,
  canEdit,
  onOutcome,
  onReschedule,
}: {
  meeting: Meeting;
  first: boolean;
  canEdit: boolean;
  onOutcome: (meeting: Meeting, outcome: 'Completed' | 'No Show' | 'Canceled') => void;
  onReschedule: () => void;
}) {
  const ws = useWorkspace();
  const navigate = useNavigate();
  const owner = ws.memberById(meeting.ownerId);
  const related = relatedOf(meeting);
  const join = joinUrl(meeting.location);
  const minutes = meetingMinutes(meeting);
  const guests = meeting.attendees.filter(a => a.name);

  return (
    <li className={cn('group flex flex-wrap items-start gap-x-4 gap-y-2 px-4 py-3 sm:flex-nowrap', !first && 'border-t border-line')}>
      <div className="w-[70px] shrink-0 pt-0.5">
        <div className="tabular text-ui font-medium text-ink">{time(meeting.occurredAt)}</div>
        {minutes ? <div className="tabular text-meta text-ink-3">{durationLabel(minutes)}</div> : null}
      </div>
      <ActivityGlyph kind="Meeting" className="mt-0.5 hidden shrink-0 sm:inline-flex" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="truncate text-ui font-medium text-ink">{meeting.subject || 'Meeting'}</span>
          {meeting.outcome && meeting.outcome !== 'Scheduled' && <Badge tone={OUTCOME_TONE[meeting.outcome] ?? 'neutral'}>{meeting.outcome}</Badge>}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-meta text-ink-2">
          {related && <RelatedLink related={related} className="text-meta" />}
          {guests.length > 0 && <span className="truncate">{guests.map(a => a.name).join(', ')}</span>}
          {meeting.location && !join && (
            <span className="inline-flex items-center gap-1 text-ink-3">
              <MapPin size={12} /> {meeting.location}
            </span>
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {owner && (
          <span title={owner.name} className="hidden sm:inline-flex">
            <Avatar person={owner} size="sm" />
          </span>
        )}
        {join && (
          <Button variant="secondary" size="xs" asChild>
            <a href={join} target="_blank" rel="noreferrer noopener">
              Join <ArrowSquareOut size={12} />
            </a>
          </Button>
        )}
        {canEdit && (
          <Menu>
            <MenuTrigger asChild>
              <Button variant="ghost" size="xs" icon aria-label={`Actions for ${meeting.subject || 'this meeting'}`}>
                <DotsThree size={16} weight="bold" />
              </Button>
            </MenuTrigger>
            <MenuContent align="end">
              <MenuLabel>Log the outcome</MenuLabel>
              {OUTCOMES.map(option => (
                <MenuItem key={option.value} icon={option.icon} onSelect={() => onOutcome(meeting, option.value)}>
                  {option.label}
                </MenuItem>
              ))}
              <MenuSeparator />
              <MenuItem icon={<CalendarPlus size={16} />} onSelect={onReschedule}>
                Reschedule…
              </MenuItem>
              {related && (
                <MenuItem icon={<ArrowSquareOut size={16} />} onSelect={() => navigate(pathFor(related))}>
                  Open the {related.kind}
                </MenuItem>
              )}
            </MenuContent>
          </Menu>
        )}
      </div>
    </li>
  );
}
