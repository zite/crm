import { Archive, ArrowLeft, ArrowSquareOut, Buildings, CaretRight, CopySimple, DotsThree, PencilSimple, Plus, Trash } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Badge } from '../../ui/Chip';
import { Button } from '../../ui/Button';
import { Card, DetailLayout, EmptyState, PageHeader, Skeleton } from '../../ui/Layout';
import { Input } from '../../ui/Form';
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '../../ui/Menu';
import { Tabs } from '../../ui/Tabs';
import { CompanyMark } from '../../glyphs';
import { FilesPanel } from '../../records/FilesPanel';
import { Composer } from '../../timeline/Composer';
import { Timeline } from '../../timeline/Timeline';
import { useAppActions } from '../../lib/app-actions';
import { useTimeline } from '../../lib/queries';
import { useDocumentTitle } from '../../lib/useDocumentTitle';
import { useWorkspace } from '../../lib/workspace';
import { CompanyContactsPanel, RelatedDealsPanel } from './CompanyRelated';
import { CompanyFacts } from './CompanyFacts';
import { CompanyOverview } from './CompanyOverview';
import DeleteCompanyDialog from './DeleteCompanyDialog';
import { DuplicateBanner, DuplicatesDialog } from './Duplicates';
import { COMPANY_TYPE_TONE, externalUrl, hostLabel } from './companyHelpers';
import { useCompanyActions } from './mutations';
import { useCompany } from './queries';

const TABS = ['overview', 'contacts', 'deals', 'activity', 'files'] as const;

