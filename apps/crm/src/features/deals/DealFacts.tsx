import { Avatar, Unassigned } from '../../ui/Avatar';
import { Chipput } from '../../ui/Button';
import { FactRow } from '../../ui/Layout';
import { Money } from '../../glyphs';
import { ChoicePicker, DatePicker, MemberPicker, OptionsPicker, TagRow } from '../../pickers/pickers';
import { fullDate, shortDate, timeAgo } from '../../lib/format';
import { useDealActions } from '../../lib/mutations';
import { useDeal } from '../../lib/queries';
import { useWorkspace } from '../../lib/workspace';
import { DEAL_TYPES, FORECAST_CATEGORIES } from '@project/shared/constants';
import { hasCents } from '../quotes/lineItems';

/** The deal's properties, edited in place. The page shows them in its rail; the peek sheet inlines them. */
export function DealFacts({ dealId }: { dealId: string }) {
  const ws = useWorkspace();
  const dealActions = useDealActions();
  const { data } = useDeal(dealId);
  if (!data) return null;
  const deal = data.deal;
  const canEdit = ws.can('records.edit');
  return (
    <div className="flex flex-col divide-y divide-line">
      <div className="flex flex-col gap-0.5 py-1">
        <FactRow label="Amount">
          <span className="text-ui font-medium text-ink">
            <Money value={deal.amount} cents={hasCents(deal.amount)} />
          </span>
          {/* Short enough to stay on the value's line — "line items" wrapped and pushed the row out of the grid. */}
          {data.lineItems.count > 0 && <span className="ml-2 whitespace-nowrap text-meta text-ink-3">from {data.lineItems.count} {data.lineItems.count === 1 ? 'line' : 'lines'}</span>}
        </FactRow>
        <FactRow label="Close date">
          {canEdit ? (
            <DatePicker value={deal.closeDate} onChange={value => dealActions.setCloseDate([deal.id], value)} />
          ) : (
            <span className="text-ui">{deal.closeDate ? fullDate(deal.closeDate) : '—'}</span>
          )}
        </FactRow>
        <FactRow label="Owner">
          {canEdit ? (
            <MemberPicker value={deal.ownerId} onChange={ownerId => dealActions.setOwner([deal.id], ownerId)} />
          ) : (
            <span className="inline-flex items-center gap-1.5 text-ui">{deal.ownerId ? <Avatar person={ws.memberById(deal.ownerId)} size="xs" /> : <Unassigned size="xs" />} {ws.memberName(deal.ownerId)}</span>
          )}
        </FactRow>
        <FactRow label="Probability">
          <span className="tabular text-ui">{deal.probability}%</span>
          <span className="ml-2 text-meta text-ink-3">weighted <Money value={deal.weighted} compact /></span>
        </FactRow>
        <FactRow label="Forecast">
          {canEdit ? (
            <OptionsPicker
              options={[...FORECAST_CATEGORIES]}
              value={deal.forecastCategory}
              onChange={value => dealActions.update.mutate({ ids: [deal.id], patch: { forecastCategory: value as 'Commit' } })}
              trigger={<Chipput>{deal.forecastCategory}{!deal.forecastCategorySet && <span className="ml-1 text-ink-3">(auto)</span>}</Chipput>}
            />
          ) : (
            <span className="text-ui">{deal.forecastCategory}</span>
          )}
        </FactRow>
        <FactRow label="Type">
          {canEdit ? (
            <OptionsPicker options={[...DEAL_TYPES]} value={deal.type} onChange={value => dealActions.update.mutate({ ids: [deal.id], patch: { type: value as 'New Business' } })} trigger={<Chipput placeholder={!deal.type}>{deal.type ?? 'Set type'}</Chipput>} />
          ) : (
            <span className="text-ui">{deal.type ?? '—'}</span>
          )}
        </FactRow>
        <FactRow label="Source">
          {canEdit ? (
            <ChoicePicker list="Lead Source" value={deal.source} onChange={value => dealActions.update.mutate({ ids: [deal.id], patch: { source: value } })} />
          ) : (
            <span className="text-ui">{deal.source ?? '—'}</span>
          )}
        </FactRow>
        {deal.status === 'Lost' && (
          <FactRow label="Lost reason">
            <span className="text-ui text-danger">{deal.lostReason ?? '—'}</span>
          </FactRow>
        )}
        <FactRow label="Created">
          <span className="text-ui text-ink-2">{deal.openedAt ? shortDate(deal.openedAt.slice(0, 10)) : '—'}</span>
        </FactRow>
        <FactRow label="Last activity">
          <span className="text-ui text-ink-2">{deal.lastActivityAt ? timeAgo(deal.lastActivityAt) : 'Nothing yet'}</span>
        </FactRow>
        <FactRow label="Tags" align="start">
          <TagRow tagIds={deal.tagIds} onChange={canEdit ? ids => dealActions.setTags([deal.id], ids) : undefined} />
        </FactRow>
      </div>
    </div>
  );
}
