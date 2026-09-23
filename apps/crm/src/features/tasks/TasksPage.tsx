import { ArrowsClockwise, CalendarPlus, CheckCircle, DotsThree, DownloadSimple, ListChecks, Plus, Trash, WarningCircle } from '@phosphor-icons/react';
import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { deleteTasks as deleteTasksApi, listTasks as listTasksApi, type ListTasksInputType } from 'zitejs/api';
import { addDays, startOfWeek } from '@project/shared/dates';
import type { TaskPriority, TaskType } from '@project/shared/constants';
import { Avatar, Unassigned } from '../../ui/Avatar';
import { Badge } from '../../ui/Chip';
import { Button } from '../../ui/Button';
import { EmptyState, ListSkeleton, PageHeader } from '../../ui/Layout';
import { Menu, MenuContent, MenuItem, MenuLabel, MenuRadioGroup, MenuRadioItem, MenuSeparator, MenuSub, MenuSubContent, MenuSubTrigger, MenuTrigger } from '../../ui/Menu';
import { Tabs } from '../../ui/Tabs';
import { Tooltip } from '../../ui/Tooltip';
import { cn } from '../../ui/cn';
import { DatePicker, MemberPicker } from '../../pickers/pickers';
import { BulkBar, BulkButton } from '../../records/BulkBar';
import { Ledger, type Column } from '../../records/Ledger';
import { SaveViewDialog } from '../../records/SaveViewDialog';
import { FilterChips, ListToolbar } from '../../records/Toolbar';
import { useListNav } from '../../records/useListNav';
import { useListState } from '../../records/useListState';
import { useAppActions } from '../../lib/app-actions';
import { downloadCsv } from '../../lib/csv';
import { errorMessage } from '../../lib/errors';
import { clockLabel, daysFromToday, fullDate, shortDate, todayString } from '../../lib/format';
import { invalidate, useTasks } from '../../lib/queries';
import { useTaskActions } from '../../lib/mutations';
import { useDocumentTitle } from '../../lib/useDocumentTitle';
import { invalidateWorkspace, useWorkspace } from '../../lib/workspace';
import { localDay } from './meetingHelpers';
import { TaskFilterMenu, taskFilterChips, type TaskFilters } from './TaskFilters';
import { DueCell, RelatedLink, TaskCheck, TaskTitle, pathFor, relatedOf, type Task } from './taskHelpers';
import { TasksNav } from './TasksNav';

type TaskSort = NonNullable<ListTasksInputType['sort']>;
type Tab = 'today' | 'upcoming' | 'overdue' | 'unscheduled' | 'done' | 'team';

const TABS: Array<{ value: Tab; label: string }> = [
  { value: 'today', label: 'Today' },
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'unscheduled', label: 'Unscheduled' },
  { value: 'done', label: 'Done' },
  { value: 'team', label: 'Team' },
];

const SORTS: Array<{ value: TaskSort['key']; label: string }> = [
  { value: 'dueDate', label: 'Due date' },
  { value: 'priority', label: 'Priority' },
  { value: 'created', label: 'Created' },
  { value: 'title', label: 'Title' },
];

const EMPTY: Record<Tab, { title: string; body: string }> = {
  today: { title: 'Nothing due today', body: 'You are clear. Anything you add with today’s date lands here.' },
  upcoming: { title: 'Nothing scheduled ahead', body: 'Give a deal its next step and it shows up here.' },
  overdue: { title: 'Nothing overdue', body: 'Everything with a date is still ahead of you.' },
  unscheduled: { title: 'Everything has a date', body: 'Tasks without a due date collect here so none get lost.' },
  done: { title: 'Nothing finished yet', body: 'Completed tasks stay here so you can see what got done.' },
  team: { title: 'The team has no open tasks', body: 'Every open task across the organization shows up here.' },
};

/**
 * The day a task was finished, in the reader's timezone. Slicing the ISO string
 * takes the UTC day, which reads as tomorrow for anything ticked after 5pm Pacific.
 */
function completedOn(task: Task) {
  return task.completedAt ? shortDate(localDay(task.completedAt)) : '—';
}

/** Done tasks are ordered by when they were finished, so the menu says so. */
function sortLabel(key: TaskSort['key'], tab: Tab) {
  if (key === 'dueDate' && tab === 'done') return 'Completed';
  return SORTS.find(s => s.value === key)?.label ?? 'Sort';
}

