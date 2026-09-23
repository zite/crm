import { Archive, ArrowUUpLeft, Copy, DotsThree, Envelope, PencilSimple, Plus, Trash } from '@phosphor-icons/react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Avatar } from '../../ui/Avatar';
import { Badge } from '../../ui/Chip';
import { Button } from '../../ui/Button';
import { EmptyState, ListSkeleton, PageHeader } from '../../ui/Layout';
import { Menu, MenuContent, MenuItem, MenuLabel, MenuRadioGroup, MenuRadioItem, MenuSeparator, MenuTrigger } from '../../ui/Menu';
import { Ledger, type Column } from '../../records/Ledger';
import { FilterChips, ListToolbar } from '../../records/Toolbar';
import { useListNav } from '../../records/useListNav';
import { useListState } from '../../records/useListState';
import { useAppActions } from '../../lib/app-actions';
import { timeAgo } from '../../lib/format';
import { useDocumentTitle } from '../../lib/useDocumentTitle';
import { useWorkspace } from '../../lib/workspace';
import { OutreachTabs } from './OutreachTabs';
import { TemplateDialog } from './TemplateDialog';
import { preview, sampleContext, TEMPLATE_CATEGORIES, type Template } from './model';
import { useTemplateActions, useTemplates } from './queries';

type Filters = { category?: string; scope?: 'all' | 'mine' | 'shared'; archived?: boolean };

