import { ArrowLeft, DotsThree, PencilSimple, Trash, UserCircle } from '@phosphor-icons/react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Badge } from '../../ui/Chip';
import { Button } from '../../ui/Button';
import { Card, DetailLayout, EmptyState, PageHeader, Skeleton } from '../../ui/Layout';
import { Input } from '../../ui/Form';
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '../../ui/Menu';
import { CompanyMark, LeadStatusBadge } from '../../glyphs';
import { useAppActions } from '../../lib/app-actions';
import { useDocumentTitle } from '../../lib/useDocumentTitle';
import { useWorkspace } from '../../lib/workspace';
import { LeadDetail } from './LeadDetail';
import { LeadFacts } from './LeadFacts';
import { useLead, useLeadActions } from './leadData';

/** One lead, full page: header with score and status, main column, properties rail. */
export function LeadPage() {
  const { id = '' } = useParams();
  const ws = useWorkspace();
  const navigate = useNavigate();
  const actions = useAppActions();
  const leadActions = useLeadActions();
  const { data, isPending, isError } = useLead(id);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState('');
  useDocumentTitle(data?.lead.name ?? 'Lead', ws.settings.organizationName);

  if (isPending) {
    return (
      <div className="flex flex-col gap-4 px-5 py-8 sm:px-8">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-9 w-2/3" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <EmptyState
        icon={<UserCircle size={22} weight="duotone" />}
        title="That lead isn’t here"
        actions={
          <Button variant="primary" onClick={() => navigate('/leads')}>
            Back to leads
          </Button>
        }
      >
        It may have been deleted, or the link is out of date.
      </EmptyState>
    );
  }

  const lead = data.lead;
  const canEdit = ws.can('records.edit') && !lead.convertedAt;

  return (
    <div className="flex min-h-full flex-col">
      <PageHeader
        eyebrow={
          <Link to="/leads" className="inline-flex items-center gap-1 hover:text-ink">
            <ArrowLeft size={13} /> Leads
          </Link>
        }
        adornment={<CompanyMark name={lead.companyName ?? lead.name} id={lead.companyName ?? lead.id} size="lg" />}
        title={
          renaming ? (
            <Input
              autoFocus
              value={name}
              onChange={e => setName(e.target.value)}
              onBlur={() => {
                if (name.trim() && name.trim() !== lead.name) leadActions.setField(lead.id, { name: name.trim() });
                setRenaming(false);
              }}
              onKeyDown={e => {
                if (e.key === 'Enter') e.currentTarget.blur();
                if (e.key === 'Escape') {
                  setName(lead.name);
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
                setName(lead.name);
                setRenaming(true);
              }}
              className="max-w-full truncate rounded-sm text-left hover:bg-hover disabled:hover:bg-transparent"
            >
              {lead.name}
            </button>
          )
        }
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <LeadStatusBadge status={lead.status} />
            {lead.title && <span>{lead.title}</span>}
            {lead.companyName && (
              <>
                <span className="text-ink-3">·</span>
                <span>{lead.companyName}</span>
              </>
            )}
            {lead.source && (
              <>
                <span className="text-ink-3">·</span>
                <span className="text-ink-3">via {lead.formName ?? lead.source}</span>
              </>
            )}
            {lead.convertedAt && <Badge tone="success">Converted</Badge>}
          </span>
        }
        actions={
          ws.can('records.edit') && (
            <Menu>
              <MenuTrigger asChild>
                <Button variant="secondary" size="sm" icon aria-label="Lead actions">
                  <DotsThree size={18} weight="bold" />
                </Button>
              </MenuTrigger>
              <MenuContent align="end">
                <MenuItem
                  icon={<PencilSimple size={16} />}
                  disabled={!canEdit}
                  onSelect={() => {
                    setName(lead.name);
                    setRenaming(true);
                  }}
                >
                  Rename
                </MenuItem>
                <MenuSeparator />
                <MenuItem
                  destructive
                  icon={<Trash size={16} />}
                  onSelect={async () => {
                    const ok = await actions.confirm({
                      title: 'Delete this lead?',
                      description: lead.convertedAt
                        ? 'The contact, company and deal it became stay exactly where they are. Only the lead and its own notes go.'
                        : 'Its notes, calls and tasks go too. This can’t be undone.',
                      confirmLabel: 'Delete',
                      destructive: true,
                    });
                    if (!ok) return;
                    leadActions.remove.mutate([lead.id], { onSuccess: () => navigate('/leads') });
                  }}
                >
                  Delete lead
                </MenuItem>
              </MenuContent>
            </Menu>
          )
        }
      />
      <DetailLayout
        rail={
          <Card className="p-4">
            <h2 className="mb-2 text-micro font-semibold uppercase text-ink-3">Details</h2>
            <LeadFacts lead={lead} />
          </Card>
        }
      >
        <LeadDetail leadId={lead.id} />
      </DetailLayout>
    </div>
  );
}
