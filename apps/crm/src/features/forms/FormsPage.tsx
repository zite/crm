import { ArrowSquareOut, Copy, DotsThree, Note, Pause, Play, Plus, Trash, WarningCircle } from '@phosphor-icons/react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge } from '../../ui/Chip';
import { Button } from '../../ui/Button';
import { EmptyState, ListSkeleton, PageHeader } from '../../ui/Layout';
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '../../ui/Menu';
import { Ledger, type Column } from '../../records/Ledger';
import { ListToolbar } from '../../records/Toolbar';
import { OutreachTabs } from '../outreach/OutreachTabs';
import { useAppActions } from '../../lib/app-actions';
import { copyText } from '../../lib/clipboard';
import { errorMessage } from '../../lib/errors';
import { percent, timeAgo } from '../../lib/format';
import { useDocumentTitle } from '../../lib/useDocumentTitle';
import { useWorkspace } from '../../lib/workspace';
import { CreateFormDialog } from './CreateFormDialog';
import { embedSnippet, publicUrl, useFormActions, useForms, type FormRow } from './formData';

/** Every web form the organization runs, with what each one is actually producing. */
export function FormsPage() {
  const ws = useWorkspace();
  const navigate = useNavigate();
  const actions = useAppActions();
  const formActions = useFormActions();
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  useDocumentTitle('Forms', ws.settings.organizationName);

  const query = useForms();
  const pagesUrl = query.data?.pagesUrl ?? null;
  const forms = useMemo(() => {
    const q = search.trim().toLowerCase();
    const all = query.data?.forms ?? [];
    return q ? all.filter(f => `${f.name} ${f.slug}`.toLowerCase().includes(q)) : all;
  }, [query.data, search]);

  const canManage = ws.can('outreach.send');

  const togglePaused = (form: FormRow) =>
    formActions.save.mutate({
      id: form.id,
      name: form.name,
      slug: form.slug,
      status: form.status === 'Live' ? 'Paused' : 'Live',
      intro: form.intro,
      fields: form.fields,
      submitLabel: form.submitLabel,
      successMessage: form.successMessage,
      redirectUrl: form.redirectUrl,
      assignment: form.assignment,
      assigneeId: form.assigneeId,
      source: form.source,
      notifyIds: form.notifyIds,
      sequenceId: form.sequenceId,
      tagIds: form.tagIds,
    });

  const columns: Array<Column<FormRow>> = [
    {
      key: 'name',
      header: 'Form',
      width: '34%',
      cell: form => (
        <div className="min-w-0">
          <div className="truncate font-medium text-ink">{form.name}</div>
          <div className="truncate text-meta text-ink-3">/f/{form.slug}</div>
        </div>
      ),
    },
    { key: 'status', header: 'Status', width: '11%', cell: form => <Badge tone={form.status === 'Live' ? 'success' : 'neutral'} dot>{form.status}</Badge> },
    { key: 'fields', header: 'Fields', align: 'right', width: '8%', hide: 'lg', cell: form => <span className="tabular text-ink-2">{form.fields.length}</span> },
    { key: 'submissions', header: 'Submissions', align: 'right', width: '12%', cell: form => <span className="tabular text-ink">{form.submissions.toLocaleString('en-US')}</span> },
    // A count and a percentage are two different facts: two columns, not one cell
    // where "9 82%" reads like one number.
    { key: 'leads', header: 'New leads', align: 'right', width: '11%', hide: 'md', cell: form => <span className="tabular text-ink-2">{form.newLeads.toLocaleString('en-US')}</span> },
    {
      key: 'conversion',
      header: 'Became leads',
      align: 'right',
      width: '12%',
      hide: 'lg',
      cell: form => <span className="tabular text-ink-3">{form.submissions > 0 ? percent(form.conversion) : '—'}</span>,
    },
    { key: 'last', header: 'Last submission', width: '14%', hide: 'lg', cell: form => <span className="text-ink-3">{form.lastSubmissionAt ? timeAgo(form.lastSubmissionAt) : 'Never'}</span> },
  ];

  return (
    <div className="flex min-h-full flex-col">
      <PageHeader
        title="Forms"
        description="The forms on your website. Every submission is recognised, routed and answered for."
        tabs={<OutreachTabs />}
        actions={
          canManage && (
            <Button variant="primary" size="sm" leading={<Plus size={16} weight="bold" />} onClick={() => setCreating(true)}>
              New form
            </Button>
          )
        }
      />

      <ListToolbar className="mt-5" count={forms.length} countLabel="form" search={search} onSearch={setSearch} />

      <div className="min-h-0 flex-1">
        {query.isPending ? (
          <ListSkeleton rows={4} />
        ) : query.isError ? (
          <EmptyState
            icon={<WarningCircle size={22} weight="duotone" />}
            title="The forms didn’t load"
            actions={
              <Button variant="primary" onClick={() => void query.refetch()}>
                Try again
              </Button>
            }
          >
            {errorMessage(query.error, 'Something went wrong fetching your forms.')}
          </EmptyState>
        ) : forms.length === 0 ? (
          <EmptyState
            icon={<Note size={22} weight="duotone" />}
            title={search ? 'Nothing matches that' : 'No forms yet'}
            actions={
              search ? (
                // The only control here is the search box, so say so.
                <Button variant="secondary" onClick={() => setSearch('')}>
                  Clear search
                </Button>
              ) : canManage ? (
                <Button variant="primary" onClick={() => setCreating(true)}>
                  New form
                </Button>
              ) : undefined
            }
          >
            {search ? 'Try a different name, or clear the search and start again.' : 'A form turns a page on your website into leads — it recognises people you already know and routes everyone else to a rep.'}
          </EmptyState>
        ) : (
          <Ledger
            rows={forms}
            columns={columns}
            getId={f => f.id}
            onRowClick={form => navigate(`/outreach/forms/${form.id}`)}
            rowMenu={form => (
              <Menu>
                <MenuTrigger asChild>
                  <Button variant="ghost" size="xs" icon aria-label={`Actions for ${form.name}`}>
                    <DotsThree size={16} weight="bold" />
                  </Button>
                </MenuTrigger>
                <MenuContent align="end">
                  <MenuItem onSelect={() => navigate(`/outreach/forms/${form.id}`)}>Open editor</MenuItem>
                  {publicUrl(pagesUrl, form.slug) && (
                    <MenuItem icon={<ArrowSquareOut size={16} />} onSelect={() => window.open(publicUrl(pagesUrl, form.slug), '_blank', 'noopener')}>
                      View the live form
                    </MenuItem>
                  )}
                  <MenuItem icon={<Copy size={16} />} onSelect={() => copyText(embedSnippet(pagesUrl, form.slug), 'Embed code copied')}>
                    Copy embed code
                  </MenuItem>
                  {canManage && (
                    <>
                      <MenuSeparator />
                      <MenuItem icon={form.status === 'Live' ? <Pause size={16} /> : <Play size={16} />} onSelect={() => togglePaused(form)}>
                        {form.status === 'Live' ? 'Pause' : 'Make live'}
                      </MenuItem>
                      <MenuItem
                        destructive
                        icon={<Trash size={16} />}
                        onSelect={async () => {
                          const ok = await actions.confirm({
                            title: `Delete “${form.name}”?`,
                            description: `Its ${form.submissions} ${form.submissions === 1 ? 'submission record goes' : 'submission records go'} too. The leads and contacts it made stay exactly where they are.`,
                            confirmLabel: 'Delete',
                            destructive: true,
                          });
                          if (!ok) return;
                          formActions.remove.mutate(form.id);
                        }}
                      >
                        Delete form
                      </MenuItem>
                    </>
                  )}
                </MenuContent>
              </Menu>
            )}
          />
        )}
      </div>

      <CreateFormDialog open={creating} onOpenChange={setCreating} defaults={{}} />
    </div>
  );
}
