import { Archive, ArrowsClockwise, Buildings, CopySimple, DotsThree, DownloadSimple, EnvelopeSimple, FloppyDisk, Plus, Tag as TagIcon, Trash, Users } from '@phosphor-icons/react';
import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Avatar, Unassigned } from '../../ui/Avatar';
import { Badge } from '../../ui/Chip';
import { Button } from '../../ui/Button';
import { EmptyState, ListSkeleton, PageHeader, StatStrip } from '../../ui/Layout';
import { Menu, MenuContent, MenuItem, MenuLabel, MenuRadioGroup, MenuRadioItem, MenuSeparator, MenuTrigger } from '../../ui/Menu';
import { CompanyMark, Money } from '../../glyphs';
import { MemberPicker, RecordPicker, TagPicker } from '../../pickers/pickers';
import { BulkBar, BulkButton } from '../../records/BulkBar';
import { EnrollDialog } from '../outreach/EnrollDialog';
import { Ledger, type Column } from '../../records/Ledger';
import { SaveViewDialog } from '../../records/SaveViewDialog';
import { FilterChips, ListToolbar } from '../../records/Toolbar';
import { useListNav } from '../../records/useListNav';
import { useListState } from '../../records/useListState';
import { EmailDialog, type EmailTarget } from '../../timeline/EmailDialog';
import { useAppActions } from '../../lib/app-actions';
import { downloadCsv } from '../../lib/csv';
import { plural, timeAgo } from '../../lib/format';
import { useDocumentTitle } from '../../lib/useDocumentTitle';
import { useWorkspace } from '../../lib/workspace';
import { DuplicatesDialog } from '../companies/Duplicates';
import { useContactActions } from '../companies/mutations';
import { useContacts } from '../companies/queries';
import { ContactFilterMenu, contactFilterChips } from './ContactFilters';
import { CONTACT_GROUP_OPTIONS, CONTACT_SORTS, contactTotals, groupContacts, reachability, type Contact, type ContactFilters, type ContactSort } from './contactHelpers';

