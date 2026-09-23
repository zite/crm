import { Copy, DotsThree, Lightning, Path, Pause, Play, Plus, Trash } from '@phosphor-icons/react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { getSequence } from 'zitejs/api';
import { Avatar } from '../../ui/Avatar';
import { Badge } from '../../ui/Chip';
import { Button } from '../../ui/Button';
import { EmptyState, ListSkeleton, PageHeader, StatStrip } from '../../ui/Layout';
import { Menu, MenuContent, MenuItem, MenuLabel, MenuRadioGroup, MenuRadioItem, MenuSeparator, MenuTrigger } from '../../ui/Menu';
import { Ledger, type Column } from '../../records/Ledger';
import { FilterChips, ListToolbar } from '../../records/Toolbar';
import { useListNav } from '../../records/useListNav';
import { useListState } from '../../records/useListState';
import { useAppActions } from '../../lib/app-actions';
import { useDocumentTitle } from '../../lib/useDocumentTitle';
import { useWorkspace } from '../../lib/workspace';
import { CadenceBar } from './CadencePreview';
import { CreateSequenceDialog } from './CreateSequenceDialog';
import { OutreachTabs } from './OutreachTabs';
import { rate, SEQUENCE_STATUS_TONE, type SequenceRow } from './model';
import { useSequenceActions, useSequences } from './queries';

type Filters = { status?: string; scope?: 'all' | 'mine' };

