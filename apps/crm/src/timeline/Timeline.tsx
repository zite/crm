import { ArrowUUpLeft, CalendarBlank, Clock, DotsThree, MapPin, PushPin, Trash } from '@phosphor-icons/react';
import { Fragment, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { deleteActivity as deleteActivityApi, updateActivity as updateActivityApi, type GetTimelineOutputType } from 'zitejs/api';
import { Avatar } from '../ui/Avatar';
import { Badge } from '../ui/Chip';
import { Button } from '../ui/Button';
import { EmptyState, ListSkeleton } from '../ui/Layout';
import { Menu, MenuContent, MenuItem, MenuTrigger } from '../ui/Menu';
import { cn } from '../ui/cn';
import { ActivityGlyph } from '../glyphs';
import { useAppActions } from '../lib/app-actions';
import { errorMessage } from '../lib/errors';
import { dateTime, duration as durationLabel, time, timeAgo } from '../lib/format';
import { invalidate } from '../lib/queries';
import { useWorkspace } from '../lib/workspace';
import { MarkdownView } from './MarkdownView';

type Activity = GetTimelineOutputType['activities'][number];
type Event = GetTimelineOutputType['events'][number];
type Item = { at: string; activity?: Activity; event?: Event };

/**
 * A record's story: activities and history on one rail, grouped by day.
 * Anything scheduled ahead is pinned above it, because that is what a rep
 * looks for first.
 */
export function Timeline({ data, isLoading, emptyHint, className, onLoadMore, hasMore }: { data?: GetTimelineOutputType; isLoading?: boolean; emptyHint?: string; className?: string; onLoadMore?: () => void; hasMore?: boolean }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const { confirm } = useAppActions();

  const days = useMemo(() => {
    const items: Item[] = [
      ...(data?.activities ?? []).map(a => ({ at: a.occurredAt, activity: a })),
      ...(data?.events ?? []).map(e => ({ at: e.occurredAt, event: e })),
    ].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
    const grouped = new Map<string, Item[]>();
    for (const item of items) {
      const day = new Date(item.at).toLocaleDateString('en-CA');
      if (!grouped.has(day)) grouped.set(day, []);
      grouped.get(day)!.push(item);
    }
    return [...grouped.entries()];
  }, [data]);

  const remove = async (activity: Activity) => {
    const ok = await confirm({ title: 'Delete this activity?', description: 'It disappears from the timeline for everyone.', confirmLabel: 'Delete', destructive: true });
    if (!ok) return;
    try {
      await deleteActivityApi({ id: activity.id });
      invalidate(qc, 'timeline', 'deals', 'deal');
      toast.success('Activity deleted');
    } catch (e) {
      toast.error(errorMessage(e, 'Couldn’t delete that'));
    }
  };

  const togglePin = async (activity: Activity) => {
    try {
      await updateActivityApi({ id: activity.id, pinned: !activity.pinned });
      invalidate(qc, 'timeline');
    } catch (e) {
      toast.error(errorMessage(e, 'Couldn’t pin that'));
    }
  };

  if (isLoading) return <ListSkeleton rows={5} className={cn('rounded-lg border border-line bg-card', className)} />;

  const upcoming = data?.upcoming ?? [];
  if (!days.length && !upcoming.length) {
    return (
      <EmptyState compact icon={<Clock size={22} weight="duotone" />} title="Nothing logged yet" className={className}>
        {emptyHint ?? 'Calls, emails, meetings and notes will show up here.'}
      </EmptyState>
    );
  }

  return (
    <div className={cn('flex flex-col gap-6', className)}>
      {upcoming.length > 0 && (
        <section className="rounded-lg border border-line bg-card p-3 shadow-hairline">
          <h3 className="mb-2 px-1 text-micro font-semibold uppercase text-ink-3">Coming up</h3>
          <ul className="flex flex-col gap-1">
            {upcoming.map(meeting => (
              <li key={meeting.id} className="flex items-center gap-3 rounded-md px-1 py-1.5">
                <CalendarBlank size={16} className="shrink-0 text-accent" />
                <span className="min-w-0 flex-1 truncate text-ui text-ink">{meeting.subject}</span>
                <span className="shrink-0 text-meta text-ink-2">{dateTime(meeting.occurredAt)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="flex flex-col">
        {days.map(([day, items]) => (
          <Fragment key={day}>
            <div className="sticky top-0 z-10 -mx-1 bg-paper/90 px-1 py-2 backdrop-blur">
              <span className="text-micro font-semibold uppercase text-ink-3">{dayLabel(day)}</span>
            </div>
            <ul className="flex flex-col">
              {items.map((item, index) =>
                item.activity ? (
                  <ActivityRow key={item.activity.id} activity={item.activity} last={index === items.length - 1} onDelete={remove} onPin={togglePin} />
                ) : (
                  <EventRow key={item.event!.id} event={item.event!} />
                ),
              )}
            </ul>
          </Fragment>
        ))}
      </div>

      {hasMore && onLoadMore && (
        <Button variant="secondary" size="sm" className="self-center" onClick={onLoadMore}>
          Show older activity
        </Button>
      )}
    </div>
  );
}

function dayLabel(day: string) {
  const today = new Date().toLocaleDateString('en-CA');
  if (day === today) return 'Today';
  const yesterday = new Date(Date.now() - 86_400_000).toLocaleDateString('en-CA');
  if (day === yesterday) return 'Yesterday';
  return new Date(`${day}T00:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
}

function ActivityRow({ activity, last, onDelete, onPin }: { activity: Activity; last: boolean; onDelete: (a: Activity) => void; onPin: (a: Activity) => void }) {
  const ws = useWorkspace();
  const author = ws.memberById(activity.ownerId ?? activity.createdById);
  const isInbound = activity.direction === 'Inbound';
  return (
    <li className="group relative flex gap-3 pb-5">
      <div className="flex flex-col items-center">
        <ActivityGlyph kind={activity.kind} />
        {!last && <span className="mt-1 w-px flex-1 bg-line" />}
      </div>
      <div className="min-w-0 flex-1 pt-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="text-ui font-medium text-ink">{activity.subject || activity.kind}</span>
          {activity.outcome && <Badge tone={activity.outcome === 'No Show' || activity.outcome === 'Canceled' ? 'danger' : activity.outcome === 'Connected' || activity.outcome === 'Completed' ? 'success' : 'neutral'}>{activity.outcome}</Badge>}
          {activity.kind === 'Email' && activity.delivery && activity.delivery !== 'Sent' && <Badge tone={activity.delivery === 'Failed' ? 'danger' : 'neutral'}>{activity.delivery}</Badge>}
          {isInbound && <Badge tone="info" icon={<ArrowUUpLeft size={12} />}>Inbound</Badge>}
          {activity.pinned && <PushPin size={13} weight="fill" className="text-warning" />}
          <span className="ml-auto flex items-center gap-2 text-meta text-ink-3">
            {activity.durationMinutes ? <span>{durationLabel(activity.durationMinutes)}</span> : null}
            <span title={dateTime(activity.occurredAt)}>{timeAgo(activity.occurredAt)}</span>
            <Menu>
              <MenuTrigger asChild>
                <Button variant="ghost" size="xs" icon aria-label="Activity actions" className="opacity-0 group-hover:opacity-100 focus:opacity-100">
                  <DotsThree size={16} weight="bold" />
                </Button>
              </MenuTrigger>
              <MenuContent align="end">
                <MenuItem icon={<PushPin size={16} />} onSelect={() => onPin(activity)}>
                  {activity.pinned ? 'Unpin' : 'Pin to the top'}
                </MenuItem>
                <MenuItem icon={<Trash size={16} />} destructive onSelect={() => onDelete(activity)}>
                  Delete
                </MenuItem>
              </MenuContent>
            </Menu>
          </span>
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-meta text-ink-3">
          {author && (
            <span className="inline-flex items-center gap-1.5">
              <Avatar person={author} size="xs" />
              {author.name}
            </span>
          )}
          {activity.kind === 'Email' && activity.emailTo && <span className="truncate">to {activity.emailTo}</span>}
          {activity.location && (
            <span className="inline-flex items-center gap-1">
              <MapPin size={12} /> {activity.location}
            </span>
          )}
          {activity.kind === 'Meeting' && <span>{time(activity.occurredAt)}</span>}
        </div>
        {activity.body && <MarkdownView text={activity.body} className="mt-2 rounded-md bg-sunken/70 px-3 py-2 text-ui" />}
      </div>
    </li>
  );
}

function EventRow({ event }: { event: Event }) {
  const ws = useWorkspace();
  const actor = ws.memberById(event.actorId);
  return (
    <li className="relative flex gap-3 pb-5">
      <div className="flex w-7 flex-col items-center">
        <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-line-strong" />
        <span className="mt-1 w-px flex-1 bg-line" />
      </div>
      <p className="min-w-0 flex-1 pt-0.5 text-meta text-ink-2">
        <span className="font-medium text-ink">{actor?.name ?? 'Someone'}</span> {event.summary}
        <span className="ml-2 text-ink-3" title={dateTime(event.occurredAt)}>
          {timeAgo(event.occurredAt)}
        </span>
      </p>
    </li>
  );
}