/** "Today" / "Tomorrow" / "Yesterday" / a weekday inside the week / the plain date. */
function bandDay(day: string, today: string) {
  const days = daysFromToday(day, today);
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days === -1) return 'Yesterday';
  if (days != null && Math.abs(days) < 7) return new Date(`${day}T00:00:00`).toLocaleDateString('en-US', { weekday: 'long' });
  return fullDate(day);
}

/** Your work queue: one ledger, six ways in. */
export function TasksPage() {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const actions = useAppActions();
  const taskActions = useTaskActions();
  const [params, setParams] = useSearchParams();
  const [saveOpen, setSaveOpen] = useState(false);
  const today = todayString();
  useDocumentTitle('Tasks', ws.settings.organizationName);

  const tab = (TABS.find(t => t.value === params.get('tab'))?.value ?? 'today') as Tab;
  const setTab = (value: string) => setParams(value === 'today' ? {} : { tab: value }, { replace: true });
  const viewId = params.get('view');
  const savedView = viewId ? ws.views.find(v => v.id === viewId) ?? null : null;

  const list = useListState<TaskFilters, TaskSort['key']>('tasks', {
    layout: 'list',
    sort: { key: 'dueDate', dir: 'asc' },
    groupBy: null,
    columns: null,
    filters: {},
    search: '',
  });
  const f = list.state.filters;
  const dueIsFree = tab === 'team' || tab === 'done';

  const serverFilters = useMemo<NonNullable<ListTasksInputType['filters']>>(() => {
    const base: NonNullable<ListTasksInputType['filters']> = { status: tab === 'done' ? 'Done' : 'Open' };
    const ownerIds = f.ownerIds?.length ? f.ownerIds : tab === 'team' ? undefined : [ws.me.id];
    if (ownerIds) base.ownerIds = ownerIds;
    if (f.types?.length) base.types = f.types as TaskType[];
    if (f.priorities?.length) base.priorities = f.priorities as TaskPriority[];
    if (list.state.search.trim()) base.search = list.state.search.trim();
    const due = dueIsFree ? f.due ?? 'any' : 'any';
    if (due !== 'any') {
      if (due === 'overdue') base.overdue = true;
      else if (due === 'today') Object.assign(base, { dueFrom: today, dueTo: today });
      else if (due === 'next7') Object.assign(base, { dueFrom: today, dueTo: addDays(today, 7) });
      else if (due === 'next30') Object.assign(base, { dueFrom: today, dueTo: addDays(today, 30) });
      else if (due === 'none') base.noDueDate = true;
    } else if (tab === 'today') Object.assign(base, { dueFrom: today, dueTo: today });
    else if (tab === 'upcoming') base.dueFrom = addDays(today, 1);
    else if (tab === 'overdue') base.overdue = true;
    else if (tab === 'unscheduled') base.noDueDate = true;
    return base;
  }, [tab, f, list.state.search, ws.me.id, today, dueIsFree]);

  // On Done, "due date" means "completed": the endpoint can't order by completedAt, so
  // the rows come back newest-due-first and get re-ordered below. Every other sort key
  // still works, so the menu is never a dead control.
  const sortsByCompleted = tab === 'done' && list.state.sort.key === 'dueDate';
  const query = useTasks({ filters: serverFilters, sort: sortsByCompleted ? { key: 'dueDate', dir: 'desc' } : list.state.sort, limit: 500, today });
  const counts = query.data?.counts;

  // Only "related to" is filtered here: listTasks matches a specific record, not a kind.
  const tasks = useMemo(() => {
    const rows = query.data?.tasks ?? [];
    const kind = f.related ?? 'any';
    const filtered = kind === 'any' ? rows : kind === 'none' ? rows.filter(t => !relatedOf(t)) : rows.filter(t => relatedOf(t)?.kind === kind);
    // A column that shows the completion date ordered by the due date looks broken.
    if (!sortsByCompleted) return filtered;
    return [...filtered].sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''));
  }, [query.data, f.related, sortsByCompleted]);

  const nav = useListNav({
    items: tasks,
    getId: t => t.id,
    onOpen: task => {
      const related = relatedOf(task);
      if (related) navigate(pathFor(related));
    },
    onPeek: task => {
      const related = relatedOf(task);
      if (related) actions.openPeek({ type: related.kind, id: related.id });
    },
    enabled: !actions.paletteOpen,
  });

  const canEdit = ws.can('records.edit');

  const setDone = (ids: string[], done: boolean) => {
    taskActions.complete.mutate({ ids, done });
    if (done) {
      toast.success(ids.length === 1 ? 'Task completed' : `${ids.length} tasks completed`, {
        action: { label: 'Undo', onClick: () => taskActions.complete.mutate({ ids, done: false }) },
      });
    }
  };

  const reschedule = (ids: string[], dueDate: string | null, label: string) => {
    taskActions.update.mutate({ ids, patch: { dueDate } }, { onSuccess: () => toast.success(ids.length === 1 ? `Moved to ${label}` : `${ids.length} tasks moved to ${label}`) });
  };

  const rescheduleOverdue = async () => {
    const ok = await actions.confirm({
      title: 'Move every overdue task to today?',
      description: `${counts?.overdue ?? 0} open tasks are past their due date. They all get today’s date.`,
      confirmLabel: 'Move to today',
    });
    if (!ok) return;
    try {
      const overdue = await listTasksApi({ filters: { ownerIds: f.ownerIds?.length ? f.ownerIds : [ws.me.id], status: 'Open', overdue: true }, limit: 500, today });
      const ids = overdue.tasks.map(t => t.id);
      if (!ids.length) {
        toast.message('Nothing was overdue');
        return;
      }
      await taskActions.update.mutateAsync({ ids, patch: { dueDate: today } });
      toast.success(`${ids.length} tasks moved to today`);
    } catch (e) {
      toast.error(errorMessage(e, 'Couldn’t reschedule those tasks'));
    }
  };

  const remove = async (ids: string[]) => {
    const ok = await actions.confirm({
      title: ids.length === 1 ? 'Delete this task?' : `Delete ${ids.length} tasks?`,
      description: 'They disappear from the record they sit on too. This can’t be undone.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    try {
      const result = await deleteTasksApi({ ids });
      toast.success(result.deleted === 1 ? 'Task deleted' : `${result.deleted} tasks deleted`);
      nav.clearSelection();
      invalidate(qc, 'tasks', 'home', 'deals', 'deal', 'timeline');
      void invalidateWorkspace(qc);
    } catch (e) {
      toast.error(errorMessage(e, 'Couldn’t delete that task'));
    }
  };

  const columns: Array<Column<Task>> = [
    {
      key: 'title',
      header: 'Task',
      sort: 'title',
      width: '34%',
      cell: task => (
        <div className="flex min-w-0 items-center gap-2.5">
          <TaskCheck done={task.status === 'Done'} disabled={!canEdit} label={task.title} onToggle={() => setDone([task.id], task.status !== 'Done')} />
          <span className="min-w-0 flex-1">
            {task.notes ? (
              <Tooltip content={task.notes.slice(0, 220)}>
                <span className="block min-w-0">
                  <TaskTitle task={task} />
                </span>
              </Tooltip>
            ) : (
              <TaskTitle task={task} />
            )}
            {/* Below `sm` every other column is hidden, so the row carries its own context. */}
            <span className="flex min-w-0 items-center gap-2 truncate pl-[23px] text-meta text-ink-3 sm:hidden">
              <RelatedLink related={relatedOf(task)} className="text-meta" />
              {tab === 'done' ? (
                <span className="tabular shrink-0">{completedOn(task)}</span>
              ) : (
                <DueCell day={task.dueDate} done={task.status === 'Done'} today={today} className="shrink-0" />
              )}
            </span>
          </span>
        </div>
      ),
    },
    { key: 'related', header: 'Related to', width: '22%', hide: 'sm', interactive: true, cell: task => <RelatedLink related={relatedOf(task)} /> },
    {
      key: 'due',
      header: tab === 'done' ? 'Completed' : 'Due',
      // No caret on Completed: the rows are ordered by completion, not by the due date the endpoint sorts on.
      sort: tab === 'done' ? undefined : 'dueDate',
      width: '13%',
      // The phone gets the due date on the row's own second line instead.
      hide: 'sm',
      interactive: tab !== 'done',
      cell: task => {
        if (tab === 'done') return <span className="tabular text-ink-2">{completedOn(task)}</span>;
        const value = (
          <span className="flex items-baseline gap-1.5">
            <DueCell day={task.dueDate} done={task.status === 'Done'} today={today} />
            {task.dueTime && <span className="tabular text-meta text-ink-3">{clockLabel(task.dueTime)}</span>}
          </span>
        );
        if (!canEdit) return value;
        return (
          <DatePicker
            value={task.dueDate}
            onChange={dueDate => reschedule([task.id], dueDate, dueDate ? shortDate(dueDate) : 'no date')}
            trigger={
              <button className="-mx-1 flex max-w-full items-center rounded-sm px-1 py-1 hover:bg-hover" aria-label={`Due ${task.dueDate ?? 'never'}`}>
                {value}
              </button>
            }
          />
        );
      },
    },
    {
      key: 'priority',
      header: 'Priority',
      sort: 'priority',
      width: '10%',
      hide: 'md',
      cell: task => (task.priority === 'High' ? <Badge tone="danger">High</Badge> : <span className="text-ink-3">{task.priority}</span>),
    },
    {
      key: 'owner',
      header: 'Owner',
      width: '13%',
      hide: 'md',
      interactive: true,
      cell: task => {
        const owner = ws.memberById(task.ownerId);
        const label = (
          <span className="flex items-center gap-1.5 truncate">
            {owner ? <Avatar person={owner} size="xs" /> : <Unassigned size="xs" />}
            <span className="truncate text-ui">{owner?.name.split(' ')[0] ?? 'Unassigned'}</span>
          </span>
        );
        if (!canEdit) return label;
        return (
          <MemberPicker
            value={task.ownerId}
            onChange={ownerId => taskActions.update.mutate({ ids: [task.id], patch: { ownerId } })}
            trigger={
              <button className="flex max-w-full items-center gap-1.5 rounded-sm px-1 py-1 hover:bg-hover" aria-label={`Owner: ${owner?.name ?? 'Unassigned'}`}>
                {label}
              </button>
            }
          />
        );
      },
    },
  ];

  // Upcoming and Team span many days; a band per day makes the list readable.
  const groups = useMemo(() => {
    if ((tab !== 'upcoming' && tab !== 'team') || list.state.sort.key !== 'dueDate') return undefined;
    const map = new Map<string, Task[]>();
    for (const task of tasks) {
      const key = task.dueDate ?? 'none';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(task);
    }
    return [...map.entries()].map(([key, rows]) => {
      // A band that says "Sep 17, 2026" beside a row that says "Thu" makes you do the
      // arithmetic twice. Name the day the way the rows do, and keep the date beside it.
      const date = fullDate(key);
      const name = key === 'none' ? 'No due date' : bandDay(key, today);
      return {
        key,
        label:
          name === date ? (
            name
          ) : (
            <span className="flex items-baseline gap-2">
              {name}
              {key !== 'none' && <span className="text-meta font-normal text-ink-3">{date}</span>}
            </span>
          ),
        count: rows.length,
        rows,
      };
    });
  }, [tasks, tab, list.state.sort.key, today]);

  const orderedRows = groups ? groups.flatMap(g => g.rows) : tasks;
  const chips = taskFilterChips(f, list.setFilters, ws);

  const exportCsv = () =>
    downloadCsv(
      `tasks-${tab}`,
      ['Task', 'Type', 'Status', 'Priority', 'Due date', 'Due time', 'Owner', 'Related to', 'Record', 'Notes'],
      tasks.map(task => {
        const related = relatedOf(task);
        return [task.title, task.type, task.status, task.priority, task.dueDate ?? '', task.dueTime ?? '', ws.memberName(task.ownerId), related?.kind ?? '', related?.name ?? '', task.notes ?? ''];
      }),
    );

  const tabItems = TABS.map(item => ({
    value: item.value,
    label: item.label,
    count:
      item.value === 'today' ? counts?.today ?? null
      : item.value === 'upcoming' ? counts?.upcoming ?? null
      : item.value === 'overdue' ? counts?.overdue ?? null
      : item.value === 'unscheduled' ? counts?.unscheduled ?? null
      : item.value === 'done' ? counts?.done ?? null
      : counts?.team ?? null,
  }));

  return (
    <div className="flex min-h-full flex-col">
      <PageHeader
        eyebrow="Tasks"
        title={savedView?.name ?? 'My tasks'}
        description="Everything you owe someone, in the order it comes due."
        actions={
          <>
            {ws.viewsFor('Tasks').length > 0 && (
              <Menu>
                <MenuTrigger asChild>
                  <Button variant="secondary" size="sm">
                    Views
                  </Button>
                </MenuTrigger>
                <MenuContent align="end">
                  <MenuLabel>Saved views</MenuLabel>
                  {ws.viewsFor('Tasks').map(view => (
                    <MenuItem
                      key={view.id}
                      onSelect={() => {
                        list.applyConfig(view.config as never);
                        setParams({ view: view.id, ...(((view.config as { tab?: string }).tab) ? { tab: String((view.config as { tab?: string }).tab) } : {}) });
                      }}
                    >
                      {view.name}
                    </MenuItem>
                  ))}
                  <MenuSeparator />
                  <MenuItem onSelect={() => setSaveOpen(true)}>Save current as view…</MenuItem>
                </MenuContent>
              </Menu>
            )}
            {canEdit && (
              <Button variant="primary" size="sm" leading={<Plus size={16} weight="bold" />} onClick={() => actions.openCreate('task')}>
                New task
              </Button>
            )}
          </>
        }
        tabs={<Tabs items={tabItems} value={tab} onChange={setTab} end={<TasksNav current="tasks" />} />}
      />

      <ListToolbar
        className="mt-1"
        start={
          <>
            <TaskFilterMenu filters={f} onChange={list.setFilters} showDue={dueIsFree} />
            <Menu>
              <MenuTrigger asChild>
                <Button variant="ghost" size="sm">
                  {sortLabel(list.state.sort.key, tab)}
                </Button>
              </MenuTrigger>
              <MenuContent>
                <MenuLabel>Sort by</MenuLabel>
                <MenuRadioGroup value={list.state.sort.key} onValueChange={key => list.setSort({ key: key as TaskSort['key'], dir: key === 'priority' ? 'asc' : key === 'created' ? 'desc' : 'asc' })}>
                  {SORTS.map(s => (
                    <MenuRadioItem key={s.value} value={s.value}>
                      {sortLabel(s.value, tab)}
                    </MenuRadioItem>
                  ))}
                </MenuRadioGroup>
              </MenuContent>
            </Menu>
          </>
        }
        count={tasks.length}
        countLabel="task"
        search={list.state.search}
        onSearch={list.setSearch}
        more={
          <>
            {canEdit && (counts?.overdue ?? 0) > 0 && (
              <MenuItem icon={<CalendarPlus size={16} />} onSelect={() => void rescheduleOverdue()}>
                Reschedule overdue to today
              </MenuItem>
            )}
            {ws.can('data.export') && (
              <MenuItem icon={<DownloadSimple size={16} />} onSelect={exportCsv}>
                Export CSV
              </MenuItem>
            )}
            <MenuItem icon={<ArrowsClockwise size={16} />} onSelect={() => void query.refetch()}>
              Refresh
            </MenuItem>
            {canEdit && <MenuItem onSelect={() => setSaveOpen(true)}>Save as view…</MenuItem>}
          </>
        }
      />
      <FilterChips chips={chips} onClear={chips.length ? () => list.reset() : undefined} />

      <div ref={nav.scrollRef} className="min-h-0 flex-1">
        {query.isPending ? (
          <ListSkeleton rows={8} />
        ) : query.isError ? (
          // Without this a failed fetch renders "Nothing due today" — a lie you act on.
          <EmptyState
            icon={<WarningCircle size={22} weight="duotone" />}
            title="Your tasks didn’t load"
            actions={
              <Button variant="primary" onClick={() => void query.refetch()}>
                Try again
              </Button>
            }
          >
            {errorMessage(query.error, 'Something went wrong fetching your tasks.')}
          </EmptyState>
        ) : tasks.length === 0 ? (
          <EmptyState
            icon={<ListChecks size={22} weight="duotone" />}
            title={list.isFiltered ? 'Nothing matches those filters' : EMPTY[tab].title}
            actions={
              list.isFiltered ? (
                <Button variant="secondary" onClick={() => list.reset()}>
                  Clear filters
                </Button>
              ) : canEdit ? (
                <Button variant="primary" onClick={() => actions.openCreate('task')}>
                  New task
                </Button>
              ) : undefined
            }
          >
            {list.isFiltered ? 'Try removing a filter, or clear them all.' : EMPTY[tab].body}
          </EmptyState>
        ) : (
          <Ledger
            rows={orderedRows}
            columns={columns}
            getId={t => t.id}
            // Below `sm` this list is title-only, so the house 720px would be
            // hundreds of pixels of empty scroll on a phone.
            minWidth={560}
            sort={list.state.sort}
            onSort={key => list.toggleSort(key as TaskSort['key'])}
            // A click opens the record the task hangs off. Space still asks for a peek
            // sheet, which the shell mounts once every record kind has one.
            onRowClick={task => {
              const related = relatedOf(task);
              if (related) navigate(pathFor(related));
            }}
            focusId={nav.focusId}
            selected={nav.selected}
            onToggleSelect={nav.toggleSelect}
            onToggleAll={() => (nav.allSelected ? nav.clearSelection() : nav.selectAll())}
            groups={groups}
            rowMenu={
              canEdit
                ? task => (
                    <Menu>
                      <MenuTrigger asChild>
                        <Button variant="ghost" size="xs" icon aria-label="Task actions">
                          <DotsThree size={16} weight="bold" />
                        </Button>
                      </MenuTrigger>
                      <MenuContent align="end">
                        <MenuItem icon={<CheckCircle size={16} />} onSelect={() => setDone([task.id], task.status !== 'Done')}>
                          {task.status === 'Done' ? 'Reopen' : 'Mark done'}
                        </MenuItem>
                        <MenuSub>
                          <MenuSubTrigger icon={<CalendarPlus size={16} />}>Reschedule</MenuSubTrigger>
                          <MenuSubContent>
                            <MenuItem onSelect={() => reschedule([task.id], today, 'today')}>Today</MenuItem>
                            <MenuItem onSelect={() => reschedule([task.id], addDays(today, 1), 'tomorrow')}>Tomorrow</MenuItem>
                            <MenuItem onSelect={() => reschedule([task.id], startOfWeek(addDays(today, 7)), 'next week')}>Next Monday</MenuItem>
                            <MenuSeparator />
                            <MenuItem onSelect={() => reschedule([task.id], null, 'no date')}>Clear the date</MenuItem>
                          </MenuSubContent>
                        </MenuSub>
                        <MenuSeparator />
                        <MenuItem icon={<Trash size={16} />} destructive onSelect={() => void remove([task.id])}>
                          Delete
                        </MenuItem>
                      </MenuContent>
                    </Menu>
                  )
                : undefined
            }
          />
        )}
      </div>

      <BulkBar count={nav.selected.size} noun="task" onClear={nav.clearSelection}>
        {canEdit && (
          <BulkButton
            leading={<CheckCircle size={15} />}
            onClick={() => {
              setDone([...nav.selected], tab !== 'done');
              nav.clearSelection();
            }}
          >
            {tab === 'done' ? 'Reopen' : 'Complete'}
          </BulkButton>
        )}
        {canEdit && (
          <Menu>
            <MenuTrigger asChild>
              <BulkButton leading={<CalendarPlus size={15} />}>Reschedule</BulkButton>
            </MenuTrigger>
            <MenuContent align="center" side="top">
              <MenuItem
                onSelect={() => {
                  reschedule([...nav.selected], today, 'today');
                  nav.clearSelection();
                }}
              >
                Today
              </MenuItem>
              <MenuItem
                onSelect={() => {
                  reschedule([...nav.selected], addDays(today, 1), 'tomorrow');
                  nav.clearSelection();
                }}
              >
                Tomorrow
              </MenuItem>
              <MenuItem
                onSelect={() => {
                  reschedule([...nav.selected], startOfWeek(addDays(today, 7)), 'next week');
                  nav.clearSelection();
                }}
              >
                Next Monday
              </MenuItem>
            </MenuContent>
          </Menu>
        )}
        {canEdit && (
          <MemberPicker
            value={null}
            align="end"
            onChange={ownerId => {
              const ids = [...nav.selected];
              taskActions.update.mutate({ ids, patch: { ownerId } }, { onSuccess: () => toast.success(`${ids.length === 1 ? 'Task' : `${ids.length} tasks`} reassigned`) });
              nav.clearSelection();
            }}
            trigger={<BulkButton>Assign</BulkButton>}
          />
        )}
        {canEdit && <BulkButton leading={<Trash size={15} />} onClick={() => void remove([...nav.selected])}>Delete</BulkButton>}
      </BulkBar>

      <SaveViewDialog
        open={saveOpen}
        onOpenChange={setSaveOpen}
        scope="Tasks"
        config={{ tab, filters: f, sort: list.state.sort, search: list.state.search }}
        existing={savedView}
      />
    </div>
  );
}
