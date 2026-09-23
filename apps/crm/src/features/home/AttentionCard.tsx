import { ArrowRight, Clock, Target, Warning } from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Card } from '../../ui/Layout';
import { cn } from '../../ui/cn';
import { CompanyMark, Money } from '../../glyphs';
import { dueLabel, dueState, timeAgo } from '../../lib/format';
import type { HomeDeal } from './homeData';

/**
 * Deals needing attention. One list per reason, capped, each row saying in
 * words *why* it is here — a list of deals with no reason is just a list.
 */

type Reason = 'stalled' | 'noNextStep' | 'closingSoon';

const HEADINGS: Record<Reason, { title: string; icon: ReactNode; blurb: string; filter: string }> = {
  stalled: { title: 'Stalled', icon: <Clock size={15} className="text-warning" />, blurb: 'Sitting in a stage past its limit.', filter: 'stalled' },
  noNextStep: { title: 'No next step', icon: <Warning size={15} className="text-warning" />, blurb: 'Nothing is scheduled on them.', filter: 'noNextStep' },
  closingSoon: { title: 'Closing within 14 days', icon: <Target size={15} className="text-accent" />, blurb: 'Their close date is nearly here.', filter: 'closingSoon' },
};

export function AttentionGroup({ reason, deals, total, today }: { reason: Reason; deals: HomeDeal[]; total: number; today: string }) {
  const head = HEADINGS[reason];
  if (!deals.length) return null;
  return (
    <section className="flex flex-col">
      <div className="flex items-center gap-2 px-4 py-2.5">
        {head.icon}
        <h3 className="text-ui font-semibold text-ink">{head.title}</h3>
        <span className="tabular text-meta text-ink-3">{total}</span>
        <span className="hidden truncate text-meta text-ink-3 sm:inline">· {head.blurb}</span>
        <Link to={`/deals?filter=${head.filter}`} className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-sm px-1.5 py-0.5 text-meta font-medium text-accent hover:bg-hover">
          {total > deals.length ? `See all ${total}` : 'See all'}
          <ArrowRight size={12} weight="bold" />
        </Link>
      </div>
      <ul className="border-t border-line">
        {deals.map((deal, index) => (
          <li key={deal.id} className={cn(index > 0 && 'border-t border-line')}>
            <Link to={`/deals/${deal.id}`} className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-hover/60">
              <CompanyMark name={deal.companyName ?? deal.name} id={deal.companyId ?? deal.id} size="sm" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-ui font-medium text-ink">{deal.name}</span>
                <span className="block truncate text-meta text-ink-3">{reasonLine(reason, deal, today)}</span>
              </span>
              <span className="shrink-0 text-ui text-ink-2">
                <Money value={deal.amount} compact muted0 />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function reasonLine(reason: Reason, deal: HomeDeal, today: string) {
  if (reason === 'stalled') {
    const quiet = deal.lastActivityAt ? `last touched ${timeAgo(deal.lastActivityAt)}` : 'never touched';
    return deal.stalledDays > 0 ? `Stalled ${deal.stalledDays}d · ${quiet}` : quiet;
  }
  if (reason === 'noNextStep') {
    return deal.lastActivityAt ? `No next step · last touched ${timeAgo(deal.lastActivityAt)}` : 'No next step and nothing logged';
  }
  const state = dueState(deal.closeDate, today);
  return `Closes ${dueLabel(deal.closeDate, today).toLowerCase()}${state === 'overdue' ? ' — the date has passed' : ''}`;
}

export function AttentionCard({ children }: { children: ReactNode }) {
  return <Card className="divide-y divide-line overflow-hidden">{children}</Card>;
}
