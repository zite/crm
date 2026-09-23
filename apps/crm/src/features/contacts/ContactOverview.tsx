import { ArrowRight, Warning } from '@phosphor-icons/react';
import { Link, useNavigate } from 'react-router-dom';
import type { GetContactOutputType } from 'zitejs/api';
import { Avatar } from '../../ui/Avatar';
import { Button } from '../../ui/Button';
import { Card, Section } from '../../ui/Layout';
import { Checkbox } from '../../ui/Form';
import { cn } from '../../ui/cn';
import { Money, TaskTypeGlyph } from '../../glyphs';
import { Timeline } from '../../timeline/Timeline';
import { useAppActions } from '../../lib/app-actions';
import { dueLabel, dueState, plural } from '../../lib/format';
import { useTaskActions } from '../../lib/mutations';
import { useTasks, useTimeline } from '../../lib/queries';
import { useWorkspace } from '../../lib/workspace';
import { InlineText } from '../companies/inline';
import { useContactActions } from '../companies/mutations';

/** Who they are, what is open with them, and what happens next. */
export function ContactOverview({ data }: { data: GetContactOutputType }) {
  const ws = useWorkspace();
  const navigate = useNavigate();
  const appActions = useAppActions();
  const actions = useContactActions();
  const taskActions = useTaskActions();
  const contact = data.contact;
  const canEdit = ws.can('records.edit');
  const tasks = useTasks({ filters: { contactId: contact.id, status: 'Open' }, limit: 5 });
  const timeline = useTimeline('contact', contact.id, { limit: 12 });
  const openTasks = tasks.data?.tasks ?? [];

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-3 sm:grid-cols-3">
        <Figure
          label="Open pipeline"
          value={<Money value={data.figures.openPipeline} compact />}
          hint={plural(data.figures.openDeals, 'deal they are on', 'deals they are on')}
          onClick={() => navigate(`/contacts/${contact.id}/deals`)}
        />
        <Figure label="Won with them" value={<Money value={data.figures.wonRevenue} compact />} hint={data.figures.wonDeals ? plural(data.figures.wonDeals, 'deal') : 'Nothing closed won yet'} />
        <Figure label="Activity" value={data.counts.activities} hint="Calls, emails, meetings and notes" onClick={() => navigate(`/contacts/${contact.id}/activity`)} />
      </div>

      <Section title="Next step">
        {openTasks.length === 0 ? (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-warning/40 bg-warning/[0.05] px-3 py-3 text-ui text-warning dark:bg-warning/10">
            <Warning size={16} />
            <span>No next step with {contact.firstName ?? contact.name}.</span>
            {canEdit && (
              <Button
                variant="ghost"
                size="xs"
                className="ml-auto text-warning hover:bg-warning/10"
                onClick={() => appActions.openCreate('task', { contactId: contact.id, contactName: contact.name, companyId: contact.companyId })}
              >
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
                  <Checkbox checked={false} disabled={!canEdit} onCheckedChange={() => taskActions.complete.mutate({ ids: [task.id], done: true })} label={`Complete ${task.title}`} />
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

      <Section title="Background">
        <Card className="px-4 py-3">
          <InlineText
            multiline
            value={contact.background}
            onSave={background => actions.update.mutate({ ids: [contact.id], patch: { background } })}
            placeholder="What they care about, how they like to be reached, and who they answer to."
            disabled={!canEdit}
            className="text-body"
          />
        </Card>
      </Section>

      {data.colleagues.length > 0 && (
        <Section title="Also at this company" count={data.colleagues.length}>
          <ul className="flex flex-wrap gap-2">
            {data.colleagues.map(person => (
              <li key={person.id}>
                <Link
                  to={`/contacts/${person.id}`}
                  className="flex items-center gap-2 rounded-lg border border-line bg-card px-2.5 py-1.5 text-ui text-ink transition-colors hover:bg-hover"
                >
                  <Avatar person={{ id: person.id, name: person.name, avatarUrl: person.avatarUrl }} size="sm" />
                  <span className="truncate">{person.name}</span>
                  {person.title && <span className="truncate text-meta text-ink-3">{person.title}</span>}
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section
        title="Recent activity"
        action={
          <Button variant="ghost" size="xs" trailing={<ArrowRight size={13} />} onClick={() => navigate(`/contacts/${contact.id}/activity`)}>
            All activity
          </Button>
        }
      >
        <Timeline data={timeline.data} isLoading={timeline.isPending} emptyHint="Log the first call or note — this is the record everyone else will read." />
      </Section>
    </div>
  );
}

function Figure({ label, value, hint, onClick }: { label: string; value: React.ReactNode; hint?: string; onClick?: () => void }) {
  const inner = (
    <>
      <div className="text-micro font-semibold uppercase text-ink-3">{label}</div>
      <div className="tabular mt-1 font-display text-[26px] leading-8 text-ink">{value}</div>
      <div className="mt-0.5 min-h-[18px] text-meta text-ink-2">{hint}</div>
    </>
  );
  return onClick ? (
    <button type="button" onClick={onClick} className="rounded-lg border border-line bg-card px-4 py-3.5 text-left shadow-hairline transition-colors hover:bg-hover/60">
      {inner}
    </button>
  ) : (
    <div className="rounded-lg border border-line bg-card px-4 py-3.5 shadow-hairline">{inner}</div>
  );
}