/** The team's reusable emails: what they are for, who keeps them, and how hard each one works. */
export function TemplatesPage() {
  const ws = useWorkspace();
  const actions = useAppActions();
  const { remove, save } = useTemplateActions();
  const [editing, setEditing] = useState<{ template: Template | null } | null>(null);
  useDocumentTitle('Templates', ws.settings.organizationName);

  const list = useListState<Filters>('outreach.templates', {
    layout: 'list',
    sort: { key: 'name', dir: 'asc' },
    groupBy: null,
    columns: null,
    filters: { scope: 'all' },
    search: '',
  });

  const query = useTemplates(Boolean(list.state.filters.archived));
  const canWrite = ws.can('outreach.send');
  // Subjects read as sentences in the list — the editor is where you see the raw fields.
  const ctx = useMemo(() => sampleContext(ws.me, ws.settings.organizationName), [ws.me, ws.settings.organizationName]);

  const templates = useMemo(() => {
    const term = list.state.search.trim().toLowerCase();
    const rows = (query.data?.templates ?? []).filter(t => {
      if (list.state.filters.category && t.category !== list.state.filters.category) return false;
      if (list.state.filters.scope === 'mine' && t.ownerId !== ws.me.id) return false;
      if (list.state.filters.scope === 'shared' && !t.shared) return false;
      if (!list.state.filters.archived && t.archived) return false;
      if (term && !`${t.name} ${t.subject} ${t.category} ${t.body}`.toLowerCase().includes(term)) return false;
      return true;
    });
    const dir = list.state.sort.dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      if (list.state.sort.key === 'uses') return (a.useCount - b.useCount) * dir;
      if (list.state.sort.key === 'lastUsed') return ((a.lastUsedAt ? Date.parse(a.lastUsedAt) : 0) - (b.lastUsedAt ? Date.parse(b.lastUsedAt) : 0)) * dir;
      if (list.state.sort.key === 'category') return a.category.localeCompare(b.category) * dir;
      return a.name.localeCompare(b.name) * dir;
    });
  }, [query.data, list.state, ws.me.id]);

  const nav = useListNav({ items: templates, getId: t => t.id, onOpen: t => setEditing({ template: t }), enabled: !actions.paletteOpen && !editing });

  const duplicate = async (template: Template) => {
    await save.mutateAsync({ name: `${template.name} (copy)`.slice(0, 120), subject: template.subject, body: template.body, category: template.category, shared: false });
    toast.success('Template duplicated');
  };

  const setArchived = async (template: Template, archived: boolean) => {
    await save.mutateAsync({ id: template.id, name: template.name, subject: template.subject, body: template.body, category: template.category, shared: template.shared, archived });
    toast.success(archived ? 'Template archived' : 'Template restored');
  };

  const confirmDelete = async (template: Template) => {
    const ok = await actions.confirm({
      title: `Delete “${template.name}”?`,
      description: 'The emails already sent with it stay on their timelines. Archiving keeps it out of the way without losing it.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (ok) remove.mutate([template.id]);
  };

  const columns: Array<Column<Template>> = [
    {
      key: 'name',
      header: 'Template',
      sort: 'name',
      width: '36%',
      cell: t => (
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium text-ink">{t.name}</span>
            {t.archived && <Badge tone="warning">Archived</Badge>}
          </div>
          <div className="truncate text-meta text-ink-3">{preview(t.subject, ctx) || 'No subject'}</div>
        </div>
      ),
    },
    { key: 'category', header: 'Category', sort: 'category', width: '14%', cell: t => (t.category ? <Badge>{t.category}</Badge> : <span className="text-ink-3">—</span>) },
    {
      key: 'owner',
      header: 'Owner',
      width: '16%',
      hide: 'md',
      cell: t => {
        const owner = ws.memberById(t.ownerId);
        return (
          <span className="flex items-center gap-2">
            {owner ? <Avatar person={owner} size="xs" /> : null}
            <span className="truncate">{owner?.name ?? 'Unassigned'}</span>
          </span>
        );
      },
    },
    { key: 'shared', header: 'Shared', width: '10%', hide: 'lg', cell: t => (t.shared ? <span className="text-ink-2">Team</span> : <span className="text-ink-3">Just me</span>) },
    { key: 'uses', header: 'Uses', sort: 'uses', align: 'right', width: '8%', cell: t => <span className="tabular text-ink-2">{t.useCount.toLocaleString('en-US')}</span> },
    { key: 'lastUsed', header: 'Last used', sort: 'lastUsed', width: '12%', hide: 'lg', cell: t => <span className="text-ink-3">{t.lastUsedAt ? timeAgo(t.lastUsedAt) : 'Never'}</span> },
  ];

  const chips = [
    ...(list.state.filters.category ? [{ key: 'category', label: <>Category: {list.state.filters.category}</>, onRemove: () => list.setFilters({ category: undefined }) }] : []),
    ...(list.state.filters.scope && list.state.filters.scope !== 'all'
      ? [{ key: 'scope', label: list.state.filters.scope === 'mine' ? <>Mine</> : <>Shared</>, onRemove: () => list.setFilters({ scope: 'all' as const }) }]
      : []),
    ...(list.state.filters.archived ? [{ key: 'archived', label: <>Including archived</>, onRemove: () => list.setFilters({ archived: false }) }] : []),
  ];

  return (
    <div className="flex min-h-full flex-col">
      <PageHeader
        title="Templates"
        description="The emails your team sends again and again, with the details filled in for each person."
        actions={
          canWrite && (
            <Button variant="primary" size="sm" leading={<Plus size={16} weight="bold" />} onClick={() => setEditing({ template: null })}>
              New template
            </Button>
          )
        }
        tabs={<OutreachTabs />}
      />

      <ListToolbar
        start={
          <Menu>
            <MenuTrigger asChild>
              <Button variant="ghost" size="sm">
                Filter
              </Button>
            </MenuTrigger>
            <MenuContent>
              <MenuLabel>Category</MenuLabel>
              <MenuRadioGroup value={list.state.filters.category ?? ''} onValueChange={v => list.setFilters({ category: v || undefined })}>
                <MenuRadioItem value="">Any category</MenuRadioItem>
                {[...new Set([...TEMPLATE_CATEGORIES, ...(query.data?.categories ?? [])])].map(c => (
                  <MenuRadioItem key={c} value={c}>
                    {c}
                  </MenuRadioItem>
                ))}
              </MenuRadioGroup>
              <MenuSeparator />
              <MenuLabel>Show</MenuLabel>
              <MenuRadioGroup value={list.state.filters.scope ?? 'all'} onValueChange={v => list.setFilters({ scope: v as Filters['scope'] })}>
                <MenuRadioItem value="all">Everything I can use</MenuRadioItem>
                <MenuRadioItem value="mine">Only mine</MenuRadioItem>
                <MenuRadioItem value="shared">Only shared</MenuRadioItem>
              </MenuRadioGroup>
              <MenuSeparator />
              <MenuItem onSelect={() => list.setFilters({ archived: !list.state.filters.archived })}>{list.state.filters.archived ? 'Hide archived' : 'Include archived'}</MenuItem>
            </MenuContent>
          </Menu>
        }
        count={templates.length}
        countLabel="template"
        search={list.state.search}
        onSearch={list.setSearch}
        more={<MenuItem onSelect={() => query.refetch()}>Refresh</MenuItem>}
      />
      <FilterChips chips={chips} onClear={chips.length ? () => list.reset() : undefined} />

      <div ref={nav.scrollRef} className="min-h-0 flex-1">
        {query.isPending ? (
          <ListSkeleton rows={8} />
        ) : templates.length === 0 ? (
          <EmptyState
            icon={<Envelope size={22} weight="duotone" />}
            title={list.isFiltered ? 'Nothing matches those filters' : 'No templates yet'}
            actions={
              list.isFiltered ? (
                <Button variant="secondary" onClick={() => list.reset()}>
                  Clear filters
                </Button>
              ) : canWrite ? (
                <Button variant="primary" onClick={() => setEditing({ template: null })}>
                  New template
                </Button>
              ) : undefined
            }
          >
            {list.isFiltered
              ? 'Try removing a filter, or clear them all.'
              : 'A template is an email you write once and send to many people — names, companies and amounts fill themselves in.'}
          </EmptyState>
        ) : (
          <Ledger
            rows={templates}
            columns={columns}
            getId={t => t.id}
            sort={list.state.sort}
            onSort={key => list.toggleSort(key)}
            onRowClick={t => setEditing({ template: t })}
            focusId={nav.focusId}
            rowMenu={t => (
              <Menu>
                <MenuTrigger asChild>
                  <Button variant="ghost" size="xs" icon aria-label={`Actions for ${t.name}`}>
                    <DotsThree size={16} weight="bold" />
                  </Button>
                </MenuTrigger>
                <MenuContent align="end">
                  <MenuItem icon={<PencilSimple size={16} />} onSelect={() => setEditing({ template: t })}>
                    {t.canManage ? 'Edit' : 'View'}
                  </MenuItem>
                  {canWrite && (
                    <MenuItem icon={<Copy size={16} />} onSelect={() => void duplicate(t)}>
                      Duplicate
                    </MenuItem>
                  )}
                  {t.canManage && (
                    <>
                      <MenuSeparator />
                      <MenuItem icon={t.archived ? <ArrowUUpLeft size={16} /> : <Archive size={16} />} onSelect={() => void setArchived(t, !t.archived)}>
                        {t.archived ? 'Restore' : 'Archive'}
                      </MenuItem>
                      <MenuItem destructive icon={<Trash size={16} />} onSelect={() => void confirmDelete(t)}>
                        Delete
                      </MenuItem>
                    </>
                  )}
                </MenuContent>
              </Menu>
            )}
          />
        )}
      </div>

      {editing && <TemplateDialog open onOpenChange={o => !o && setEditing(null)} template={editing.template} />}
    </div>
  );
}
