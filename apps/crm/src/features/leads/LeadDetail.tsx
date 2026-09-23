import { ArrowSquareOut, BookmarkSimple, CheckSquare, EnvelopeSimple, Plus, Prohibit, Trophy, User, Warning } from '@phosphor-icons/react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Avatar } from '../../ui/Avatar';
import { Button } from '../../ui/Button';
import { Card, Section, Skeleton } from '../../ui/Layout';
import { Checkbox } from '../../ui/Form';
import { cn } from '../../ui/cn';
import { CompanyMark, Money, TaskTypeGlyph } from '../../glyphs';
import { FilesPanel } from '../../records/FilesPanel';
import { Composer } from '../../timeline/Composer';
import { EmailDialog, type EmailTarget } from '../../timeline/EmailDialog';
import { Timeline } from '../../timeline/Timeline';
import { useAppActions } from '../../lib/app-actions';
import { dueLabel, dueState } from '../../lib/format';
import { useTaskActions } from '../../lib/mutations';
import { useTasks, useTimeline } from '../../lib/queries';
import { useWorkspace } from '../../lib/workspace';
import { ConvertLeadDialog } from './ConvertLeadDialog';
import { DisqualifyDialog } from './DisqualifyDialog';
import { LeadFacts } from './LeadFacts';
import { LeadScoreDial } from './LeadGlyphs';
import { isNeglected, useLead, useLeadActions } from './leadData';

/**
 * One lead, rendered the same way in the peek sheet and on the full page.
 * `compact` stacks the facts under the header instead of putting them in a rail.
 */