/** Every sequence, with the numbers that say whether it is earning its place. */
export function SequencesPage() {
  const ws = useWorkspace();
  const navigate = useNavigate();
  const actions = useAppActions();
  const { save, remove } = useSequenceActions();
  const [creating, setCreating] = useState(false);
  useDocumentTitle('Sequences', ws.settings.organizationName);

  const list = useListState<Filters>('outreach.sequences', {
    layout: 'list',
    sort: { key: 'name', dir: 'asc' },
    groupBy: null,
    columns: null,
    filters: { status: 'live', scope: 'all' },
    search: '',
  });

  const query = useSequences();
  const canWrite = ws.can('outreach.send');

  const sequences = useMemo(() => {
    const term = list.state.search.trim().toLowerCase();
    const rows = (query.data?.sequences ?? []).filter(s => {
      if (list.state.filters.status === 'live' && s.status === 'Archived') return false;
      if (list.state.filters.status && list.state.filters.status !== 'live' && s.status !== list.state.filters.status) return false;
      if (list.state.filters.scope === 'mine' && s.ownerId !== ws.me.id) return false;
      if (term && !`${s.name} ${s.description}`.toLowerCase().includes(term)) return false;
      return true;
    });
    const dir = list.state.sort.dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      if (list.state.sort.key === 'active') return (a.active - b.active) * dir;
      if (list.state.sort.key === 'steps') return (a.stepCount - b.stepCount) * dir;
      if (list.state.sort.key === 'replied') return (rate(a.replied, a.totalEnrolled) - rate(b.replied, b.totalEnrolled)) * dir;
      return a.name.localeCompare(b.name) * dir;
    });
  }, [query.data, list.state, ws.me.id]);

  const totals = useMemo(() => {
    const all = query.data?.sequences ?? [];
    const live = all.filter(s => s.status === 'Active');
    const enrolled = all.reduce((n, s) => n + s.totalEnrolled, 0);
    const replied = all.reduce((n, s) => n + s.replied, 0);
    const meetings = all.reduce((n, s) => n + s.meetings, 0);
    return { live: live.length, active: all.reduce((n, s) => n + s.active, 0), enrolled, replied, meetings };
  }, [query.data]);

  const nav = useListNav({ items: sequences, getId: s => s.id, onOpen: s => navigate(`/outreach/sequences/${s.id}`), enabled: !actions.paletteOpen && !creating });

  /** A copy starts paused, so nobody sends a half-edited cadence by accident. */
  const duplicate = async (sequence: SequenceRow) => {
    const full = await getSequence({ id: sequence.id });
    const copy = await save.mutateAsync({
      name: `${sequence.name} (copy)`.slice(0, 120),
      description: sequence.description,
      status: 'Paused',
      shared: full.sequence.shared,
      steps: full.sequence.steps,
      settings: full.sequence.settings,
    });
    toast.success('Copied — it starts paused so you can edit it first');
    navigate(`/outreach/sequences/${copy.id}`);
  };

  const setStatus = async (sequence: SequenceRow, status: 'Active' | 'Paused' | 'Archived') => {
    await save.mutateAsync({ id: sequence.id, name: sequence.name, description: sequence.description, status });
    toast.success(status === 'Active' ? `“${sequence.name}” is running` : status === 'Paused' ? `“${sequence.name}” is paused` : `“${sequence.name}” archived`);
  };

  const columns: Array<Column<SequenceRow>> = [
    {
      key: 'name',
      header: 'Sequence',
      sort: 'name',
      width: '30%',
      cell: s => (
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium text-ink">{s.name}</span>
            {s.status !== 'Active' && <Badge tone={SEQUENCE_STATUS_TONE[s.status] ?? 'neutral'}>{s.status}</Badge>}
          </div>
          <div className="truncate text-meta text-ink-3">{s.description || 'No description'}</div>
        </div>
      ),
    },
    {
      key: 'steps',
      header: 'Cadence',
      sort: 'steps',
      width: '18%',
      cell: s => (
        <span className="flex items-center gap-2">
          <CadenceBar days={s.days} />
          <span className="whitespace-nowrap text-meta text-ink-2">
            {s.stepCount} {s.stepCount === 1 ? 'step' : 'steps'}
            {s.days.length > 1 ? ` · ${s.days[s.days.length - 1]}d` : ''}
          </span>
        </span>
      ),
    },
    { key: 'active', header: 'Enrolled now', sort: 'active', align: 'right', width: '11%', cell: s => <span className="tabular text-ink">{s.active + s.paused}</span> },
    {
      key: 'replied',
      header: 'Replied',
      sort: 'replied',
      align: 'right',
      width: '10%',
      hide: 'md',
      cell: s => (s.totalEnrolled ? <span className="tabular text-ink-2">{rate(s.replied, s.totalEnrolled)}%</span> : <span className="text-ink-3">—</span>),
    },
    {
      key: 'meetings',
      header: 'Meetings',
      align: 'right',
      width: '10%',
      hide: 'xl',
      cell: s => (s.totalEnrolled ? <span className="tabular text-ink-2">{rate(s.meetings, s.totalEnrolled)}%</span> : <span className="text-ink-3">—</span>),
    },
    {
      key: 'owner',
      header: 'Owner',
      width: '13%',
      hide: 'lg',
      cell: s => {
        const owner = ws.memberById(s.ownerId);
        return (
          <span className="flex items-center gap-2">
            {owner ? <Avatar person={owner} size="xs" /> : null}
            <span className="truncate">{owner?.name ?? 'Unassigned'}</span>
          </span>
        );
      },
    },
  ];

  const chips = [
    ...(list.state.filters.status && list.state.filters.status !== 'live' ? [{ key: 'status', label: <>Status: {list.state.filters.status}</>, onRemove: () => list.setFilters({ status: 'live' }) }] : []),
    ...(list.state.filters.scope === 'mine' ? [{ key: 'scope', label: <>Mine</>, onRemove: () => list.setFilters({ scope: 'all' as const }) }] : []),
  ];

  return (
    <div className="flex min-h-full flex-col">
      <PageHeader
        title="Sequences"
        description="Multi-step outreach that runs itself, and stops the moment someone replies."
        actions={
          canWrite && (
            <Button variant="primary" size="sm" leading={<Plus size={16} weight="bold" />} onClick={() => setCreating(true)}>
              New sequence
            </Button>
          )
        }
        tabs={<OutreachTabs />}
      />

      <div className="px-5 pb-1 pt-5 sm:px-8">
        <StatStrip
          items={[
            { label: 'Running', value: totals.live, hint: `${(query.data?.sequences.length ?? 0) - totals.live} paused or archived` },
            { label: 'Enrolled now', value: totals.active, hint: 'People with a step still to come' },
            { label: 'Ever enrolled', value: totals.enrolled, hint: 'Across every sequence' },
            { label: 'Replied', value: `${rate(totals.replied, totals.enrolled)}%`, hint: `${totals.replied} came off after replying` },
            { label: 'Meetings', value: `${rate(totals.meetings, totals.enrolled)}%`, hint: `${totals.meetings} booked a meeting` },
          ]}
        />
      </div>

      <ListToolbar
        className="mt-5"
        start={
          <Menu>
            <MenuTrigger asChild>
              <Button variant="ghost" size="sm">
                Filter
              </Button>
            </MenuTrigger>
            <MenuContent>
              <MenuLabel>Status</MenuLabel>
              <MenuRadioGroup value={list.state.filters.status ?? 'live'} onValueChange={v => list.setFilters({ status: v })}>
                <MenuRadioItem value="live">Active and paused</MenuRadioItem>
                <MenuRadioItem value="Active">Active only</MenuRadioItem>
                <MenuRadioItem value="Paused">Paused only</MenuRadioItem>
                <MenuRadioItem value="Archived">Archived</MenuRadioItem>
              </MenuRadioGroup>
              <MenuSeparator />
              <MenuLabel>Owner</MenuLabel>
              <MenuRadioGroup value={list.state.filters.scope ?? 'all'} onValueChange={v => list.setFilters({ scope: v as Filters['scope'] })}>
                <MenuRadioItem value="all">Everyone</MenuRadioItem>
                <MenuRadioItem value="mine">Only mine</MenuRadioItem>
              </MenuRadioGroup>
            </MenuContent>
          </Menu>
        }
        count={sequences.length}
        countLabel="sequence"
        search={list.state.search}
        onSearch={list.setSearch}
        more={<MenuItem onSelect={() => query.refetch()}>Refresh</MenuItem>}
      />
      <FilterChips chips={chips} onClear={chips.length ? () => list.reset() : undefined} />

      <div ref={nav.scrollRef} className="min-h-0 flex-1">
        {query.isPending ? (
          <ListSkeleton rows={6} />
        ) : sequences.length === 0 ? (
          <EmptyState
            icon={<Path size={22} weight="duotone" />}
            title={list.isFiltered ? 'Nothing matches those filters' : 'No sequences yet'}
            actions={
              list.isFiltered ? (
                <Button variant="secondary" onClick={() => list.reset()}>
                  Clear filters
                </Button>
              ) : canWrite ? (
                <Button variant="primary" onClick={() => setCreating(true)}>
                  New sequence
                </Button>
              ) : undefined
            }
          >
            {list.isFiltered
              ? 'Try removing a filter, or clear them all.'
              : 'A sequence is a run of emails, calls and reminders spread over days. Enrol a contact and it works through them until they reply.'}
          </EmptyState>
        ) : (
          <Ledger
            rows={sequences}
            columns={columns}
            getId={s => s.id}
            sort={list.state.sort}
            onSort={key => list.toggleSort(key)}
            onRowClick={s => navigate(`/outreach/sequences/${s.id}`)}
            focusId={nav.focusId}
            rowMenu={s => (
              <Menu>
                <MenuTrigger asChild>
                  <Button variant="ghost" size="xs" icon aria-label={`Actions for ${s.name}`}>
                    <DotsThree size={16} weight="bold" />
                  </Button>
                </MenuTrigger>
                <MenuContent align="end">
                  <MenuItem icon={<Lightning size={16} />} onSelect={() => navigate(`/outreach/sequences/${s.id}`)}>
                    Open
                  </MenuItem>
                  {s.canManage && (
                    <>
                      {s.status === 'Active' ? (
                        <MenuItem icon={<Pause size={16} />} onSelect={() => void setStatus(s, 'Paused')}>
                          Pause sending
                        </MenuItem>
                      ) : (
                        <MenuItem icon={<Play size={16} />} onSelect={() => void setStatus(s, 'Active')}>
                          Start sending
                        </MenuItem>
                      )}
                      <MenuSeparator />
                      <MenuItem icon={<Copy size={16} />} onSelect={() => void duplicate(s)}>
                        Duplicate
                      </MenuItem>
                      {s.status !== 'Archived' && <MenuItem onSelect={() => void setStatus(s, 'Archived')}>Archive</MenuItem>}
                      <MenuItem
                        destructive
                        icon={<Trash size={16} />}
                        onSelect={async () => {
                          const ok = await actions.confirm({
                            title: `Delete “${s.name}”?`,
                            description: `Its ${s.totalEnrolled} enrollment${s.totalEnrolled === 1 ? '' : 's'} go too. The emails already sent and the tasks already created stay on their contacts.`,
                            confirmLabel: 'Delete',
                            destructive: true,
                          });
                          if (ok) remove.mutate([s.id]);
                        }}
                      >
                        Delete sequence
                      </MenuItem>
                    </>
                  )}
                </MenuContent>
              </Menu>
            )}
          />
        )}
      </div>

      {creating && <CreateSequenceDialog open onOpenChange={o => !o && setCreating(false)} defaults={{}} />}
    </div>
  );
}
