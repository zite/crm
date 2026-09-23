import { CheckSquare, DotsThree, EnvelopeSimple, Plus, Sparkle, Trash, UserPlus, Warning } from '@phosphor-icons/react';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { setDealContacts } from 'zitejs/api';
import { Avatar } from '../../ui/Avatar';
import { Badge } from '../../ui/Chip';
import { Button } from '../../ui/Button';
import { Card, Section, Skeleton } from '../../ui/Layout';
import { Checkbox } from '../../ui/Form';
import { Menu, MenuContent, MenuItem, MenuTrigger } from '../../ui/Menu';
import { cn } from '../../ui/cn';
import { Money, StageTrack, StalledBadge, TaskTypeGlyph } from '../../glyphs';
import { DealFacts } from './DealFacts';
import { RecordPicker } from '../../pickers/pickers';
import { Composer } from '../../timeline/Composer';
import { EmailDialog, type EmailTarget } from '../../timeline/EmailDialog';
import { Timeline } from '../../timeline/Timeline';
import { useAppActions } from '../../lib/app-actions';
import { errorMessage } from '../../lib/errors';
import { dueLabel, dueState } from '../../lib/format';
import { useDealActions, useTaskActions } from '../../lib/mutations';
import { invalidate, useDeal, useTasks, useTimeline } from '../../lib/queries';
import { useWorkspace } from '../../lib/workspace';
import { FilesPanel } from '../../records/FilesPanel';
import { DealBriefDialog } from './DealBrief';
import { DealLineItems } from '../quotes/DealLineItems';
import { hasCents } from '../quotes/lineItems';
import { dealStalledDays, givenName } from './dealHelpers';
import { WonLostDialog } from './WonLostDialog';

/**
 * One deal, rendered the same way in the peek sheet and on the full page.
 * `compact` stacks the facts under the header instead of putting them in a rail.
 */
