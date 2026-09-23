import { ArrowLeft, ArrowSquareOut, Checks, Envelope, EnvelopeOpen, Tray, WarningCircle } from '@phosphor-icons/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { markNotifications } from 'zitejs/api';
import { Avatar } from '../../ui/Avatar';
import { Badge } from '../../ui/Chip';
import { Button } from '../../ui/Button';
import { EmptyState, ListSkeleton, PageHeader } from '../../ui/Layout';
import { Segmented } from '../../ui/Form';
import { cn } from '../../ui/cn';
import { useHotkeys } from '../../lib/hotkeys';
import { errorMessage } from '../../lib/errors';
import { dateTime, timeAgo, todayString } from '../../lib/format';
import { invalidate, useNotifications } from '../../lib/queries';
import { useDocumentTitle } from '../../lib/useDocumentTitle';
import { invalidateWorkspace, useWorkspace } from '../../lib/workspace';
import { FILTERS, matchesFilter, metaFor, targetLabel, type InboxFilter, type Notification } from './notificationMeta';

/**
 * The inbox: a list you can walk with J/K and a reading pane that marks
 * each one read as you land on it. The top bar's unread count comes from the
 * workspace query, so every write here invalidates it.
 */
export function InboxPage() {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<InboxFilter>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [marking, setMarking] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const today = todayString();
  useDocumentTitle('Inbox', ws.settings.organizationName);

  const query = useNotifications('all');
  const all = query.data?.notifications ?? [];
  const notifications = useMemo(() => all.filter(n => matchesFilter(n, filter)), [all, filter]);
  const unread = query.data?.unread ?? 0;

  const selected = notifications.find(n => n.id === selectedId) ?? null;

  const markRead = async (ids: string[], read: boolean) => {
    if (!ids.length) return;
    // Optimistic: the dot and the top-bar count should move the moment you open one.
    const readAt = read ? new Date().toISOString() : null;
    const snapshots = qc.getQueriesData<{ notifications: Notification[]; unread: number }>({ queryKey: ['notifications'] });
    snapshots.forEach(([key, data]) => {
      if (!data) return;
      const next = data.notifications.map(n => (ids.includes(n.id) ? { ...n, readAt } : n));
      qc.setQueryData(key, { ...data, notifications: next, unread: next.filter(n => !n.readAt).length });
    });
    try {
      await markNotifications({ ids, read });
      void invalidateWorkspace(qc);
    } catch (e) {
      snapshots.forEach(([key, data]) => qc.setQueryData(key, data));
      toast.error(errorMessage(e, 'Couldn’t update your inbox'));
    } finally {
      invalidate(qc, 'notifications');
    }
  };

  const open = (notification: Notification) => {
    setSelectedId(notification.id);
    if (!notification.readAt) void markRead([notification.id], true);
  };

  // Drop the selection when the filter hides it. Nothing is auto-selected: landing on
  // a notification marks it read, which shouldn't happen just because you opened the page.
  useEffect(() => {
    if (selectedId && notifications.some(n => n.id === selectedId)) return;
    setSelectedId(null);
  }, [filter, notifications.length]);

  const move = (delta: number) => {
    if (!notifications.length) return;
    const index = selectedId ? notifications.findIndex(n => n.id === selectedId) : -1;
    // Nothing selected yet: either direction opens the first one.
    const target = index === -1 ? 0 : Math.max(0, Math.min(notifications.length - 1, index + delta));
    const next = notifications[target];
    if (next) {
      open(next);
      listRef.current?.querySelector(`[data-row-id="${next.id}"]`)?.scrollIntoView({ block: 'nearest' });
    }
  };

  useHotkeys({
    j: () => (notifications.length ? move(1) : false),
    down: () => (notifications.length ? move(1) : false),
    k: () => (notifications.length ? move(-1) : false),
    up: () => (notifications.length ? move(-1) : false),
    enter: () => {
      if (!selected?.link) return false;
      navigate(selected.link);
    },
    esc: () => {
      if (!selectedId) return false;
      setSelectedId(null);
    },
  });

  const markAll = async () => {
    setMarking(true);
    try {
      const result = await markNotifications({ all: true, read: true });
      invalidate(qc, 'notifications');
      void invalidateWorkspace(qc);
      toast.success(result.updated === 1 ? '1 notification marked read' : `${result.updated} notifications marked read`);
    } catch (e) {
      toast.error(errorMessage(e, 'Couldn’t mark those read'));
    } finally {
      setMarking(false);
    }
  };

  const groups = useMemo(() => {
    const todayRows = notifications.filter(n => n.occurredAt.slice(0, 10) === today || new Date(n.occurredAt).toLocaleDateString('en-CA') === today);
    const earlier = notifications.filter(n => !todayRows.includes(n));
    return [
      { key: 'today', label: 'Today', rows: todayRows },
      { key: 'earlier', label: 'Earlier', rows: earlier },
    ].filter(g => g.rows.length);
  }, [notifications, today]);

  return (
    <div className="flex min-h-full flex-col">
      <PageHeader
        title="Inbox"
        description="Mentions, assignments and what changed on the records you follow."
        actions={
          <Button variant="secondary" size="sm" leading={<Checks size={16} />} onClick={markAll} disabled={!unread} loading={marking}>
            Mark all read
          </Button>
        }
      />

      {/* On a phone the reader replaces the list, so the list's own filters go with it. */}
      <div className={cn('flex items-center gap-3 border-b border-line px-5 py-2.5 sm:px-8', selected && 'hidden md:flex')}>
        <Segmented size="sm" value={filter} onChange={value => setFilter(value)} options={FILTERS.map(f => ({ value: f.value, label: f.label }))} />
        <span className="tabular text-meta text-ink-3">{unread ? `${unread} unread` : 'All read'}</span>
      </div>

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <div
          ref={listRef}
          className={cn('min-h-0 w-full shrink-0 overflow-y-auto border-line md:w-[380px] md:border-r lg:w-[420px]', selected && 'hidden md:block')}
        >
          {query.isPending ? (
            <ListSkeleton rows={7} />
          ) : query.isError ? (
            // Without this a failed fetch reads as "Your inbox is empty".
            <EmptyState
              compact
              icon={<WarningCircle size={22} weight="duotone" />}
              title="Your inbox didn’t load"
              actions={
                <Button variant="primary" size="sm" onClick={() => void query.refetch()}>
                  Try again
                </Button>
              }
            >
              {errorMessage(query.error, 'Something went wrong fetching your notifications.')}
            </EmptyState>
          ) : !notifications.length ? (
            <EmptyState
              compact
              icon={<Tray size={22} weight="duotone" />}
              title={filter === 'all' ? 'Your inbox is empty' : 'Nothing here'}
              actions={filter === 'all' ? undefined : <Button variant="secondary" size="sm" onClick={() => setFilter('all')}>Show everything</Button>}
            >
              {filter === 'all'
                ? 'When a teammate mentions you, assigns you a task or closes a deal you follow, it lands here.'
                : filter === 'unread'
                  ? 'You have read everything.'
                  : filter === 'mentions'
                    ? 'Nobody has mentioned you in a note yet.'
                    : 'Nothing has been assigned to you.'}
            </EmptyState>
          ) : (
            groups.map(group => (
              <section key={group.key}>
                {/* The list is a 420px column, not a page: it keeps the page gutter on the
                    left so it lines up with the header, but not on the right, where 32px
                    of padding was truncating titles for nothing. */}
                <h2 className="sticky top-0 z-10 border-b border-line bg-sunken py-1.5 pl-5 pr-4 text-micro font-semibold uppercase text-ink-3 sm:pl-8">{group.label}</h2>
                <ul>
                  {group.rows.map(notification => (
                    <NotificationRow key={notification.id} notification={notification} active={notification.id === selectedId} onOpen={() => open(notification)} />
                  ))}
                </ul>
              </section>
            ))
          )}
        </div>

        <div className={cn('min-h-0 min-w-0 flex-1 overflow-y-auto bg-paper', !selected && 'hidden md:block')}>
          {selected ? (
            <Reader
              notification={selected}
              onBack={() => setSelectedId(null)}
              onToggleRead={() => void markRead([selected.id], !selected.readAt)}
              onOpenRecord={() => selected.link && navigate(selected.link)}
            />
          ) : (
            <EmptyState icon={<Envelope size={22} weight="duotone" />} title="Nothing selected" className="h-full">
              Pick a notification to read it. J and K walk the list, Enter opens the record it points at.
            </EmptyState>
          )}
        </div>
      </div>
    </div>
  );
}