/** One company, full page: header, tabs, and the properties rail. */
export function CompanyPage() {
  const { id = '', tab } = useParams();
  const ws = useWorkspace();
  const navigate = useNavigate();
  const appActions = useAppActions();
  const actions = useCompanyActions();
  const { data, isPending, isError } = useCompany(id);
  const timeline = useTimeline('company', id);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [dupesOpen, setDupesOpen] = useState(false);
  useDocumentTitle(data?.company.name ?? 'Company', ws.settings.organizationName);

  const active = (TABS as readonly string[]).includes(tab ?? '') ? (tab as (typeof TABS)[number]) : 'overview';

  useEffect(() => {
    setRenaming(false);
  }, [id]);

  // Shaped like the page it becomes — mark, name, tabs, three figures and the
  // 320px rail — so nothing jumps sideways when the company arrives.
  if (isPending) {
    return (
      <div className="flex min-h-full flex-col">
        <header className="bg-paper px-5 pt-6 sm:px-8">
          <Skeleton className="mb-1.5 h-5 w-32" />
          <div className="flex items-center gap-3">
            <Skeleton className="h-14 w-14 rounded-lg" />
            <Skeleton className="h-9 w-[320px]" />
          </div>
          <Skeleton className="mt-1.5 h-5 w-64" />
          <div className="mt-5 flex gap-6 border-b border-line pb-3">
            {[64, 78, 60, 66, 46].map(w => (
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
            <Skeleton className="h-6 w-20" />
            <Skeleton className="h-24 rounded-lg" />
          </div>
          <Skeleton className="h-[420px] w-full shrink-0 rounded-lg lg:w-[320px]" />
        </div>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <EmptyState icon={<Buildings size={22} weight="duotone" />} title="That company isn’t here" actions={<Button variant="primary" onClick={() => navigate('/companies')}>Back to companies</Button>}>
        It may have been deleted or merged into another record, or the link is out of date.
      </EmptyState>
    );
  }

  const company = data.company;
  const canEdit = ws.can('records.edit');

  return (
    <div className="flex min-h-full flex-col">
      <PageHeader
        eyebrow={
          <>
            <Link to="/companies" className="inline-flex items-center gap-1 hover:text-ink">
              <ArrowLeft size={13} /> Companies
            </Link>
            {data.parent && (
              <>
                <CaretRight size={11} className="text-ink-3" />
                <Link to={`/companies/${data.parent.id}`} className="inline-flex items-center gap-1.5 hover:text-ink">
                  <CompanyMark name={data.parent.name} id={data.parent.id} logoUrl={data.parent.logoUrl} size="xs" />
                  {data.parent.name}
                </Link>
              </>
            )}
          </>
        }
        adornment={<CompanyMark name={company.name} id={company.id} logoUrl={company.logoUrl} size="xl" />}
        title={
          renaming ? (
            <Input
              autoFocus
              value={name}
              onChange={e => setName(e.target.value)}
              onBlur={() => {
                if (name.trim() && name.trim() !== company.name) actions.update.mutate({ ids: [company.id], patch: { name: name.trim() } });
                setRenaming(false);
              }}
              onKeyDown={e => {
                if (e.key === 'Enter') e.currentTarget.blur();
                if (e.key === 'Escape') {
                  setName(company.name);
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
                setName(company.name);
                setRenaming(true);
              }}
              className="max-w-full truncate rounded-sm text-left hover:bg-hover disabled:hover:bg-transparent"
            >
              {company.name}
            </button>
          )
        }
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {company.domain || company.website ? (
              <a
                href={externalUrl(company.website ?? company.domain) ?? '#'}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-1 text-accent hover:underline"
              >
                {hostLabel(company.website ?? company.domain)}
                <ArrowSquareOut size={12} />
              </a>
            ) : (
              <span className="text-ink-3">No website</span>
            )}
            {company.type && <Badge tone={COMPANY_TYPE_TONE[company.type] ?? 'neutral'}>{company.type}</Badge>}
            {company.industry && <span>{company.industry}</span>}
            {company.city && <span className="text-ink-3">{[company.city, company.region].filter(Boolean).join(', ')}</span>}
            {company.archived && <Badge tone="warning">Archived</Badge>}
          </span>
        }
        actions={
          canEdit && (
            <>
              <Button variant="secondary" size="sm" leading={<Plus size={15} />} onClick={() => appActions.openCreate('contact', { companyId: company.id, companyName: company.name })}>
                New contact
              </Button>
              <Button variant="primary" size="sm" leading={<Plus size={16} weight="bold" />} onClick={() => appActions.openCreate('deal', { companyId: company.id, companyName: company.name })}>
                New deal
              </Button>
              <Menu>
                <MenuTrigger asChild>
                  <Button variant="secondary" size="sm" icon aria-label="Company actions">
                    <DotsThree size={18} weight="bold" />
                  </Button>
                </MenuTrigger>
                <MenuContent align="end">
                  <MenuItem
                    icon={<PencilSimple size={16} />}
                    onSelect={() => {
                      setName(company.name);
                      setRenaming(true);
                    }}
                  >
                    Rename
                  </MenuItem>
                  <MenuItem icon={<CopySimple size={16} />} onSelect={() => setDupesOpen(true)}>
                    Find duplicates
                  </MenuItem>
                  <MenuItem icon={<Archive size={16} />} onSelect={() => actions.archive([company.id], !company.archived)}>
                    {company.archived ? 'Restore' : 'Archive'}
                  </MenuItem>
                  <MenuSeparator />
                  <MenuItem destructive icon={<Trash size={16} />} onSelect={() => setDeleting(true)}>
                    Delete company
                  </MenuItem>
                </MenuContent>
              </Menu>
            </>
          )
        }
        tabs={
          <Tabs
            items={[
              { value: 'overview', label: 'Overview', to: `/companies/${company.id}`, end: true },
              { value: 'contacts', label: 'Contacts', count: data.counts.contacts, to: `/companies/${company.id}/contacts` },
              { value: 'deals', label: 'Deals', count: data.counts.deals, to: `/companies/${company.id}/deals` },
              { value: 'activity', label: 'Activity', count: data.counts.activities, to: `/companies/${company.id}/activity` },
              { value: 'files', label: 'Files', count: data.counts.documents, to: `/companies/${company.id}/files` },
            ]}
          />
        }
      />

      <DetailLayout
        rail={
          <Card className="p-4">
            <h2 className="mb-2 text-micro font-semibold uppercase text-ink-3">Details</h2>
            <CompanyFacts company={company} parentName={data.parent?.name} />
          </Card>
        }
      >
        <div className="flex flex-col gap-6">
          <DuplicateBanner type="company" id={company.id} onMerged={survivorId => navigate(`/companies/${survivorId}`, { replace: true })} />

          {active === 'overview' && <CompanyOverview data={data} />}
          {active === 'contacts' && <CompanyContactsPanel companyId={company.id} companyName={company.name} />}
          {active === 'deals' && (
            <RelatedDealsPanel
              filters={{ companyId: company.id }}
              emptyHint={`Nothing is in flight with ${company.name}. A deal is how the work and the money get tracked.`}
              onNew={() => appActions.openCreate('deal', { companyId: company.id, companyName: company.name })}
            />
          )}
          {active === 'activity' && (
            <div className="flex flex-col gap-4">
              {canEdit && <Composer links={{ companyId: company.id }} />}
              <Timeline data={timeline.data} isLoading={timeline.isPending} emptyHint="Log the first call or note — this is the record everyone else will read." />
            </div>
          )}
          {active === 'files' && <FilesPanel type="company" id={company.id} />}
        </div>
      </DetailLayout>

      {deleting && (
        <DeleteCompanyDialog
          open
          onOpenChange={setDeleting}
          companies={[company]}
          onDone={() => navigate('/companies')}
        />
      )}
      <DuplicatesDialog open={dupesOpen} onOpenChange={setDupesOpen} type="company" />
    </div>
  );
}