/** Contacts: every person you know, and whether you can still reach them. */
export function ContactsPage() {
  const [enrolling, setEnrolling] = useState<Array<{ id: string; name: string }> | null>(null);
  const ws = useWorkspace();
  const navigate = useNavigate();
  const actions = useAppActions();
  const contactActions = useContactActions();
  const [params, setParams] = useSearchParams();
  const [saveOpen, setSaveOpen] = useState(false);
  const [dupesOpen, setDupesOpen] = useState(false);
  const [emailTarget, setEmailTarget] = useState<EmailTarget | null>(null);
  useDocumentTitle('Contacts', ws.settings.organizationName);

  const viewId = params.get('view');
  const savedView = viewId ? ws.views.find(v => v.id === viewId) ?? null : null;

  const list = useListState<ContactFilters, ContactSort['key']>('contacts', {
    layout: 'list',
    sort: { key: 'lastActivityAt', dir: 'desc' },
    groupBy: 'none',
    columns: null,
    filters: {},
    search: '',
  });

  const query = useContacts({
    filters: { ...list.state.filters, search: list.state.search || undefined },
    sort: list.state.sort,
    limit: 1000,
  });
  const contacts = query.data?.contacts ?? [];
  const quietBefore = useMemo(() => Date.now() - 60 * 86_400_000, []);
  const totals = useMemo(() => contactTotals(contacts, quietBefore), [contacts, quietBefore]);

  const nav = useListNav({
    items: contacts,
    getId: c => c.id,
    onOpen: contact => navigate(`/contacts/${contact.id}`),
    onPeek: contact => actions.openPeek({ type: 'contact', id: contact.id }),
    enabled: !actions.paletteOpen && !dupesOpen && !saveOpen && !emailTarget,
    // With a peek open, J/K walk the list behind it and bring the sheet along.
    followFocus: actions.peek?.type === 'contact',
  });

  const chips = contactFilterChips(list.state.filters, list.setFilters, ws);
  const grouped = groupContacts(contacts, list.state.groupBy, ws);
  const canEdit = ws.can('records.edit');

  const columns: Array<Column<Contact>> = [
    {
      key: 'name',
      header: 'Name',
      sort: 'name',
      width: '21%',
      cell: contact => (
        <div className="flex items-center gap-2.5">
          <Avatar person={{ id: contact.id, name: contact.name, avatarUrl: contact.avatarUrl }} size="md" />
          <div className="min-w-0 max-w-[200px]">
            <div className="truncate font-medium text-ink">{contact.name}</div>
            <div className="truncate text-meta text-ink-3">{contact.title ?? 'No title'}</div>
          </div>
          {contact.archived && <Badge tone="warning">Archived</Badge>}
        </div>
      ),
    },
    {
      key: 'company',
      header: 'Company',
      sort: 'company',
      width: '15%',
      interactive: true,
      cell: contact =>
        contact.companyId ? (
          <button className="flex min-w-0 items-center gap-2 rounded-sm px-1 py-1 text-left hover:bg-hover" onClick={() => navigate(`/companies/${contact.companyId}`)}>
            <CompanyMark name={contact.companyName ?? ''} id={contact.companyId} size="xs" />
            <span className="max-w-[150px] truncate">{contact.companyName}</span>
          </button>
        ) : (
          <span className="text-ink-3">No company</span>
        ),
    },
    {
      key: 'email',
      header: 'Email',
      sort: 'email',
      width: '17%',
      hide: 'lg',
      cell: contact =>
        contact.email ? (
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="max-w-[230px] truncate text-ink-2">{contact.email}</span>
            {contact.unsubscribedAt ? <Badge tone="danger">Unsubscribed</Badge> : contact.doNotContact ? <Badge tone="danger">Do not contact</Badge> : null}
          </span>
        ) : (
          <span className="text-ink-3">—</span>
        ),
    },
    { key: 'phone', header: 'Phone', width: '10%', hide: 'xl', cell: contact => <span className="tabular text-ink-2">{contact.phone ?? contact.mobile ?? '—'}</span> },
    {
      key: 'owner',
      header: 'Owner',
      sort: 'owner',
      width: '10%',
      interactive: true,
      cell: contact => {
        const owner = ws.memberById(contact.ownerId);
        const inner = (
          <span className="flex items-center gap-1.5 rounded-sm px-1 py-1">
            {owner ? <Avatar person={owner} size="xs" /> : <Unassigned size="xs" />}
            <span className="truncate text-ui">{owner?.name.split(' ')[0] ?? 'Unassigned'}</span>
          </span>
        );
        if (!canEdit) return inner;
        return <MemberPicker value={contact.ownerId} onChange={ownerId => contactActions.setOwner([contact.id], ownerId)} trigger={<button className="flex items-center hover:bg-hover">{inner}</button>} />;
      },
    },
    // "Pipeline", not "Open": the column holds money, and Companies names the same figure that way.
    { key: 'openValue', header: 'Pipeline', sort: 'openValue', align: 'right', width: '10%', hide: 'md', cell: contact => <Money value={contact.openDealValue} muted0 /> },
    {
      key: 'lastContactedAt',
      header: 'Last contacted',
      sort: 'lastContactedAt',
      width: '11%',
      cell: contact => <span className="text-ink-3">{contact.lastContactedAt ? timeAgo(contact.lastContactedAt) : 'Never'}</span>,
    },
  ];

  const exportCsv = () => {
    downloadCsv(
      'contacts',
      ['Name', 'Job title', 'Company', 'Email', 'Phone', 'Mobile', 'Owner', 'Source', 'City', 'Country', 'Do not contact', 'Unsubscribed', 'Open deals', 'Open pipeline', 'Last contacted', 'Last activity'],
      contacts.map(c => [
        c.name,
        c.title ?? '',
        c.companyName ?? '',
        c.email ?? '',
        c.phone ?? '',
        c.mobile ?? '',
        ws.memberName(c.ownerId),
        c.source ?? '',
        c.city ?? '',
        c.country ?? '',
        c.doNotContact ? 'Yes' : 'No',
        c.unsubscribedAt ? 'Yes' : 'No',
        c.openDealCount,
        c.openDealValue,
        c.lastContactedAt ?? '',
        c.lastActivityAt ?? '',
      ]),
    );
  };

  const deleteSelected = async () => {
    const ids = [...nav.selected];
    const chosen = contacts.filter(c => nav.selected.has(c.id));
    const onDeals = chosen.filter(c => c.dealCount > 0).length;
    const ok = await actions.confirm({
      title: ids.length === 1 ? 'Delete this contact?' : `Delete ${plural(ids.length, 'contact')}?`,
      description: (
        <>
          Their deals stay — {onDeals ? `${plural(onDeals, 'of them is', 'of them are')} on a deal and will simply leave its buying group. ` : 'nothing is closed or removed. '}
          Calls, emails, meetings, notes, tasks and files that also belong to a company or deal keep those links; anything that only pointed at {ids.length === 1 ? 'them' : 'these people'} is deleted too. This can’t be undone.
        </>
      ),
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    contactActions.remove.mutate(ids);
    nav.clearSelection();
  };

  return (
    <div className="flex min-h-full flex-col">
      <PageHeader
        eyebrow={savedView ? <button className="hover:text-ink" onClick={() => setParams({})}>Contacts</button> : undefined}
        title={savedView?.name ?? 'Contacts'}
        description={savedView ? 'A saved view of your contacts.' : 'Everyone you know at the companies you sell to.'}
        actions={
          <>
            {ws.viewsFor('Contacts').length > 0 && (
              <Menu>
                <MenuTrigger asChild>
                  <Button variant="secondary" size="sm">
                    Views
                  </Button>
                </MenuTrigger>
                <MenuContent align="end">
                  <MenuLabel>Saved views</MenuLabel>
                  {ws.viewsFor('Contacts').map(view => (
                    <MenuItem
                      key={view.id}
                      onSelect={() => {
                        list.applyConfig(view.config as never);
                        setParams({ view: view.id });
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
              <Button variant="primary" size="sm" leading={<Plus size={16} weight="bold" />} onClick={() => actions.openCreate('contact')}>
                New contact
              </Button>
            )}
          </>
        }
      />

      <div className="px-5 pb-1 pt-5 sm:px-8">
        <StatStrip
          items={[
            { label: 'Contacts', value: totals.count.toLocaleString('en-US'), hint: `${totals.withCompany.toLocaleString('en-US')} attached to a company` },
            { label: 'Open pipeline', value: <Money value={totals.openValue} compact />, hint: 'Deals they are on' },
            { label: 'Reachable', value: totals.reachable, hint: 'Has an email and has not opted out' },
            { label: 'No company', value: totals.count - totals.withCompany, hint: 'Nobody to hang them off', onClick: () => list.setFilters({ noCompany: true }) },
            { label: 'Quiet 60 days', value: totals.quiet, hint: 'Nothing logged', onClick: () => list.setFilters({ staleDays: 60 }) },
          ]}
        />
      </div>

      <ListToolbar
        className="mt-5"
        start={
          <>
            <ContactFilterMenu filters={list.state.filters} onChange={patch => list.setFilters(patch)} />
            <Menu>
              <MenuTrigger asChild>
                <Button variant="ghost" size="sm">
                  {CONTACT_SORTS.find(s => s.value === list.state.sort.key)?.label ?? 'Sort'}
                </Button>
              </MenuTrigger>
              <MenuContent>
                <MenuLabel>Sort by</MenuLabel>
                <MenuRadioGroup value={list.state.sort.key} onValueChange={key => list.setSort({ key: key as ContactSort['key'], dir: key === 'name' || key === 'company' || key === 'title' ? 'asc' : 'desc' })}>
                  {CONTACT_SORTS.map(s => (
                    <MenuRadioItem key={s.value} value={s.value}>
                      {s.label}
                    </MenuRadioItem>
                  ))}
                </MenuRadioGroup>
                <MenuSeparator />
                <MenuLabel>Group by</MenuLabel>
                <MenuRadioGroup value={list.state.groupBy ?? 'none'} onValueChange={value => list.setGroupBy(value === 'none' ? null : value)}>
                  {CONTACT_GROUP_OPTIONS.map(option => (
                    <MenuRadioItem key={option.value} value={option.value}>
                      {option.label}
                    </MenuRadioItem>
                  ))}
                </MenuRadioGroup>
              </MenuContent>
            </Menu>
          </>
        }
        count={contacts.length}
        countLabel="contact"
        search={list.state.search}
        onSearch={list.setSearch}
        more={
          <>
            <MenuItem icon={<CopySimple size={16} />} onSelect={() => setDupesOpen(true)}>
              Find duplicates
            </MenuItem>
            {ws.can('data.export') && (
              <MenuItem icon={<DownloadSimple size={16} />} onSelect={exportCsv}>
                Export CSV
              </MenuItem>
            )}
            <MenuItem icon={<FloppyDisk size={16} />} onSelect={() => setSaveOpen(true)}>
              Save as view…
            </MenuItem>
            <MenuItem icon={<ArrowsClockwise size={16} />} onSelect={() => query.refetch()}>
              Refresh
            </MenuItem>
          </>
        }
      />
      <FilterChips chips={chips} onClear={chips.length ? () => list.reset() : undefined} />

      <div ref={nav.scrollRef} className="min-h-0 flex-1">
        {query.isPending ? (
          <ListSkeleton rows={10} />
        ) : contacts.length === 0 ? (
          <EmptyState
            icon={<Users size={22} weight="duotone" />}
            title={list.isFiltered ? 'Nothing matches those filters' : 'No contacts yet'}
            actions={
              list.isFiltered ? (
                <Button variant="secondary" onClick={() => list.reset()}>
                  Clear filters
                </Button>
              ) : canEdit ? (
                <Button variant="primary" onClick={() => actions.openCreate('contact')}>
                  New contact
                </Button>
              ) : undefined
            }
          >
            {list.isFiltered ? 'Try removing a filter, or clear them all.' : 'A contact is a person at a company you sell to. Deals close because one of them wants them to.'}
          </EmptyState>
        ) : (
          <Ledger
            rows={contacts}
            columns={columns}
            getId={c => c.id}
            sort={list.state.sort}
            onSort={key => list.toggleSort(key as ContactSort['key'])}
            // Clicking a row is also where the keyboard picks up, so J/K carry on from
            // the row you peeked rather than jumping back to the top of the list.
            onRowClick={contact => {
              nav.setFocusId(contact.id);
              actions.openPeek({ type: 'contact', id: contact.id });
            }}
            onRowDoubleClick={contact => navigate(`/contacts/${contact.id}`)}
            focusId={nav.focusId}
            selected={nav.selected}
            onToggleSelect={nav.toggleSelect}
            onToggleAll={() => (nav.allSelected ? nav.clearSelection() : nav.selectAll())}
            groups={grouped?.map(group => ({ key: group.key, label: group.label, count: group.rows.length, rows: group.rows })) ?? undefined}
            rowMenu={contact => {
              const reach = reachability(contact);
              return (
                <Menu>
                  <MenuTrigger asChild>
                    <Button variant="ghost" size="xs" icon aria-label={`Actions for ${contact.name}`}>
                      <DotsThree size={16} weight="bold" />
                    </Button>
                  </MenuTrigger>
                  <MenuContent align="end">
                    <MenuItem onSelect={() => navigate(`/contacts/${contact.id}`)}>Open contact</MenuItem>
                    {ws.can('outreach.send') && (
                      <MenuItem
                        icon={<EnvelopeSimple size={16} />}
                        disabled={!reach.canEmail}
                        hint={reach.canEmail ? undefined : reach.label}
                        onSelect={() => reach.canEmail && setEmailTarget({ contactId: contact.id, companyId: contact.companyId, to: contact.email as string, name: contact.name })}
                      >
                        Send email
                      </MenuItem>
                    )}
                    {contact.email && <MenuItem onSelect={() => void navigator.clipboard?.writeText(contact.email as string)}>Copy email address</MenuItem>}
                    {contact.companyId && <MenuItem icon={<Buildings size={16} />} onSelect={() => navigate(`/companies/${contact.companyId}`)}>Open company</MenuItem>}
                  </MenuContent>
                </Menu>
              );
            }}
          />
        )}
      </div>

      <BulkBar count={nav.selected.size} noun="contact" onClear={nav.clearSelection}>
        <MemberPicker
          value={null}
          onChange={ownerId => {
            contactActions.setOwner([...nav.selected], ownerId);
            nav.clearSelection();
          }}
          trigger={<BulkButton>Assign</BulkButton>}
        />
        <RecordPicker
          kind="company"
          value={null}
          onChange={record => {
            if (!record) return;
            contactActions.setCompany([...nav.selected], record.id, record.name);
            nav.clearSelection();
          }}
          trigger={<BulkButton leading={<Buildings size={15} />}>Add to company</BulkButton>}
        />
        <TagPicker
          values={[]}
          onChange={tagIds => {
            if (!tagIds.length) return;
            contactActions.addTags([...nav.selected], tagIds);
          }}
          trigger={<BulkButton leading={<TagIcon size={15} />}>Tag</BulkButton>}
        />
        {ws.can('data.export') && (
          <BulkButton
            leading={<DownloadSimple size={15} />}
            onClick={() => {
              const chosen = contacts.filter(c => nav.selected.has(c.id));
              downloadCsv(
                'contacts-selected',
                ['Name', 'Job title', 'Company', 'Email', 'Phone', 'Owner'],
                chosen.map(c => [c.name, c.title ?? '', c.companyName ?? '', c.email ?? '', c.phone ?? '', ws.memberName(c.ownerId)]),
              );
            }}
          >
            Export
          </BulkButton>
        )}
        <BulkButton
          leading={<Archive size={15} />}
          onClick={() => {
            contactActions.archive([...nav.selected], !list.state.filters.archived);
            nav.clearSelection();
          }}
        >
          {list.state.filters.archived ? 'Restore' : 'Archive'}
        </BulkButton>
        <BulkButton leading={<Trash size={15} />} onClick={deleteSelected}>
          Delete
        </BulkButton>
        {ws.can('outreach.send') && (
          <BulkButton onClick={() => setEnrolling(nav.targets().map(c => ({ id: c.id, name: c.name })))}>Enroll in sequence</BulkButton>
        )}
      </BulkBar>
      {enrolling && <EnrollDialog open onOpenChange={open => !open && setEnrolling(null)} contacts={enrolling} />}

      <EmailDialog open={Boolean(emailTarget)} onOpenChange={open => !open && setEmailTarget(null)} target={emailTarget} />
      <DuplicatesDialog open={dupesOpen} onOpenChange={setDupesOpen} type="contact" />
      <SaveViewDialog
        open={saveOpen}
        onOpenChange={setSaveOpen}
        scope="Contacts"
        config={{ layout: list.state.layout, filters: list.state.filters, sort: list.state.sort, groupBy: list.state.groupBy }}
        existing={savedView}
      />
    </div>
  );
}
