import { ArrowRight, ArrowSquareOut, CalendarBlank, CheckCircle, Compass, MapPin, Plus, Sun, Tray, WarningCircle } from '@phosphor-icons/react';
import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Avatar } from '../../ui/Avatar';
import { Badge } from '../../ui/Chip';
import { Button } from '../../ui/Button';
import { Card, EmptyState, PageHeader, Skeleton, StatStrip } from '../../ui/Layout';
import { cn } from '../../ui/cn';
import { ActivityGlyph, RecordIcon } from '../../glyphs';
import { useAppActions } from '../../lib/app-actions';
import { errorMessage } from '../../lib/errors';
import { clockLabel, duration as durationLabel, fullDate, time, timeAgo, todayString } from '../../lib/format';
import { useNotifications } from '../../lib/queries';
import { useTaskActions } from '../../lib/mutations';
import { useDocumentTitle } from '../../lib/useDocumentTitle';
import { useWorkspace } from '../../lib/workspace';
import { DueCell, RelatedLink, TaskCheck, TaskTitle, pathFor, relatedOf } from '../tasks/taskHelpers';
import { joinUrl, localDay, meetingMinutes } from '../tasks/meetingHelpers';
import { metaFor } from '../inbox/notificationMeta';
import { AttentionCard, AttentionGroup } from './AttentionCard';
import { QuarterCard } from './QuarterCard';
import { greeting, stateSentence, useHome, type HomeData } from './homeData';

/**
 * Home is a worklist. The day comes first — meetings in time order, then what
 * is due — then the deals that need a push, then where the quarter stands.
 */
