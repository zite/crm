import { ArrowSquareOut, CalendarBlank, Copy, DotsThree, Link as LinkIcon, Plus, Trash } from '@phosphor-icons/react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { AvatarStack } from '../../ui/Avatar';
import { Badge } from '../../ui/Chip';
import { Button } from '../../ui/Button';
import { Switch } from '../../ui/Form';
import { EmptyState, ListSkeleton, PageHeader, StatStrip } from '../../ui/Layout';
import { Menu, MenuContent, MenuItem, MenuTrigger } from '../../ui/Menu';
import { Tooltip } from '../../ui/Tooltip';
import { Ledger, type Column } from '../../records/Ledger';
import { ListToolbar } from '../../records/Toolbar';
import { useListNav } from '../../records/useListNav';
import { OutreachTabs } from '../outreach/OutreachTabs';
import { useAppActions } from '../../lib/app-actions';
import { copyText } from '../../lib/clipboard';
import { errorMessage } from '../../lib/errors';
import { timeAgo } from '../../lib/format';
import { useDocumentTitle } from '../../lib/useDocumentTitle';
import { useWorkspace } from '../../lib/workspace';
import { CreateMeetingLinkDialog } from './CreateMeetingLinkDialog';
import { availabilitySummary, durationLabel } from './meetingHelpers';
import { useBookingPages, useDeleteBookingPage, useSaveBookingPage } from './queries';
import type { ListBookingPagesOutputType } from 'zitejs/api';

type Row = ListBookingPagesOutputType['pages'][number];

/**
 * Meeting links: the pages a buyer lands on to book time. Few enough to be an
 * editorial list rather than a board — name, who takes the meeting, how long it
 * is, when it's open, and what it has produced.
 */