export function DealDetail({ dealId, compact }: { dealId: string; compact?: boolean }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const actions = useAppActions();
  const dealActions = useDealActions();
  const taskActions = useTaskActions();
  const { data, isPending } = useDeal(dealId);
  const timeline = useTimeline('deal', dealId);
  const tasks = useTasks({ filters: { dealId, status: 'Open' } });
  const [emailTarget, setEmailTarget] = useState<EmailTarget | null>(null);
  const [closing, setClosing] = useState<'Won' | 'Lost' | null>(null);
  const [briefOpen, setBriefOpen] = useState(false);

  if (isPending || !data) {
    return (
      <div className="flex flex-col gap-4 p-5">
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  const deal = data.deal;
  const stalled = dealStalledDays(deal, ws);
  const canEdit = ws.can('records.edit');
  const primaryContact = data.contacts.find(c => c.isPrimary) ?? data.contacts[0] ?? null;

  const buyingGroup = (
    <Section
      title="Buying group"
      count={data.contacts.length || undefined}
      action={
        canEdit ? (
          <RecordPicker
            kind="contact"
            value={null}
            onChange={async record => {
              if (!record) return;
              try {
                await setDealContacts({ dealId: deal.id, add: [{ contactId: record.id }] });
                invalidate(qc, 'deal');
              } catch (e) {
                toast.error(errorMessage(e, 'Couldn’t add that contact'));
              }
            }}
            trigger={
              <Button variant="ghost" size="xs" leading={<UserPlus size={14} />}>
                Add
              </Button>
            }
          />
        ) : undefined
      }
    >
      {data.contacts.length === 0 ? (
        <p className="rounded-md border border-dashed border-line px-3 py-4 text-center text-meta text-ink-3">Nobody linked yet. Deals close because someone inside wants them to.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line rounded-lg border border-line bg-card">
          {data.contacts.map(contact => (
            <li key={contact.linkId} className="group flex items-center gap-3 px-3 py-2.5">
              <Avatar person={{ id: contact.contactId, name: contact.name }} size="md" />
              <div className="min-w-0 flex-1">
                <button className="block truncate text-ui font-medium text-ink hover:text-accent" onClick={() => navigate(`/contacts/${contact.contactId}`)}>
                  {contact.name}
                </button>
                <div className="truncate text-meta text-ink-3">{[contact.title, contact.email].filter(Boolean).join(' · ') || 'No title'}</div>
              </div>
              {contact.isPrimary && <Badge tone="accent">Primary</Badge>}
              {contact.role && !contact.isPrimary && <Badge>{contact.role}</Badge>}
              <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                {contact.email && (
                  <Button variant="ghost" size="xs" icon aria-label={`Email ${contact.name}`} onClick={() => setEmailTarget({ contactId: contact.contactId, companyId: deal.companyId, dealId: deal.id, to: contact.email!, name: contact.name })}>
                    <EnvelopeSimple size={15} />
                  </Button>
                )}
                {canEdit && (
                  <Menu>
                    <MenuTrigger asChild>
                      <Button variant="ghost" size="xs" icon aria-label="Contact actions">
                        <DotsThree size={16} weight="bold" />
                      </Button>
                    </MenuTrigger>
                    <MenuContent align="end">
                      {!contact.isPrimary && (
                        <MenuItem
                          onSelect={async () => {
                            await setDealContacts({ dealId: deal.id, primaryContactId: contact.contactId });
                            invalidate(qc, 'deal', 'deals');
                          }}
                        >
                          Make primary contact
                        </MenuItem>
                      )}
                      <MenuItem
                        destructive
                        icon={<Trash size={16} />}
                        onSelect={async () => {
                          await setDealContacts({ dealId: deal.id, remove: [contact.contactId] });
                          invalidate(qc, 'deal');
                        }}
                      >
                        Remove from deal
                      </MenuItem>
                    </MenuContent>
                  </Menu>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );

  const openTasks = tasks.data?.tasks ?? [];
  const taskPanel = (
    <Section
      title="Next steps"
      count={openTasks.length || undefined}
      action={
        canEdit ? (
          <Button variant="ghost" size="xs" leading={<Plus size={14} />} onClick={() => actions.openCreate('task', { dealId: deal.id, dealName: deal.name, companyId: deal.companyId, contactId: deal.contactId })}>
            Add
          </Button>
        ) : undefined
      }
    >
      {openTasks.length === 0 ? (
        <div className="flex items-center gap-2 rounded-md border border-dashed border-warning/40 bg-warning/5 px-3 py-3 text-ui text-warning">
          <Warning size={16} />
          <span>No next step — every open deal should have one.</span>
          {canEdit && (
            <Button variant="ghost" size="xs" className="ml-auto text-warning hover:bg-warning/10" onClick={() => actions.openCreate('task', { dealId: deal.id, dealName: deal.name })}>
              Add one
            </Button>
          )}
        </div>
      ) : (
        <ul className="flex flex-col divide-y divide-line rounded-lg border border-line bg-card">
          {openTasks.map(task => {
            const state = dueState(task.dueDate ?? undefined);
            return (
              <li key={task.id} className="flex items-center gap-3 px-3 py-2.5">
                <Checkbox checked={false} onCheckedChange={() => taskActions.complete.mutate({ ids: [task.id], done: true })} label={`Complete ${task.title}`} />
                <TaskTypeGlyph type={task.type} />
                <span className="min-w-0 flex-1 truncate text-ui text-ink">{task.title}</span>
                <span className={cn('shrink-0 text-meta', state === 'overdue' ? 'text-danger' : state === 'today' ? 'text-accent' : 'text-ink-3')}>{dueLabel(task.dueDate ?? undefined)}</span>
                <Avatar person={ws.memberById(task.ownerId)} size="xs" />
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );

  const quotesPanel = data.quotes.length > 0 && (
    <Section title="Quotes" count={data.quotes.length}>
      <ul className="flex flex-col divide-y divide-line rounded-lg border border-line bg-card">
        {data.quotes.map(quote => (
          <li key={quote.id} className="flex items-center gap-3 px-3 py-2.5">
            <span className="font-mono text-meta tracking-[0.03em] text-ink-2">{quote.number}</span>
            <button className="min-w-0 flex-1 truncate text-left text-ui text-ink hover:text-accent" onClick={() => navigate(`/quotes/${quote.id}`)}>
              {quote.title || 'Quote'}
            </button>
            <Badge tone={quote.status === 'Accepted' ? 'success' : quote.status === 'Declined' ? 'danger' : quote.status === 'Sent' || quote.status === 'Viewed' ? 'info' : 'neutral'}>{quote.status}</Badge>
            <span className="tabular shrink-0 text-ui text-ink">
              <Money value={quote.total} cents={hasCents(quote.total)} />
            </span>
          </li>
        ))}
      </ul>
    </Section>
  );

  return (
    <div className={cn('flex flex-col gap-6', compact ? 'p-4' : '')}>
      <div className="flex flex-col gap-4">
        <StageTrack
          stageId={deal.stageId}
          pipelineId={deal.pipelineId}
          status={deal.status}
          disabled={!canEdit}
          onPick={canEdit ? stageId => dealActions.setStage([deal.id], stageId, { status: 'Open' }) : undefined}
        />
        <div className="flex flex-wrap items-center gap-2">
          {stalled > 0 && <StalledBadge days={stalled} />}
          {deal.status === 'Open' && canEdit && (
            <>
              <Button variant="primary" size="sm" onClick={() => setClosing('Won')}>
                Mark won
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setClosing('Lost')}>
                Mark lost
              </Button>
            </>
          )}
          {primaryContact?.email && (
            <Button variant="secondary" size="sm" leading={<EnvelopeSimple size={15} />} onClick={() => setEmailTarget({ contactId: primaryContact.contactId, companyId: deal.companyId, dealId: deal.id, to: primaryContact.email!, name: primaryContact.name })}>
              Email {givenName(primaryContact.name)}
            </Button>
          )}
          <Button variant="ghost" size="sm" leading={<Sparkle size={15} />} onClick={() => setBriefOpen(true)}>
            Where this stands
          </Button>
          {canEdit && (
            <Button variant="ghost" size="sm" leading={<CheckSquare size={15} />} onClick={() => actions.openCreate('task', { dealId: deal.id, dealName: deal.name, companyId: deal.companyId, contactId: deal.contactId })}>
              Add task
            </Button>
          )}
        </div>
      </div>

      {compact ? (
        <Card className="p-4">
          <DealFacts dealId={deal.id} />
        </Card>
      ) : null}

      {taskPanel}
      {buyingGroup}
      <DealLineItems dealId={deal.id} canEdit={canEdit} />
      {quotesPanel}
      <FilesPanel type="deal" id={deal.id} />

      <Section title="Activity">
        <div className="flex flex-col gap-4">
          {canEdit && <Composer links={{ dealId: deal.id, companyId: deal.companyId, contactId: deal.contactId }} onEmail={primaryContact?.email ? () => setEmailTarget({ contactId: primaryContact.contactId, companyId: deal.companyId, dealId: deal.id, to: primaryContact.email!, name: primaryContact.name }) : undefined} />}
          <Timeline data={timeline.data} isLoading={timeline.isPending} emptyHint="Log the first call or note — this is the record everyone else will read." />
        </div>
      </Section>

      <DealBriefDialog open={briefOpen} onOpenChange={setBriefOpen} dealId={deal.id} dealName={deal.name} companyId={deal.companyId} contactId={deal.contactId} />
      <EmailDialog open={Boolean(emailTarget)} onOpenChange={open => !open && setEmailTarget(null)} target={emailTarget} />
      {closing && <WonLostDialog open onOpenChange={open => !open && setClosing(null)} deals={[{ ...deal } as never]} outcome={closing} onDone={() => setClosing(null)} />}
    </div>
  );
}

