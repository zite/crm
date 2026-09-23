import { Archive, ArrowLeft, CaretRight, CheckSquare, CopySimple, DotsThree, EnvelopeSimple, PencilSimple, Trash, User } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Avatar } from '../../ui/Avatar';
import { Badge } from '../../ui/Chip';
import { Button } from '../../ui/Button';
import { Card, DetailLayout, EmptyState, PageHeader, Skeleton } from '../../ui/Layout';
import { Input } from '../../ui/Form';
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '../../ui/Menu';
import { Tabs } from '../../ui/Tabs';
import { CompanyMark } from '../../glyphs';
import { FilesPanel } from '../../records/FilesPanel';
import { Composer } from '../../timeline/Composer';
import { EmailDialog, type EmailTarget } from '../../timeline/EmailDialog';
import { Timeline } from '../../timeline/Timeline';
import { useAppActions } from '../../lib/app-actions';
import { plural } from '../../lib/format';
import { useTimeline } from '../../lib/queries';
import { useDocumentTitle } from '../../lib/useDocumentTitle';
import { useWorkspace } from '../../lib/workspace';
import { RelatedDealsPanel } from '../companies/CompanyRelated';
import { DuplicateBanner, DuplicatesDialog } from '../companies/Duplicates';
import { useContactActions } from '../companies/mutations';
import { useContact } from '../companies/queries';
import { EnrollButton } from '../outreach/EnrollDialog';
import { ContactFacts } from './ContactFacts';
import { ContactOverview } from './ContactOverview';
import { reachability } from './contactHelpers';

const TABS = ['overview', 'activity', 'deals', 'files'] as const;