export function MeetingLinksPage() {
  const ws = useWorkspace();
  const navigate = useNavigate();
  const actions = useAppActions();
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  useDocumentTitle('Meeting links', ws.settings.organizationName);

  const query = useBookingPages();
  const save = useSaveBookingPage();
  const remove = useDeleteBookingPage();
  const canManage = ws.can('outreach.send');

  const all = query.data?.pages ?? [];
  const availability = query.data?.availabilityByPage ?? {};
  const pagesUrl = query.data?.pagesUrl ?? '';
  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return all;
    return all.filter(p => `${p.name} ${p.slug} ${p.description}`.toLowerCase().includes(needle));
  }, [all, search]);

  const totals = useMemo(
    () => ({
      active: all.filter(p => p.active).length,
      bookings: all.reduce((sum, p) => sum + p.bookings, 0),
      upcoming: all.reduce((sum, p) => sum + p.upcoming, 0),
    }),
    [all],
  );

  const nav = useListNav({
    items: rows,
    getId: p => p.id,
    onOpen: page => navigate(`/outreach/meetings/${page.id}`),
    enabled: !actions.paletteOpen && !createOpen,
  });

  const linkFor = (page: Row) => (pagesUrl ? `${pagesUrl}/#/m/${page.slug}` : '');

  const copyLink = (page: Row) => {
    const url = linkFor(page);
    if (!url) {
      toast.error('Open CRM Pages once and the public address will be remembered');
      return;
    }
    void copyText(url, 'Link copied');
  };

  const toggleActive = (page: Row, active: boolean) => {
    save.mutate(
      { id: page.id, active },
      {
        onSuccess: () => toast.success(active ? `${page.name} is taking bookings` : `${page.name} is paused`),
      },
    );
  };

  const confirmDelete = async (page: Row) => {
    const ok = await actions.confirm({
      title: `Delete ${page.name}?`,
      description:
        page.bookings > 0
          ? `The link stops working straight away. The ${page.bookings === 1 ? 'meeting' : `${page.bookings} meetings`} booked through it stay on the contacts' timelines.`
          : 'The link stops working straight away. Nobody has booked through it yet.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    try {
      await remove.mutateAsync({ id: page.id, confirmUpcoming: true });
      toast.success(`${page.name} deleted`);
    } catch (e) {
      toast.error(errorMessage(e, 'Couldn’t delete the meeting link'));
    }
  };

  const columns: Array<Column<Row>> = [
    {
      key: 'name',
      header: 'Meeting link',
      width: '30%',
      cell: page => (
        <div className="min-w-0">
          <div className="truncate font-medium text-ink">{page.name}</div>
          <div className="truncate text-meta text-ink-3">/m/{page.slug}</div>
        </div>
      ),
    },
    {
      key: 'hosts',
      header: 'Hosts',
      width: '16%',
      cell: page => {
        const people = page.hostIds.map(hostId => ws.memberById(hostId)).filter((m): m is NonNullable<typeof m> => Boolean(m));
        if (!people.length) return <span className="text-ink-3">No host</span>;
        return (
          <span className="flex min-w-0 items-center gap-2">
            <AvatarStack people={people} max={3} size="sm" />
            <span className="truncate text-ui text-ink-2">{people.length === 1 ? people[0].name : `${people.length} in rotation`}</span>
          </span>
        );
      },
    },
    { key: 'duration', header: 'Length', width: '9%', cell: page => <span className="tabular text-ink-2">{durationLabel(page.durationMinutes)}</span> },
    {
      key: 'availability',
      header: 'Open',
      width: '20%',
      hide: 'lg',
      cell: page => <span className="truncate text-ink-2">{availabilitySummary(availability[page.id] ?? [[], [], [], [], [], [], []])}</span>,
    },
    {
      key: 'bookings',
      header: 'Booked',
      align: 'right',
      width: '10%',
      cell: page => (
        <span className="tabular">
          {page.bookings === 0 ? <span className="text-ink-3">None yet</span> : <>{page.bookings}{page.upcoming > 0 && <span className="ml-1.5 text-meta text-ink-3">· {page.upcoming} to come</span>}</>}
        </span>
      ),
    },
    { key: 'last', header: 'Last booking', width: '10%', hide: 'xl', cell: page => <span className="text-ink-3">{page.lastBookedAt ? timeAgo(page.lastBookedAt) : '—'}</span> },
    {
      key: 'active',
      header: 'Live',
      width: '9%',
      interactive: true,
      cell: page =>
        canManage ? (
          <span className="flex items-center gap-2">
            <Switch checked={page.active} onCheckedChange={value => toggleActive(page, value)} />
            <span className="text-meta text-ink-3">{page.active ? 'On' : 'Off'}</span>
          </span>
        ) : (
          <Badge tone={page.active ? 'success' : 'neutral'}>{page.active ? 'Live' : 'Paused'}</Badge>
        ),
    },
    {
      key: 'actions',
      header: '',
      width: '8%',
      align: 'right',
      interactive: true,
      cell: page => (
        <span className="flex items-center justify-end gap-0.5">
          <Tooltip content="Copy the public link">
            <Button variant="ghost" size="sm" icon aria-label={`Copy the link to ${page.name}`} onClick={() => copyLink(page)}>
              <Copy size={16} />
            </Button>
          </Tooltip>
          <Menu>
            <MenuTrigger asChild>
              <Button variant="ghost" size="sm" icon aria-label={`More actions for ${page.name}`}>
                <DotsThree size={18} weight="bold" />
              </Button>
            </MenuTrigger>
            <MenuContent align="end">
              <MenuItem icon={<LinkIcon size={16} />} onSelect={() => copyLink(page)}>
                Copy link
              </MenuItem>
              <MenuItem icon={<ArrowSquareOut size={16} />} disabled={!linkFor(page)} onSelect={() => linkFor(page) && window.open(linkFor(page), '_blank', 'noopener')}>
                Open the public page
              </MenuItem>
              <MenuItem icon={<CalendarBlank size={16} />} onSelect={() => navigate(`/outreach/meetings/${page.id}?tab=bookings`)}>
                See its bookings
              </MenuItem>
              {canManage && (
                <MenuItem icon={<Trash size={16} />} destructive onSelect={() => void confirmDelete(page)}>
                  Delete
                </MenuItem>
              )}
            </MenuContent>
          </Menu>
        </span>
      ),
    },
  ];

  return (
    <div className="flex min-h-full flex-col">
      <PageHeader
        title="Meeting links"
        description="A page a buyer can open and put themselves in someone's calendar. You set the hours; it never offers a time you're not free."
        tabs={<OutreachTabs />}
        actions={
          canManage ? (
            <Button variant="primary" size="sm" leading={<Plus size={16} weight="bold" />} onClick={() => setCreateOpen(true)}>
              New meeting link
            </Button>
          ) : null
        }
      />

      {all.length > 0 && (
        <div className="px-5 pb-1 pt-5 sm:px-8">
          <StatStrip
            items={[
              { label: 'Live links', value: totals.active, hint: `of ${all.length} in total` },
              { label: 'Meetings booked', value: totals.bookings, hint: 'Through these links' },
              { label: 'Still to come', value: totals.upcoming, hint: 'Already in someone’s calendar' },
            ]}
          />
        </div>
      )}

      <ListToolbar className="mt-5" count={rows.length} countLabel="meeting link" search={search} onSearch={setSearch} />

      <div ref={nav.scrollRef} className="min-h-0 flex-1">
        {query.isPending ? (
          <ListSkeleton rows={4} />
        ) : query.isError ? (
          <EmptyState icon={<CalendarBlank size={22} weight="duotone" />} title="Couldn’t load your meeting links" actions={<Button variant="secondary" onClick={() => query.refetch()}>Try again</Button>}>
            {errorMessage(query.error, 'Something went wrong on the way to the server.')}
          </EmptyState>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<CalendarBlank size={22} weight="duotone" />}
            title={search ? 'Nothing matches that search' : 'No meeting links yet'}
            actions={
              search ? (
                <Button variant="secondary" onClick={() => setSearch('')}>
                  Clear search
                </Button>
              ) : canManage ? (
                <Button variant="primary" onClick={() => setCreateOpen(true)}>
                  New meeting link
                </Button>
              ) : null
            }
          >
            {search
              ? 'Try a different word, or clear the search.'
              : 'A meeting link is a page you put in an email signature or a sequence. Pick your hours once and buyers book the times you’re free.'}
          </EmptyState>
        ) : (
          <>
            {/* The ledger needs 720px; below that the same rows stack. */}
            <Ledger className="hidden sm:block" rows={rows} columns={columns} getId={p => p.id} onRowClick={page => navigate(`/outreach/meetings/${page.id}`)} focusId={nav.focusId} />
            <ul className="flex flex-col sm:hidden">
              {rows.map(page => (
                <li key={page.id} className="border-b border-line">
                  <div className="flex items-start gap-3 px-5 py-3.5">
                    <button type="button" onClick={() => navigate(`/outreach/meetings/${page.id}`)} className="min-w-0 flex-1 text-left">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="truncate font-medium text-ink">{page.name}</span>
                        {!page.active && <Badge tone="neutral">Paused</Badge>}
                      </div>
                      <div className="mt-0.5 truncate text-meta text-ink-3">
                        /m/{page.slug} · {durationLabel(page.durationMinutes)} · {page.bookings === 0 ? 'no bookings yet' : `${page.bookings} booked`}
                      </div>
                    </button>
                    <Button variant="ghost" size="sm" icon aria-label={`Copy the link to ${page.name}`} onClick={() => copyLink(page)}>
                      <Copy size={16} />
                    </Button>
                    <Menu>
                      <MenuTrigger asChild>
                        <Button variant="ghost" size="sm" icon aria-label={`More actions for ${page.name}`}>
                          <DotsThree size={18} weight="bold" />
                        </Button>
                      </MenuTrigger>
                      <MenuContent align="end">
                        {canManage && <MenuItem onSelect={() => toggleActive(page, !page.active)}>{page.active ? 'Pause it' : 'Take bookings'}</MenuItem>}
                        <MenuItem onSelect={() => navigate(`/outreach/meetings/${page.id}?tab=bookings`)}>See its bookings</MenuItem>
                        {canManage && (
                          <MenuItem destructive onSelect={() => void confirmDelete(page)}>
                            Delete
                          </MenuItem>
                        )}
                      </MenuContent>
                    </Menu>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      <CreateMeetingLinkDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}