function NotificationRow({ notification, active, onOpen }: { notification: Notification; active: boolean; onOpen: () => void }) {
  const ws = useWorkspace();
  const meta = metaFor(notification.kind);
  const actor = ws.memberById(notification.actorId);
  return (
    <li>
      <button
        type="button"
        data-row-id={notification.id}
        onClick={onOpen}
        className={cn(
          'flex w-full items-start gap-3 border-b border-line py-3 pl-5 pr-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40 sm:pl-8',
          active ? 'bg-accent/[0.07] dark:bg-accent/10' : 'hover:bg-hover/60',
        )}
      >
        <span className="relative mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center">
          {actor ? <Avatar person={actor} size="md" /> : <span className="flex h-7 w-7 items-center justify-center rounded-full bg-sunken text-ink-2">{meta.icon}</span>}
        </span>
        <span className="min-w-0 flex-1">
          <span className={cn('block truncate text-ui', notification.readAt ? 'text-ink-2' : 'font-medium text-ink')}>{notification.title}</span>
          {notification.body && <span className="mt-0.5 block truncate text-meta text-ink-3">{notification.body}</span>}
          <span className="mt-1 flex items-center gap-2">
            <Badge tone={meta.tone}>{meta.label}</Badge>
            <span className="text-meta text-ink-3">{timeAgo(notification.occurredAt)}</span>
          </span>
        </span>
        {!notification.readAt && <span role="img" aria-label="Unread" className="mt-2 h-2 w-2 shrink-0 rounded-full bg-accent" />}
      </button>
    </li>
  );
}