/** One contact, full page: header, tabs, and the properties rail. */
export function ContactPage() {
  const { id = '', tab } = useParams();
  const ws = useWorkspace();
  const navigate = useNavigate();
  const appActions = useAppActions();
  const actions = useContactActions();
  const { data, isPending, isError } = useContact(id);
  const timeline = useTimeline('contact', id);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState('');
  const [emailTarget, setEmailTarget] = useState<EmailTarget | null>(null);
  const [dupesOpen, setDupesOpen] = useState(false);
  useDocumentTitle(data?.contact.name ?? 'Contact', ws.settings.organizationName);

  const active = (TABS as readonly string[]).includes(tab ?? '') ? (tab as (typeof TABS)[number]) : 'overview';

  useEffect(() => {
    setRenaming(false);
  }, [id]);

  // Shaped like the page it becomes — avatar, name, tabs, three figures and the
  // 320px rail — so nothing jumps sideways when the contact arrives.
  if (isPending) {
    return (
      <div className="flex min-h-full flex-col">
        <header className="bg-paper px-5 pt-6 sm:px-8">
          <Skeleton className="mb-1.5 h-5 w-40" />
          <div className="flex items-center gap-3">
            <Skeleton className="h-14 w-14 rounded-full" />
            <Skeleton className="h-9 w-[280px]" />
          </div>
          <Skeleton className="mt-1.5 h-5 w-72" />
          <div className="mt-5 flex gap-6 border-b border-line pb-3">
            {[64, 66, 60, 46].map(w => (
              <Skeleton key={w} className="h-4" style={{ width: w }} />
            ))}
          </div>
        </header>
        <div className="flex flex-col gap-6 px-5 py-6 sm:px-8 lg:flex-row lg:items-start">
          <div className="flex min-w-0 flex-1 flex-col gap-6">
            <div className="grid gap-3 sm:grid-cols-3">
              <Skeleton className="h-[86px] rounded-lg" />
              <Skeleton className="h-[86px] rounded-lg" />
              <Skeleton className="h-[86px] rounded-lg" />
            </div>
            <Skeleton className="h-6 w-28" />
            <Skeleton className="h-16 rounded-lg" />
            <Skeleton className="h-6 w-28" />
            <Skeleton className="h-24 rounded-lg" />
          </div>
          <Skeleton className="h-[420px] w-full shrink-0 rounded-lg lg:w-[320px]" />
        </div>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <EmptyState icon={<User size={22} weight="duotone" />} title="That contact isn’t here" actions={<Button variant="primary" onClick={() => navigate('/contacts')}>Back to contacts</Button>}>
        They may have been deleted or merged into another record, or the link is out of date.
      </EmptyState>
    );
  }

  const contact = data.contact;
  const canEdit = ws.can('records.edit');
  const reach = reachability(contact);

  const deleteContact = async () => {
    const ok = await appActions.confirm({
      title: `Delete ${contact.name}?`,
      description: (
        <>
          Their deals stay — {data.counts.deals ? `they leave the buying group on ${plural(data.counts.deals, 'deal')}. ` : 'they are not on any. '}
          Calls, emails, meetings, notes, tasks and files that also belong to a company or deal keep those links; anything that only pointed at them is deleted too. This can’t be undone.
        </>
      ),
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    actions.remove.mutate([contact.id], { onSuccess: () => navigate('/contacts') });
  };

  return (
    <div className="flex min-h-full flex-col">
      <PageHeader
        eyebrow={
          <>
            <Link to="/contacts" className="inline-flex items-center gap-1 hover:text-ink">
              <ArrowLeft size={13} /> Contacts
            </Link>
            {contact.companyId && (
              <>
                <CaretRight size={11} className="text-ink-3" />
                <Link to={`/companies/${contact.companyId}`} className="inline-flex items-center gap-1.5 hover:text-ink">
                  <CompanyMark name={contact.companyName ?? ''} id={contact.companyId} size="xs" />
                  {contact.companyName}
                </Link>
              </>
            )}
          </>
        }
        adornment={<Avatar person={{ id: contact.id, name: contact.name, avatarUrl: contact.avatarUrl }} size="xl" />}
        title={
          renaming ? (
            <Input
              autoFocus
              value={name}
              onChange={e => setName(e.target.value)}
              onBlur={() => {
                if (name.trim() && name.trim() !== contact.name) actions.update.mutate({ ids: [contact.id], patch: { name: name.trim() } });
                setRenaming(false);
              }}
              onKeyDown={e => {
                if (e.key === 'Enter') e.currentTarget.blur();
                if (e.key === 'Escape') {
                  setName(contact.name);
                  setRenaming(false);
                }
              }}
              className="h-11 max-w-[560px] font-display text-display"
            />
          ) : (
            <button
              type="button"
              disabled={!canEdit}
              onClick={() => {
                setName(contact.name);
                setRenaming(true);
              }}
              className="max-w-full truncate rounded-sm text-left hover:bg-hover disabled:hover:bg-transparent"
            >
              {contact.name}
            </button>
          )
        }
        description={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>{contact.title ?? 'No title'}</span>
            {/* "at" and the company are one item, so a narrow screen never strands
                the preposition on a line of its own. */}
            {contact.companyId && (
              <span className="min-w-0">
                <span className="text-ink-3">at </span>
                <Link to={`/companies/${contact.companyId}`} className="text-accent hover:underline">
                  {contact.companyName}
                </Link>
              </span>
            )}
            {contact.unsubscribedAt ? <Badge tone="danger">Unsubscribed</Badge> : contact.doNotContact ? <Badge tone="danger">Do not contact</Badge> : null}
            {contact.archived && <Badge tone="warning">Archived</Badge>}
          </span>
        }
        actions={
          canEdit && (
            <>
              {ws.can('outreach.send') && (
                <Button
                  variant="secondary"
                  size="sm"
                  leading={<EnvelopeSimple size={15} />}
                  disabled={!reach.canEmail}
                  title={reach.canEmail ? undefined : reach.reason}
                  onClick={() => setEmailTarget({ contactId: contact.id, companyId: contact.companyId, to: contact.email as string, name: contact.name })}
                >
                  Email
                </Button>
              )}
              {ws.can('outreach.send') && <EnrollButton contact={{ id: contact.id, name: contact.name }} />}
              <Button
                variant="primary"
                size="sm"
                leading={<CheckSquare size={15} />}
                onClick={() => appActions.openCreate('task', { contactId: contact.id, contactName: contact.name, companyId: contact.companyId })}
              >
                Add task
              </Button>
              <Menu>
                <MenuTrigger asChild>
                  <Button variant="secondary" size="sm" icon aria-label="Contact actions">
                    <DotsThree size={18} weight="bold" />
                  </Button>
                </MenuTrigger>
                <MenuContent align="end">
                  <MenuItem
                    icon={<PencilSimple size={16} />}
                    onSelect={() => {
                      setName(contact.name);
                      setRenaming(true);
                    }}
                  >
                    Rename
                  </MenuItem>
                  <MenuItem icon={<CopySimple size={16} />} onSelect={() => setDupesOpen(true)}>
                    Find duplicates
                  </MenuItem>
                  <MenuItem icon={<Archive size={16} />} onSelect={() => actions.archive([contact.id], !contact.archived)}>
                    {contact.archived ? 'Restore' : 'Archive'}
                  </MenuItem>
                  <MenuSeparator />
                  <MenuItem destructive icon={<Trash size={16} />} onSelect={deleteContact}>
                    Delete contact
                  </MenuItem>
                </MenuContent>
              </Menu>
            </>
          )
        }
        tabs={
          <Tabs
            items={[
              { value: 'overview', label: 'Overview', to: `/contacts/${contact.id}`, end: true },
              { value: 'activity', label: 'Activity', count: data.counts.activities, to: `/contacts/${contact.id}/activity` },
              { value: 'deals', label: 'Deals', count: data.counts.deals, to: `/contacts/${contact.id}/deals` },
              { value: 'files', label: 'Files', count: data.counts.documents, to: `/contacts/${contact.id}/files` },
            ]}
          />
        }
      />

      <DetailLayout
        rail={
          <Card className="p-4">
            <h2 className="mb-2 text-micro font-semibold uppercase text-ink-3">Details</h2>
            <ContactFacts contact={contact} />
          </Card>
        }
      >
        <div className="flex flex-col gap-6">
          <DuplicateBanner type="contact" id={contact.id} onMerged={survivorId => navigate(`/contacts/${survivorId}`, { replace: true })} />

          {active === 'overview' && <ContactOverview data={data} />}
          {active === 'activity' && (
            <div className="flex flex-col gap-4">
              {canEdit && (
                <Composer
                  links={{ contactId: contact.id, companyId: contact.companyId }}
                  onEmail={reach.canEmail && ws.can('outreach.send') ? () => setEmailTarget({ contactId: contact.id, companyId: contact.companyId, to: contact.email as string, name: contact.name }) : undefined}
                />
              )}
              <Timeline data={timeline.data} isLoading={timeline.isPending} emptyHint="Log the first call or note — this is the record everyone else will read." />
            </div>
          )}
          {active === 'deals' && (
            <RelatedDealsPanel
              filters={{ contactId: contact.id }}
              title="Deals they are on"
              emptyHint={`${contact.firstName ?? contact.name} isn’t in a buying group yet. Add them to a deal from the deal’s page.`}
              onNew={() => appActions.openCreate('deal', { contactId: contact.id, contactName: contact.name, companyId: contact.companyId, companyName: contact.companyName })}
            />
          )}
          {active === 'files' && <FilesPanel type="contact" id={contact.id} />}
        </div>
      </DetailLayout>

      <EmailDialog open={Boolean(emailTarget)} onOpenChange={open => !open && setEmailTarget(null)} target={emailTarget} />
      <DuplicatesDialog open={dupesOpen} onOpenChange={setDupesOpen} type="contact" />
    </div>
  );
}
