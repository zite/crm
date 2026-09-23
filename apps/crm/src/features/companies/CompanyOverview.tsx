import { ArrowRight, Warning } from '@phosphor-icons/react';
import { Link, useNavigate } from 'react-router-dom';
import type { GetCompanyOutputType } from 'zitejs/api';
import { Avatar } from '../../ui/Avatar';
import { Badge } from '../../ui/Chip';
import { Button } from '../../ui/Button';
import { Card, Section } from '../../ui/Layout';
import { Checkbox } from '../../ui/Form';
import { cn } from '../../ui/cn';
import { CompanyMark, Money, TaskTypeGlyph } from '../../glyphs';
import { Timeline } from '../../timeline/Timeline';
import { useAppActions } from '../../lib/app-actions';
import { dueLabel, dueState, plural } from '../../lib/format';
import { useTaskActions } from '../../lib/mutations';
import { useTasks, useTimeline } from '../../lib/queries';
import { useWorkspace } from '../../lib/workspace';
import { COMPANY_TYPE_TONE } from './companyHelpers';
import { InlineText } from './inline';
import { useCompanyActions } from './mutations';

/**
 * Where things stand with this company, in the order a rep asks: how much is
 * open, what we have won, who is on it, what happens next, and what just
 * happened.
 */
export function CompanyOverview({ data }: { data: GetCompanyOutputType }) {
  const ws = useWorkspace();
  const navigate = useNavigate();
  const appActions = useAppActions();
  const actions = useCompanyActions();
  const taskActions = useTaskActions();
  const company = data.company;
  const canEdit = ws.can('records.edit');
  const tasks = useTasks({ filters: { companyId: company.id, status: 'Open' }, limit: 5 });
  const timeline = useTimeline('company', company.id, { limit: 12 });
  const openTasks = tasks.data?.tasks ?? [];

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-3 sm:grid-cols-3">
        <Figure label="Open pipeline" value={<Money value={data.figures.openPipeline} compact />} hint={`${plural(data.figures.openDeals, 'open deal')} · ${ws.money(data.figures.weightedPipeline, { compact: true })} weighted`} onClick={() => navigate(`/companies/${company.id}/deals`)} />
        <Figure label="Won revenue" value={<Money value={data.figures.wonRevenue} compact />} hint={data.figures.wonDeals ? `${plural(data.figures.wonDeals, 'deal')} won${data.figures.lostDeals ? `, ${data.figures.lostDeals} lost` : ''}` : 'Nothing closed won yet'} />
        <Figure label="People" value={data.counts.contacts} hint={data.counts.contacts ? 'Contacts at this company' : 'Nobody added yet'} onClick={() => navigate(`/companies/${company.id}/contacts`)} />
      </div>

      <Section title="Next step">
        {openTasks.length === 0 ? (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-warning/40 bg-warning/[0.05] px-3 py-3 text-ui text-warning dark:bg-warning/10">
            <Warning size={16} />
            <span>No next step on this company.</span>
            {canEdit && (
              <Button variant="ghost" size="xs" className="ml-auto text-warning hover:bg-warning/10" onClick={() => appActions.openCreate('task', { companyId: company.id, companyName: company.name })}>
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
                  {task.contactName && <span className="hidden shrink-0 text-meta text-ink-3 sm:inline">{task.contactName}</span>}
                  <span className={cn('shrink-0 text-meta', state === 'overdue' ? 'text-danger' : state === 'today' ? 'text-accent' : 'text-ink-3')}>{dueLabel(task.dueDate ?? undefined)}</span>
                  <Avatar person={ws.memberById(task.ownerId)} size="xs" />
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <Section title="About">
        <Card className="px-4 py-3">
          <InlineText
            multiline
            value={company.description}
            onSave={description => actions.update.mutate({ ids: [company.id], patch: { description } })}
            placeholder="What they do, how they buy, and who cares about it inside."
            disabled={!canEdit}
            className="text-body"
          />
        </Card>
      </Section>

      {(data.parent || data.children.length > 0) && (
        <Section title="Corporate group" count={data.children.length + (data.parent ? 1 : 0)}>
          <ul className="flex flex-col divide-y divide-line rounded-lg border border-line bg-card">
            {data.parent && (
              <li className="flex items-center gap-3 px-3 py-2.5">
                <CompanyMark name={data.parent.name} id={data.parent.id} logoUrl={data.parent.logoUrl} size="md" />
                <div className="min-w-0 flex-1">
                  <Link to={`/companies/${data.parent.id}`} className="block truncate text-ui font-medium text-ink hover:text-accent">
                    {data.parent.name}
                  </Link>
                  <div className="truncate text-meta text-ink-3">Parent company{data.parent.domain ? ` · ${data.parent.domain}` : ''}</div>
                </div>
                <Badge>Parent</Badge>
              </li>
            )}
            {data.children.map(child => (
              <li key={child.id} className="flex items-center gap-3 px-3 py-2.5">
                <CompanyMark name={child.name} id={child.id} logoUrl={child.logoUrl} size="md" />
                <div className="min-w-0 flex-1">
                  <Link to={`/companies/${child.id}`} className="block truncate text-ui font-medium text-ink hover:text-accent">
                    {child.name}
                  </Link>
                  <div className="truncate text-meta text-ink-3">
                    Subsidiary · {plural(child.contactCount, 'contact')} · {plural(child.openDealCount, 'open deal')}
                  </div>
                </div>
                {child.type && <Badge tone={COMPANY_TYPE_TONE[child.type] ?? 'neutral'}>{child.type}</Badge>}
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section
        title="Recent activity"
        action={
          <Button variant="ghost" size="xs" trailing={<ArrowRight size={13} />} onClick={() => navigate(`/companies/${company.id}/activity`)}>
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