export function LeadDetail({ leadId, compact }: { leadId: string; compact?: boolean }) {
  const ws = useWorkspace();
  const navigate = useNavigate();
  const actions = useAppActions();
  const leadActions = useLeadActions();
  const taskActions = useTaskActions();
  const { data, isPending } = useLead(leadId);
  const timeline = useTimeline('lead', leadId);
  const tasks = useTasks({ filters: { leadId, status: 'Open' } });
  const [emailTarget, setEmailTarget] = useState<EmailTarget | null>(null);
  const [converting, setConverting] = useState(false);
  const [disqualifying, setDisqualifying] = useState(false);

  if (isPending || !data) {
    return (
      <div className="flex flex-col gap-4 p-5">
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  const lead = data.lead;
  const canEdit = ws.can('records.edit');
  const converted = Boolean(lead.convertedAt);
  const neglected = isNeglected(lead, ws.settings.preferences.leadResponseHours);
  const openTasks = tasks.data?.tasks ?? [];

  return (
    <div className={cn('flex flex-col gap-6', compact && 'p-4')}>
      {/* What it became — the first thing to say about a converted lead. */}
      {converted && (
        <section className="rounded-lg border border-success/30 bg-success/5 p-4">
          <h3 className="flex items-center gap-1.5 text-ui font-semibold text-success">
            <Trophy size={15} weight="fill" /> Converted
          </h3>
          <p className="mt-1 text-meta text-ink-2">This lead is a real record now. Everything logged on it moved across.</p>
          <div className="mt-3 flex flex-col gap-1.5">
            {data.converted.contact && (
              <ConvertedLink icon={<User size={15} className="text-ink-3" />} label={data.converted.contact.name} hint={data.converted.contact.title ?? data.converted.contact.email} onClick={() => navigate(`/contacts/${data.converted.contact!.id}`)} />
            )}
            {data.converted.company && (
              <ConvertedLink icon={<CompanyMark name={data.converted.company.name} id={data.converted.company.id} size="xs" />} label={data.converted.company.name} hint={data.converted.company.domain} onClick={() => navigate(`/companies/${data.converted.company!.id}`)} />
            )}
            {data.converted.deal && (
              <ConvertedLink
                icon={<Trophy size={15} className="text-ink-3" />}
                label={data.converted.deal.name}
                hint={data.converted.deal.status}
                trailing={<Money value={data.converted.deal.amount} />}
                onClick={() => navigate(`/deals/${data.converted.deal!.id}`)}
              />
            )}
            {!data.converted.contact && !data.converted.company && !data.converted.deal && <p className="text-ui text-ink-2">The records it became have since been deleted.</p>}
          </div>
        </section>
      )}

      {/* Score and why, then the things a rep actually does. */}
      <div className="flex flex-col gap-4">
        {/* The reasons get the same heading they have in the review deck — a bare
            run of "+24 …" tokens beside the dial reads like debris. */}
        <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
          <LeadScoreDial score={lead.score} rating={lead.rating} />
          {data.scoreReasons.length > 0 && (
            <div className="min-w-[200px] flex-1">
              <h3 className="text-micro font-semibold uppercase text-ink-3">Why it scores {lead.score}</h3>
              <ul className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-meta text-ink-2">
                {data.scoreReasons.map(reason => (
                  <li key={reason} className="tabular whitespace-nowrap">
                    {reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {neglected && (
          <div className="flex items-center gap-2 rounded-md border border-dashed border-warning/40 bg-warning/5 px-3 py-2.5 text-ui text-warning">
            <Warning size={16} />
            <span>Nobody has replied yet — this came in over {ws.settings.preferences.leadResponseHours} hours ago.</span>
          </div>
        )}

        {canEdit && !converted && (
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" size="sm" leading={<Trophy size={15} />} onClick={() => setConverting(true)}>
              Convert
            </Button>
            {lead.status === 'New' && (
              <Button variant="secondary" size="sm" onClick={() => leadActions.startWorking([lead.id], ws.me.id)}>
                Start working
              </Button>
            )}
            {lead.email && (
              <Button variant="secondary" size="sm" leading={<EnvelopeSimple size={15} />} onClick={() => setEmailTarget({ leadId: lead.id, to: lead.email!, name: lead.name })}>
                Email
              </Button>
            )}
            <Button variant="ghost" size="sm" leading={<CheckSquare size={15} />} onClick={() => actions.openCreate('task', { leadId: lead.id, leadName: lead.name })}>
              Add task
            </Button>
            {lead.status !== 'Nurturing' && (
              <Button variant="ghost" size="sm" leading={<BookmarkSimple size={15} />} onClick={() => leadActions.setStatus([lead.id], 'Nurturing')}>
                Nurture
              </Button>
            )}
            <Button variant="ghost" size="sm" leading={<Prohibit size={15} />} onClick={() => setDisqualifying(true)}>
              Disqualify
            </Button>
          </div>
        )}
      </div>

      {compact && (
        <Card padded className="!p-4">
          <LeadFacts lead={lead} />
        </Card>
      )}

      {lead.message && (
        <Section title="What they wrote">
          <blockquote className="rounded-lg border border-line bg-card px-4 py-3 text-body leading-6 text-ink whitespace-pre-wrap">{lead.message}</blockquote>
        </Section>
      )}

      <Section
        title="Next steps"
        count={openTasks.length}
        action={
          canEdit ? (
            <Button variant="ghost" size="xs" leading={<Plus size={14} />} onClick={() => actions.openCreate('task', { leadId: lead.id, leadName: lead.name })}>
              Add
            </Button>
          ) : undefined
        }
      >
        {openTasks.length === 0 ? (
          <p className="rounded-md border border-dashed border-line px-3 py-4 text-center text-meta text-ink-3">
            {converted ? 'Nothing open — the work lives on the contact and deal now.' : 'No next step. A lead with nothing scheduled goes quiet.'}
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-line rounded-lg border border-line bg-card">
            {openTasks.map(task => {
              const state = dueState(task.dueDate ?? undefined);
              return (
                <li key={task.id} className="flex items-center gap-3 px-3 py-2.5">
                  <Checkbox checked={false} onCheckedChange={() => taskActions.complete.mutate({ ids: [task.id], done: true })} label={`Complete ${task.title}`} disabled={!canEdit} />
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

      <FilesPanel type="lead" id={lead.id} />

      <Section title="Activity">
        <div className="flex flex-col gap-4">
          {canEdit && <Composer links={{ leadId: lead.id }} onEmail={lead.email ? () => setEmailTarget({ leadId: lead.id, to: lead.email!, name: lead.name }) : undefined} />}
          <Timeline data={timeline.data} isLoading={timeline.isPending} emptyHint="Log the first call or note — this is what the next person to pick it up will read." />
        </div>
      </Section>

      <EmailDialog open={Boolean(emailTarget)} onOpenChange={open => !open && setEmailTarget(null)} target={emailTarget} />
      <ConvertLeadDialog open={converting} onOpenChange={setConverting} lead={lead} />
      <DisqualifyDialog open={disqualifying} onOpenChange={setDisqualifying} leadIds={[lead.id]} leadName={lead.name} />
    </div>
  );
}

function ConvertedLink({ icon, label, hint, trailing, onClick }: { icon: React.ReactNode; label: string; hint?: string | null; trailing?: React.ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="group flex items-center gap-2.5 rounded-md border border-line bg-card px-3 py-2 text-left transition-colors hover:bg-hover/60">
      <span className="flex h-5 w-5 shrink-0 items-center justify-center">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-ui text-ink group-hover:text-accent">{label}</span>
        {hint && <span className="block truncate text-meta text-ink-3">{hint}</span>}
      </span>
      {trailing && <span className="shrink-0 text-ui text-ink-2">{trailing}</span>}
      <ArrowSquareOut size={14} className="shrink-0 text-ink-3" />
    </button>
  );
}