function Reader({
  notification,
  onBack,
  onToggleRead,
  onOpenRecord,
}: {
  notification: Notification;
  onBack: () => void;
  onToggleRead: () => void;
  onOpenRecord: () => void;
}) {
  const ws = useWorkspace();
  const meta = metaFor(notification.kind);
  const actor = ws.memberById(notification.actorId);
  const label = targetLabel(notification);
  return (
    <article className="mx-auto flex w-full max-w-[680px] flex-col gap-5 px-5 py-6 sm:px-8 animate-rise-in">
      <div className="flex items-center gap-2 md:hidden">
        <Button variant="ghost" size="sm" leading={<ArrowLeft size={16} />} onClick={onBack}>
          Inbox
        </Button>
      </div>
      <header className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <Badge tone={meta.tone} icon={meta.icon}>
            {meta.label}
          </Badge>
          <span className="text-meta text-ink-3">{dateTime(notification.occurredAt)}</span>
        </div>
        <h1 className="font-display text-display-sm text-ink text-pretty">{notification.title}</h1>
        {actor && (
          <div className="flex items-center gap-2 text-meta text-ink-2">
            <Avatar person={actor} size="sm" />
            {actor.name}
          </div>
        )}
      </header>

      {notification.body && <p className="whitespace-pre-wrap rounded-lg border border-line bg-card p-4 text-body text-ink text-pretty shadow-hairline">{notification.body}</p>}

      <div className="flex flex-wrap items-center gap-2">
        {notification.link && (
          <Button variant="primary" size="sm" trailing={<ArrowSquareOut size={15} />} onClick={onOpenRecord}>
            {label ?? 'Open the record'}
          </Button>
        )}
        <Button variant="secondary" size="sm" leading={notification.readAt ? <Envelope size={15} /> : <EnvelopeOpen size={15} />} onClick={onToggleRead}>
          {notification.readAt ? 'Mark unread' : 'Mark read'}
        </Button>
      </div>
    </article>
  );
}
