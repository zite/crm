import { Pause, Play, Prohibit, Users } from '@phosphor-icons/react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Avatar } from '../../ui/Avatar';
import { Badge } from '../../ui/Chip';
import { Button } from '../../ui/Button';
import { EmptyState, ListSkeleton } from '../../ui/Layout';
import { MenuItem } from '../../ui/Menu';
import { Segmented } from '../../ui/Form';
import { BulkBar, BulkButton } from '../../records/BulkBar';
import { Ledger, type Column } from '../../records/Ledger';
import { ListToolbar } from '../../records/Toolbar';
import { useListNav } from '../../records/useListNav';
import { CompanyMark } from '../../glyphs';
import { useAppActions } from '../../lib/app-actions';
import { dateTime, timeAgo } from '../../lib/format';
import { useWorkspace } from '../../lib/workspace';
import { ENROLLMENT_STATUS_TONE, exitTone, type Enrollment } from './model';
import { useEnrollments, useSequenceActions } from './queries';

/**
 * Who is on a sequence: what step they are on, when the next one runs, and how
 * it ended for the ones that are over. Pause, resume and stop work on one row
 * or on everything you have selected.
 */
export function EnrollmentsTable({ sequenceId, canManage, onEnroll }: { sequenceId: string; canManage: boolean; onEnroll?: () => void }) {
  const ws = useWorkspace();
  const actions = useAppActions();
  const { updateEnrollments } = useSequenceActions();
  const [status, setStatus] = useState<'live' | 'Active' | 'Paused' | 'Finished' | 'Exited'>('live');
  const [search, setSearch] = useState('');

  const statuses = status === 'live' ? (['Active', 'Paused'] as const) : ([status] as const);
  const query = useEnrollments({ sequenceId, statuses: [...statuses], search: search.trim() || undefined, limit: 500 });
  const rows = query.data?.enrollments ?? [];

  const nav = useListNav({ items: rows, getId: e => e.id, enabled: !actions.paletteOpen });
  const selected = useMemo(() => rows.filter(r => nav.selected.has(r.id)), [rows, nav.selected]);

  const act = async (ids: string[], action: 'pause' | 'resume' | 'stop') => {
    if (action === 'stop') {
      const ok = await actions.confirm({
        title: ids.length === 1 ? 'Stop this enrollment?' : `Stop ${ids.length} enrollments?`,
        description: 'The remaining steps never run. The emails already sent and the tasks already created stay where they are.',
        confirmLabel: 'Stop',
        destructive: true,
      });
      if (!ok) return;
    }
    const result = await updateEnrollments.mutateAsync({ ids, action });
    nav.clearSelection();
    if (result.updated) toast.success(`${result.updated} ${result.updated === 1 ? 'enrollment' : 'enrollments'} ${action === 'pause' ? 'paused' : action === 'resume' ? 'resumed' : 'stopped'}`);
    else if (result.unchanged) toast.message('Nothing to change — they were already in that state');
  };

  const columns: Array<Column<Enrollment>> = [
    {
      key: 'contact',
      header: 'Contact',
      width: '30%',
      cell: e => (
        <div className="flex min-w-0 items-center gap-2.5">
          <CompanyMark name={e.companyName || e.contactName} id={e.companyId ?? e.id} size="sm" />
          <div className="min-w-0">
            <div className="truncate font-medium text-ink">
              {e.contactId ? (
                <Link to={`/contacts/${e.contactId}`} className="hover:text-accent" onClick={event => event.stopPropagation()}>
                  {e.contactName || 'Deleted contact'}
                </Link>
              ) : (
                'Deleted contact'
              )}
            </div>
            <div className="truncate text-meta text-ink-3">{e.companyName || e.contactEmail}</div>
          </div>
        </div>
      ),
      interactive: true,
    },
    {
      key: 'status',
      header: 'Status',
      width: '14%',
      cell: e =>
        e.status === 'Exited' && e.exitReason ? (
          <Badge tone={exitTone(e.exitReason)}>{e.exitReason}</Badge>
        ) : (
          <Badge tone={ENROLLMENT_STATUS_TONE[e.status] ?? 'neutral'} dot={e.status === 'Active'}>
            {e.status}
          </Badge>
        ),
    },
    {
      key: 'step',
      header: 'Step',
      width: '14%',
      cell: e => (
        <span className="tabular text-ink-2">
          {Math.min(e.stepIndex + (e.status === 'Active' || e.status === 'Paused' ? 1 : 0), e.stepCount) || e.stepCount} of {e.stepCount}
        </span>
      ),
    },
    {
      key: 'next',
      header: 'Next step',
      width: '18%',
      hide: 'md',
      cell: e => {
        if (e.status === 'Paused') return <span className="text-warning">Paused</span>;
        if (e.status === 'Finished') return <span className="text-ink-3">Finished {e.finishedAt ? timeAgo(e.finishedAt) : ''}</span>;
        if (e.status === 'Exited') return <span className="text-ink-3">Left {e.finishedAt ? timeAgo(e.finishedAt) : ''}</span>;
        if (!e.nextRunAt) return <span className="text-ink-3">Nothing scheduled</span>;
        const due = Date.parse(e.nextRunAt) <= Date.now();
        return <span className={due ? 'text-accent' : 'text-ink-2'}>{due ? 'Due now' : dateTime(e.nextRunAt)}</span>;
      },
    },
    {
      key: 'owner',
      header: 'Owner',
      width: '14%',
      hide: 'lg',
      cell: e => {
        const owner = ws.memberById(e.ownerId);
        return (
          <span className="flex items-center gap-2">
            {owner ? <Avatar person={owner} size="xs" /> : null}
            <span className="truncate">{owner?.name ?? 'Unassigned'}</span>
          </span>
        );
      },
    },
    { key: 'enrolled', header: 'Enrolled', width: '10%', hide: 'xl', cell: e => <span className="text-ink-3">{e.enrolledAt ? timeAgo(e.enrolledAt) : '—'}</span> },
  ];

  return (
    <div className="flex flex-col">
      <ListToolbar
        start={
          <Segmented
            size="sm"
            value={status}
            onChange={v => setStatus(v as typeof status)}
            options={[
              { value: 'live', label: 'On it now' },
              { value: 'Finished', label: 'Finished' },
              { value: 'Exited', label: 'Left early' },
            ]}
          />
        }
        count={rows.length}
        countLabel="contact"
        search={search}
        onSearch={setSearch}
        more={<MenuItem onSelect={() => query.refetch()}>Refresh</MenuItem>}
      />

      <div ref={nav.scrollRef}>
        {query.isPending ? (
          <ListSkeleton rows={5} />
        ) : rows.length === 0 ? (
          <EmptyState
            compact
            icon={<Users size={22} weight="duotone" />}
            title={search ? 'Nobody matches that' : status === 'live' ? 'Nobody is on this sequence' : status === 'Finished' ? 'Nobody has finished it yet' : 'Nobody has left early'}
            actions={
              search ? (
                <Button variant="secondary" onClick={() => setSearch('')}>
                  Clear search
                </Button>
              ) : status === 'live' && canManage && onEnroll ? (
                <Button variant="primary" onClick={onEnroll}>
                  Enroll contacts
                </Button>
              ) : undefined
            }
          >
            {search ? 'Try a different name, email or company.' : status === 'live' ? 'Enrol a few contacts and the first step goes out at the next scheduled run.' : 'They will show up here as people work through the cadence.'}
          </EmptyState>
        ) : (
          <Ledger
            rows={rows}
            columns={columns}
            getId={e => e.id}
            focusId={nav.focusId}
            selected={canManage ? nav.selected : undefined}
            onToggleSelect={canManage ? nav.toggleSelect : undefined}
            onToggleAll={() => (nav.allSelected ? nav.clearSelection() : nav.selectAll())}
          />
        )}
      </div>

      {canManage && (
        <BulkBar count={nav.selected.size} noun="enrollment" onClear={nav.clearSelection}>
          {selected.some(e => e.status === 'Active') && (
            <BulkButton leading={<Pause size={15} />} onClick={() => void act(selected.filter(e => e.status === 'Active').map(e => e.id), 'pause')}>
              Pause
            </BulkButton>
          )}
          {selected.some(e => e.status === 'Paused') && (
            <BulkButton leading={<Play size={15} />} onClick={() => void act(selected.filter(e => e.status === 'Paused').map(e => e.id), 'resume')}>
              Resume
            </BulkButton>
          )}
          <BulkButton leading={<Prohibit size={15} />} onClick={() => void act(selected.filter(e => e.status === 'Active' || e.status === 'Paused').map(e => e.id), 'stop')}>
            Stop
          </BulkButton>
        </BulkBar>
      )}
    </div>
  );
}
