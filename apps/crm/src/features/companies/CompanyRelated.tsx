import { EnvelopeSimple, Phone, Plus, Trophy, UserPlus, Users } from '@phosphor-icons/react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Avatar } from '../../ui/Avatar';
import { Badge } from '../../ui/Chip';
import { Button } from '../../ui/Button';
import { EmptyState, ListSkeleton, Section } from '../../ui/Layout';
import { Tooltip } from '../../ui/Tooltip';
import { cn } from '../../ui/cn';
import { Money, StageMeter } from '../../glyphs';
import { RecordPicker } from '../../pickers/pickers';
import { EmailDialog, type EmailTarget } from '../../timeline/EmailDialog';
import { useAppActions } from '../../lib/app-actions';
import { dueLabel, dueState, shortDate, timeAgo } from '../../lib/format';
import { useDeals } from '../../lib/queries';
import { useWorkspace } from '../../lib/workspace';
import { useContactActions } from './mutations';
import { useContacts } from './queries';

/**
 * The people at this company. Adding someone either links an existing contact
 * or opens the create dialog with the company already filled in.
 */
export function CompanyContactsPanel({ companyId, companyName }: { companyId: string; companyName: string }) {
  const ws = useWorkspace();
  const navigate = useNavigate();
  const appActions = useAppActions();
  const contactActions = useContactActions();
  const { data, isPending } = useContacts({ filters: { companyId }, sort: { key: 'lastActivityAt', dir: 'desc' }, limit: 200 });
  const [emailTarget, setEmailTarget] = useState<EmailTarget | null>(null);
  const contacts = data?.contacts ?? [];
  const canEdit = ws.can('records.edit');

  return (
    <Section
      title="Contacts"
      count={contacts.length}
      action={
        canEdit ? (
          <>
            <RecordPicker
              kind="contact"
              value={null}
              onChange={record => record && contactActions.setCompany([record.id], companyId, companyName)}
              trigger={
                <Button variant="ghost" size="xs" leading={<UserPlus size={14} />}>
                  Link existing
                </Button>
              }
            />
            {/* The empty state offers "New contact" itself, so the header drops it there
                rather than stacking a third one on the page. */}
            {(isPending || contacts.length > 0) && (
              <Button variant="secondary" size="xs" leading={<Plus size={14} />} onClick={() => appActions.openCreate('contact', { companyId, companyName })}>
                New contact
              </Button>
            )}
          </>
        ) : undefined
      }
    >
      {isPending ? (
        <ListSkeleton rows={4} className="rounded-lg border border-line bg-card" />
      ) : contacts.length === 0 ? (
        <EmptyState
          compact
          icon={<Users size={22} weight="duotone" />}
          title="Nobody here yet"
          actions={canEdit ? <Button variant="primary" size="sm" onClick={() => appActions.openCreate('contact', { companyId, companyName })}>New contact</Button> : undefined}
        >
          Deals close because someone inside wants them to. Add the people you talk to.
        </EmptyState>
      ) : (
        <ul className="flex flex-col divide-y divide-line rounded-lg border border-line bg-card">
          {contacts.map(contact => (
            <li key={contact.id} className="group flex items-center gap-3 px-3 py-2.5">
              <Avatar person={{ id: contact.id, name: contact.name, avatarUrl: contact.avatarUrl }} size="lg" />
              <div className="min-w-0 flex-1">
                <button className="block max-w-full truncate text-ui font-medium text-ink hover:text-accent" onClick={() => navigate(`/contacts/${contact.id}`)}>
                  {contact.name}
                </button>
                <div className="truncate text-meta text-ink-3">{[contact.title, contact.email].filter(Boolean).join(' · ') || 'No title'}</div>
              </div>
              {contact.doNotContact && <Badge tone="danger">Do not contact</Badge>}
              {/* Fixed widths so the open figure and the timestamp make two columns down
                  the list instead of drifting with each row's content. */}
              <span className="hidden w-[130px] shrink-0 text-right text-meta text-ink-2 sm:inline">
                {contact.openDealCount > 0 ? (
                  <>
                    {contact.openDealCount} open · <Money value={contact.openDealValue} compact />
                  </>
                ) : null}
              </span>
              <span className="hidden w-[76px] shrink-0 text-right text-meta text-ink-3 md:inline">{contact.lastActivityAt ? timeAgo(contact.lastActivityAt) : 'No activity'}</span>
              {/* Visible on touch, where there is no hover; hover or keyboard focus
                  brings them back on a desktop. Both reveals carry the `sm:` prefix so
                  neither loses to `sm:opacity-0` in the cascade. */}
              <div className="flex shrink-0 items-center gap-1 transition-opacity sm:opacity-0 sm:focus-within:opacity-100 sm:group-hover:opacity-100">
                {contact.phone && (
                  <Tooltip content={contact.phone}>
                    <Button variant="ghost" size="xs" icon aria-label={`Call ${contact.name}`} asChild>
                      <a href={`tel:${contact.phone.replace(/[^\d+]/g, '')}`}>
                        <Phone size={15} />
                      </a>
                    </Button>
                  </Tooltip>
                )}
                {contact.email && ws.can('outreach.send') && (
                  <Tooltip content={`Email ${contact.name}`}>
                    <Button
                      variant="ghost"
                      size="xs"
                      icon
                      aria-label={`Email ${contact.name}`}
                      onClick={() => setEmailTarget({ contactId: contact.id, companyId, to: contact.email as string, name: contact.name })}
                    >
                      <EnvelopeSimple size={15} />
                    </Button>
                  </Tooltip>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <EmailDialog open={Boolean(emailTarget)} onOpenChange={open => !open && setEmailTarget(null)} target={emailTarget} />
    </Section>
  );
}

/**
 * This record's deals, read through the deals area's own `listDeals` so a deal
 * reads the same here as it does on the pipeline — rendered compactly, because
 * this is a tab on someone else's page.
 */
export function RelatedDealsPanel({
  filters,
  title = 'Deals',
  emptyHint,
  onNew,
}: {
  filters: { companyId?: string; contactId?: string };
  title?: string;
  emptyHint: string;
  onNew?: () => void;
}) {
  const ws = useWorkspace();
  const navigate = useNavigate();
  const { data, isPending } = useDeals({ filters: { ...filters, status: ['Open', 'Won', 'Lost'] }, sort: { key: 'closeDate', dir: 'asc' }, limit: 200 });
  const deals = data?.deals ?? [];
  const open = deals.filter(d => d.status === 'Open');
  const closed = deals.filter(d => d.status !== 'Open');

  return (
    <Section
      title={title}
      count={deals.length}
      description={open.length ? `${ws.money(open.reduce((n, d) => n + (d.amount ?? 0), 0), { compact: true })} open` : undefined}
      action={onNew && ws.can('records.edit') ? <Button variant="secondary" size="xs" leading={<Plus size={14} />} onClick={onNew}>New deal</Button> : undefined}
    >
      {isPending ? (
        <ListSkeleton rows={3} className="rounded-lg border border-line bg-card" />
      ) : deals.length === 0 ? (
        <EmptyState
          compact
          icon={<Trophy size={22} weight="duotone" />}
          title="No deals yet"
          actions={onNew && ws.can('records.edit') ? <Button variant="primary" size="sm" onClick={onNew}>New deal</Button> : undefined}
        >
          {emptyHint}
        </EmptyState>
      ) : (
        <ul className="flex flex-col divide-y divide-line rounded-lg border border-line bg-card">
          {[...open, ...closed].map(deal => {
            const stage = ws.stageById(deal.stageId);
            const state = dueState(deal.nextStep?.dueDate ?? undefined);
            return (
              <li key={deal.id} className="flex items-center gap-3 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <button className="block max-w-full truncate text-ui font-medium text-ink hover:text-accent" onClick={() => navigate(`/deals/${deal.id}`)}>
                    {deal.name}
                  </button>
                  <div className="flex min-w-0 items-center gap-1.5 truncate text-meta text-ink-3">
                    {deal.status === 'Open' ? (
                      <>
                        <StageMeter stageId={deal.stageId} pipelineId={deal.pipelineId} status={deal.status} />
                        <span className="truncate">{stage?.name ?? 'No stage'}</span>
                        {deal.nextStep ? (
                          <>
                            <span>·</span>
                            <span className="truncate">{deal.nextStep.title}</span>
                            <span className={cn(state === 'overdue' ? 'text-danger' : state === 'today' ? 'text-accent' : 'text-ink-3')}>{dueLabel(deal.nextStep.dueDate ?? undefined)}</span>
                          </>
                        ) : (
                          <>
                            <span>·</span>
                            <span className="text-warning">No next step</span>
                          </>
                        )}
                      </>
                    ) : (
                      <span className="truncate">
                        {deal.status === 'Won' ? 'Won' : `Lost${deal.lostReason ? ` — ${deal.lostReason}` : ''}`}
                        {deal.closedAt ? ` · ${shortDate(deal.closedAt.slice(0, 10))}` : ''}
                      </span>
                    )}
                  </div>
                </div>
                {deal.status !== 'Open' && <Badge tone={deal.status === 'Won' ? 'success' : 'danger'}>{deal.status}</Badge>}
                {/* Fixed widths, right-aligned: the dates and the amounts read as two
                    columns down the list, the way they do in a ledger. */}
                <span className="hidden w-[62px] shrink-0 text-right text-meta text-ink-3 sm:block">{deal.closeDate ? shortDate(deal.closeDate) : ''}</span>
                <span className="w-[86px] shrink-0 text-right text-ui font-medium text-ink">
                  <Money value={deal.amount} muted0 />
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}