export function HomePage() {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const actions = useAppActions();
  const taskActions = useTaskActions();
  const today = todayString();
  useDocumentTitle('Home', ws.settings.organizationName);

  const query = useHome();
  const inbox = useNotifications('all');
  const data = query.data;

  const meetingsToday = useMemo(() => (data?.meetings ?? []).filter(m => localDay(m.occurredAt) === today), [data, today]);
  const tasks = data?.tasks ?? [];
  const overdue = tasks.filter(t => t.dueDate && t.dueDate < today);
  const dueToday = tasks.filter(t => t.dueDate === today);
  const attention = data?.attention;
  const attentionTotal = (attention?.counts.stalled ?? 0) + (attention?.counts.noNextStep ?? 0) + (attention?.counts.closingSoon ?? 0);
  const recent = (inbox.data?.notifications ?? []).slice(0, 5);
  const canEdit = ws.can('records.edit');

  // Ticking a task has to feel instant: drop it from Home's own cache before the
  // call, put it back if the call fails, and let the invalidate settle the truth.
  const setDone = (id: string) => {
    const key = ['home', today];
    const previous = qc.getQueryData<HomeData>(key);
    if (previous) {
      const task = previous.tasks.find(t => t.id === id);
      qc.setQueryData<HomeData>(key, {
        ...previous,
        tasks: previous.tasks.filter(t => t.id !== id),
        counts: {
          ...previous.counts,
          dueToday: Math.max(0, previous.counts.dueToday - (task?.dueDate === today ? 1 : 0)),
          overdue: Math.max(0, previous.counts.overdue - (task?.dueDate && task.dueDate < today ? 1 : 0)),
        },
      });
    }
    taskActions.complete.mutate({ ids: [id], done: true }, { onError: () => previous && qc.setQueryData(key, previous) });
    toast.success('Task completed', { action: { label: 'Undo', onClick: () => taskActions.complete.mutate({ ids: [id], done: false }) } });
  };

  const firstName = ws.me.name.split(' ')[0];
  const nothingAtAll = Boolean(data) && !tasks.length && !meetingsToday.length && !attentionTotal && (data?.quarter.openCount ?? 0) === 0;

  return (
    <div className="flex min-h-full flex-col">
      <PageHeader
        narrow
        eyebrow={
          <span className="inline-flex items-center gap-1.5">
            <Sun size={14} /> {new Date(`${today}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long' })} · {fullDate(today)}
          </span>
        }
        title={`${greeting()}, ${firstName}`}
        description={data ? stateSentence({ dueToday: data.counts.dueToday, overdue: data.counts.overdue, newLeads: data.counts.newLeads }, meetingsToday.length) : ' '}
        actions={
          canEdit && (
            <>
              <Button variant="secondary" size="sm" onClick={() => actions.openCreate('task')}>
                New task
              </Button>
              <Button variant="primary" size="sm" leading={<Plus size={16} weight="bold" />} onClick={() => actions.openCreate('deal')}>
                New deal
              </Button>
            </>
          )
        }
      />

      <div className="mx-auto w-full max-w-[1120px] px-5 pt-5 sm:px-8">
        {query.isPending ? (
          <Skeleton className="h-[104px] rounded-lg" />
        ) : (
          // Every hint says something true about the number beside it, zero included,
          // so the four cells never read as a template with the values swapped in.
          <StatStrip
            items={[
              { label: 'Due today', value: data?.counts.dueToday ?? 0, hint: data?.counts.dueToday ? 'Tasks with today’s date' : 'Nothing due', onClick: () => navigate('/tasks') },
              { label: 'Overdue', value: data?.counts.overdue ?? 0, hint: data?.counts.overdue ? 'Past their due date' : 'Nothing slipped', onClick: () => navigate('/tasks?tab=overdue') },
              { label: 'Meetings today', value: meetingsToday.length, hint: meetingsToday.length ? `First at ${time(meetingsToday[0].occurredAt)}` : 'Calendar is clear', onClick: () => navigate('/tasks/meetings') },
              { label: 'New leads', value: data?.counts.newLeads ?? 0, hint: data?.counts.newLeads ? 'Waiting to be triaged' : 'All triaged', onClick: () => navigate(data?.counts.newLeads ? '/leads/review' : '/leads') },
            ]}
          />
        )}
      </div>

      <div className="mx-auto flex w-full max-w-[1120px] flex-col gap-6 px-5 py-6 sm:px-8 lg:flex-row lg:items-start">
        <div className="flex min-w-0 flex-1 flex-col gap-6">
          {query.isPending ? (
            <>
              <Skeleton className="h-[220px] rounded-lg" />
              <Skeleton className="h-[260px] rounded-lg" />
            </>
          ) : query.isError ? (
            // A failed fetch used to render "Your day is clear" — the one thing Home
            // must never say when it doesn't know.
            <Card>
              <EmptyState
                icon={<WarningCircle size={22} weight="duotone" />}
                title="Your day didn’t load"
                actions={
                  <Button variant="primary" onClick={() => void query.refetch()}>
                    Try again
                  </Button>
                }
              >
                {errorMessage(query.error, 'Something went wrong fetching your work.')}
              </EmptyState>
            </Card>
          ) : nothingAtAll ? (
            <Card>
              <EmptyState
                icon={<Compass size={22} weight="duotone" />}
                title={canEdit ? `Welcome, ${firstName}` : 'Nothing assigned to you'}
                actions={
                  canEdit ? (
                    <>
                      <Button variant="primary" onClick={() => actions.openCreate('deal')}>
                        New deal
                      </Button>
                      <Button variant="secondary" asChild>
                        <Link to="/leads/review">Review new leads</Link>
                      </Button>
                      <Button variant="secondary" asChild>
                        <Link to="/deals">Browse the pipeline</Link>
                      </Button>
                    </>
                  ) : (
                    <Button variant="secondary" asChild>
                      <Link to="/deals">Browse the pipeline</Link>
                    </Button>
                  )
                }
              >
                {canEdit
                  ? 'Nothing is assigned to you yet. Home fills up as you take deals, book meetings and give each deal its next step — until then, the team’s pipeline is the place to start.'
                  : 'You can read every deal, contact and activity in the organization. This page fills up if work is assigned to you.'}
              </EmptyState>
            </Card>
          ) : (
            <>
              <YourDay
                meetings={meetingsToday}
                overdue={overdue}
                dueToday={dueToday}
                today={today}
                canEdit={canEdit}
                onComplete={setDone}
                upcomingCount={data?.counts.upcoming ?? 0}
              />

              <section className="flex flex-col gap-3">
                <div className="flex min-h-8 items-center gap-2">
                  <h2 className="text-title font-semibold text-ink">Deals needing attention</h2>
                  <span className="tabular text-ui text-ink-3">{attentionTotal}</span>
                  <Link to="/deals" className="ml-auto inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-meta font-medium text-accent hover:bg-hover">
                    All deals <ArrowRight size={12} weight="bold" />
                  </Link>
                </div>
                {attentionTotal === 0 ? (
                  <Card>
                    <EmptyState compact icon={<CheckCircle size={22} weight="duotone" />} title="Nothing is drifting">
                      Every open deal you own has a next step, is inside its stage limit, and isn’t closing in the next fortnight.
                    </EmptyState>
                  </Card>
                ) : (
                  <AttentionCard>
                    <AttentionGroup reason="stalled" deals={attention?.stalled ?? []} total={attention?.counts.stalled ?? 0} today={today} />
                    <AttentionGroup reason="noNextStep" deals={attention?.noNextStep ?? []} total={attention?.counts.noNextStep ?? 0} today={today} />
                    <AttentionGroup reason="closingSoon" deals={attention?.closingSoon ?? []} total={attention?.counts.closingSoon ?? 0} today={today} />
                  </AttentionCard>
                )}
              </section>
            </>
          )}
        </div>

        <aside className="flex w-full shrink-0 flex-col gap-6 lg:w-[340px]">
          {query.isPending ? <Skeleton className="h-[280px] rounded-lg" /> : data ? <QuarterCard quarter={data.quarter} /> : null}

          <Card className="overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-3">
              <h2 className="text-title font-semibold text-ink">Inbox</h2>
              {(inbox.data?.unread ?? 0) > 0 && <Badge tone="accent">{inbox.data?.unread} unread</Badge>}
              <Link to="/inbox" className="ml-auto inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-meta font-medium text-accent hover:bg-hover">
                Open <ArrowRight size={12} weight="bold" />
              </Link>
            </div>
            {inbox.isPending ? (
              <div className="flex flex-col gap-2 border-t border-line p-4">
                {[0, 1, 2].map(i => (
                  <Skeleton key={i} className="h-8" />
                ))}
              </div>
            ) : inbox.isError ? (
              <div className="border-t border-line px-4 py-4 text-meta text-ink-2">
                Your inbox didn’t load.{' '}
                <button type="button" className="rounded-sm font-medium text-accent hover:underline" onClick={() => void inbox.refetch()}>
                  Try again
                </button>
              </div>
            ) : !recent.length ? (
              <div className="border-t border-line">
                <EmptyState compact icon={<Tray size={20} weight="duotone" />} title="Nothing yet">
                  Mentions, assignments and closed deals land here.
                </EmptyState>
              </div>
            ) : (
              <ul className="border-t border-line">
                {recent.map((notification, index) => {
                  const meta = metaFor(notification.kind);
                  return (
                    <li key={notification.id} className={cn(index > 0 && 'border-t border-line')}>
                      <Link to={notification.link || '/inbox'} className="flex items-start gap-2.5 px-4 py-2.5 transition-colors hover:bg-hover/60">
                        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-sunken text-ink-2">{meta.icon}</span>
                        <span className="min-w-0 flex-1">
                          <span className={cn('block truncate text-ui', notification.readAt ? 'text-ink-2' : 'font-medium text-ink')}>{notification.title}</span>
                          <span className="block text-meta text-ink-3">{timeAgo(notification.occurredAt)}</span>
                        </span>
                        {/* role="img" or a bare span with aria-label is skipped by screen readers. */}
                        {!notification.readAt && <span role="img" aria-label="Unread" className="mt-2 h-2 w-2 shrink-0 rounded-full bg-accent" />}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </aside>
      </div>
    </div>
  );
}

function YourDay({
  meetings,
  overdue,
  dueToday,
  today,
  canEdit,
  onComplete,
  upcomingCount,
}: {
  meetings: HomeData['meetings'];
  overdue: HomeData['tasks'];
  dueToday: HomeData['tasks'];
  today: string;
  canEdit: boolean;
  onComplete: (id: string) => void;
  upcomingCount: number;
}) {
  const empty = !meetings.length && !overdue.length && !dueToday.length;

  return (
    <section className="flex flex-col gap-3">
      <div className="flex min-h-8 items-center gap-2">
        <h2 className="text-title font-semibold text-ink">Your day</h2>
        <span className="tabular text-ui text-ink-3">{meetings.length + overdue.length + dueToday.length}</span>
        <Link to="/tasks" className="ml-auto inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-meta font-medium text-accent hover:bg-hover">
          All tasks <ArrowRight size={12} weight="bold" />
        </Link>
      </div>

      <Card className="divide-y divide-line overflow-hidden">
        {empty ? (
          <EmptyState compact icon={<Sun size={22} weight="duotone" />} title="Your day is clear">
            {upcomingCount > 0 ? `Nothing is due today — ${upcomingCount} ${upcomingCount === 1 ? 'task is' : 'tasks are'} waiting later in the week.` : 'No meetings and nothing due. Pick a deal and give it a next step.'}
          </EmptyState>
        ) : (
          <>
            {meetings.length > 0 && (
              <div>
                <h3 className="px-4 py-2.5 text-micro font-semibold uppercase text-ink-3">Meetings today</h3>
                <ul className="border-t border-line">
                  {meetings.map((meeting, index) => {
                    const related = relatedOf(meeting);
                    const join = joinUrl(meeting.location);
                    const minutes = meetingMinutes(meeting);
                    const who = meeting.contactName || meeting.companyName || meeting.attendees.map(a => a.name).filter(Boolean)[0];
                    return (
                      <li key={meeting.id} className={cn('flex items-center gap-3 px-4 py-2.5', index > 0 && 'border-t border-line')}>
                        <span className="tabular w-[62px] shrink-0 text-ui font-medium text-ink">{time(meeting.occurredAt)}</span>
                        <ActivityGlyph kind="Meeting" size={24} className="hidden shrink-0 sm:inline-flex" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-ui font-medium text-ink">{meeting.subject || 'Meeting'}</span>
                          <span className="flex min-w-0 flex-wrap items-center gap-x-2 text-meta text-ink-3">
                            {who && <span className="truncate">{who}</span>}
                            {minutes ? <span>{durationLabel(minutes)}</span> : null}
                            {meeting.location && !join && (
                              <span className="inline-flex items-center gap-1 truncate">
                                <MapPin size={11} /> {meeting.location}
                              </span>
                            )}
                          </span>
                        </span>
                        {join ? (
                          <Button variant="secondary" size="xs" asChild>
                            <a href={join} target="_blank" rel="noreferrer noopener">
                              Join <ArrowSquareOut size={12} />
                            </a>
                          </Button>
                        ) : related ? (
                          <RelatedLink related={related} className="hidden shrink-0 text-meta sm:inline-flex max-w-[180px]" />
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            {!meetings.length && (
              <p className="flex items-center gap-2 px-4 py-2.5 text-meta text-ink-3">
                <CalendarBlank size={14} /> Nothing on the calendar today.
              </p>
            )}

            {overdue.length > 0 && <TaskGroup title="Overdue" tone="danger" tasks={overdue} today={today} canEdit={canEdit} onComplete={onComplete} />}
            {dueToday.length > 0 && <TaskGroup title="Due today" tasks={dueToday} today={today} canEdit={canEdit} onComplete={onComplete} />}
          </>
        )}
      </Card>
    </section>
  );
}

function TaskGroup({
  title,
  tone,
  tasks,
  today,
  canEdit,
  onComplete,
}: {
  title: string;
  tone?: 'danger';
  tasks: HomeData['tasks'];
  today: string;
  canEdit: boolean;
  onComplete: (id: string) => void;
}) {
  const ws = useWorkspace();
  return (
    <div>
      <h3 className={cn('flex items-center gap-2 px-4 py-2.5 text-micro font-semibold uppercase', tone === 'danger' ? 'text-danger' : 'text-ink-3')}>
        {title}
        <span className="tabular text-ink-3">{tasks.length}</span>
      </h3>
      <ul className="border-t border-line">
        {tasks.map((task, index) => {
          const related = relatedOf(task);
          const owner = ws.memberById(task.ownerId);
          return (
            // Everything in the row hangs off the title's line, not the middle of a body
            // that is two lines wide on a desktop and three on a phone.
            <li key={task.id} className={cn('flex items-start gap-3 px-4 py-2.5 transition-colors hover:bg-hover/60', index > 0 && 'border-t border-line')}>
              <TaskCheck className="mt-0.5" done={task.status === 'Done'} disabled={!canEdit} label={task.title} onToggle={() => onComplete(task.id)} />
              {/* The whole line is the way through to the record the task sits on. */}
              <TaskBody task={task} related={related} today={today} />
              {task.priority === 'High' && <Badge tone="danger" className="-mt-0.5 hidden sm:inline-flex">High</Badge>}
              <DueCell day={task.dueDate} today={today} className="hidden shrink-0 pt-px text-meta sm:inline" />
              {owner && owner.id !== ws.me.id && <Avatar person={owner} size="xs" className="mt-0.5" />}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** A task's title and context, linked to its record when it has one. */
function TaskBody({ task, related, today }: { task: HomeData['tasks'][number]; related: ReturnType<typeof relatedOf>; today: string }) {
  const body = (
    <>
      <TaskTitle task={task} />
      <span className="flex min-w-0 flex-wrap items-center gap-x-2 pl-[23px] text-meta text-ink-3">
        {related && (
          <span className="inline-flex min-w-0 items-center gap-1.5">
            <RecordIcon kind={related.kind} size={13} />
            <span className="truncate">{related.name}</span>
          </span>
        )}
        {task.dueTime && <span className="tabular">{clockLabel(task.dueTime)}</span>}
        {/* On a phone the due date and priority ride the second line rather than a right rail. */}
        <DueCell day={task.dueDate} today={today} className="text-meta sm:hidden" />
        {task.priority === 'High' && <span className="text-danger sm:hidden">High</span>}
      </span>
    </>
  );
  if (!related) return <span className="min-w-0 flex-1">{body}</span>;
  return (
    <Link to={pathFor(related)} className="min-w-0 flex-1 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
      {body}
    </Link>
  );
}
