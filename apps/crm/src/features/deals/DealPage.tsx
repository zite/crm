import { ArrowLeft, Archive, CaretRight, DotsThree, PencilSimple, Trash } from '@phosphor-icons/react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Badge } from '../../ui/Chip';
import { Button } from '../../ui/Button';
import { Card, DetailLayout, EmptyState, PageHeader, Skeleton } from '../../ui/Layout';
import { Input } from '../../ui/Form';
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '../../ui/Menu';
import { CompanyMark, Money } from '../../glyphs';
import { useAppActions } from '../../lib/app-actions';
import { useDealActions } from '../../lib/mutations';
import { useDeal } from '../../lib/queries';
import { useDocumentTitle } from '../../lib/useDocumentTitle';
import { useWorkspace } from '../../lib/workspace';
import { DealDetail } from './DealDetail';
import { DealFacts } from './DealFacts';
import { hasCents } from '../quotes/lineItems';

/** One deal, full page: header, main column, and the properties rail. */
export function DealPage() {
  const { id = '' } = useParams();
  const ws = useWorkspace();
  const navigate = useNavigate();
  const actions = useAppActions();
  const dealActions = useDealActions();
  const { data, isPending, isError } = useDeal(id);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState('');
  useDocumentTitle(data?.deal.name ?? 'Deal', ws.settings.organizationName);

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
      <EmptyState icon={<Archive size={22} weight="duotone" />} title="That deal isn’t here" actions={<Button variant="primary" onClick={() => navigate('/deals')}>Back to deals</Button>}>
        It may have been deleted, or the link is out of date.
      </EmptyState>
    );
  }

  const deal = data.deal;
  const canEdit = ws.can('records.edit');

  return (
    <div className="flex min-h-full flex-col">
      <PageHeader
        eyebrow={
          <>
            <Link to="/deals" className="inline-flex items-center gap-1 hover:text-ink">
              <ArrowLeft size={13} /> Deals
            </Link>
            {data.company && (
              <>
                <CaretRight size={11} className="text-ink-3" />
                <Link to={`/companies/${data.company.id}`} className="inline-flex items-center gap-1.5 hover:text-ink">
                  <CompanyMark name={data.company.name} id={data.company.id} size="xs" />
                  {data.company.name}
                </Link>
              </>
            )}
          </>
        }
        adornment={<CompanyMark name={data.company?.name ?? deal.name} id={deal.companyId ?? deal.id} size="lg" />}
        title={
          renaming ? (
            <Input
              autoFocus
              value={name}
              onChange={e => setName(e.target.value)}
              onBlur={() => {
                if (name.trim() && name.trim() !== deal.name) dealActions.update.mutate({ ids: [deal.id], patch: { name: name.trim() } });
                setRenaming(false);
              }}
              onKeyDown={e => {
                if (e.key === 'Enter') e.currentTarget.blur();
                if (e.key === 'Escape') {
                  setName(deal.name);
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
                setName(deal.name);
                setRenaming(true);
              }}
              className="max-w-full truncate rounded-sm text-left hover:bg-hover disabled:hover:bg-transparent"
            >
              {deal.name}
            </button>
          )
        }
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="text-title font-semibold text-ink">
              <Money value={deal.amount} cents={hasCents(deal.amount)} />
            </span>
            <span className="text-ink-3">·</span>
            <span>{ws.stageById(deal.stageId)?.name}</span>
            {deal.status !== 'Open' && <Badge tone={deal.status === 'Won' ? 'success' : 'danger'}>{deal.status}</Badge>}
            {deal.archived && <Badge tone="warning">Archived</Badge>}
          </span>
        }
        actions={
          canEdit && (
            <Menu>
              <MenuTrigger asChild>
                <Button variant="secondary" size="sm" icon aria-label="Deal actions">
                  <DotsThree size={18} weight="bold" />
                </Button>
              </MenuTrigger>
              <MenuContent align="end">
                <MenuItem
                  icon={<PencilSimple size={16} />}
                  onSelect={() => {
                    setName(deal.name);
                    setRenaming(true);
                  }}
                >
                  Rename
                </MenuItem>
                <MenuItem icon={<Archive size={16} />} onSelect={() => dealActions.archive([deal.id], !deal.archived)}>
                  {deal.archived ? 'Restore' : 'Archive'}
                </MenuItem>
                <MenuSeparator />
                <MenuItem
                  destructive
                  icon={<Trash size={16} />}
                  onSelect={async () => {
                    const ok = await actions.confirm({ title: 'Delete this deal?', description: 'Its line items, buying group and stage history go too. Activities and tasks stay on the company and contact.', confirmLabel: 'Delete', destructive: true });
                    if (!ok) return;
                    dealActions.remove.mutate([deal.id], { onSuccess: () => navigate('/deals') });
                  }}
                >
                  Delete deal
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
            <DealFacts dealId={deal.id} />
          </Card>
        }
      >
        <DealDetail dealId={deal.id} />
      </DetailLayout>
    </div>
  );
}
