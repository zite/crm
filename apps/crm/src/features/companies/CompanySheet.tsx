import { ArrowRight, ArrowSquareOut } from '@phosphor-icons/react';
import { useNavigate } from 'react-router-dom';
import { Badge } from '../../ui/Chip';
import { Button } from '../../ui/Button';
import { Card, Section, Skeleton } from '../../ui/Layout';
import { Sheet, SheetBody, SheetHeader } from '../../ui/Sheet';
import { CompanyMark, Money } from '../../glyphs';
import { Composer } from '../../timeline/Composer';
import { Timeline } from '../../timeline/Timeline';
import { useAppActions } from '../../lib/app-actions';
import { plural } from '../../lib/format';
import { useTimeline } from '../../lib/queries';
import { useWorkspace } from '../../lib/workspace';
import { CompanyContactsPanel, RelatedDealsPanel } from './CompanyRelated';
import { CompanyFacts } from './CompanyFacts';
import { DuplicateBanner } from './Duplicates';
import { COMPANY_TYPE_TONE } from './companyHelpers';
import { useCompany } from './queries';

/**
 * The peek: a company opened over the list, so J/K keep walking the rows
 * behind it. Everything on it is live — it is the same data the full page reads.
 */
export function CompanySheet() {
  const { peek, openPeek } = useAppActions();
  const ws = useWorkspace();
  const navigate = useNavigate();
  const open = peek?.type === 'company';
  const { data, isPending } = useCompany(open ? peek.id : null);
  const timeline = useTimeline('company', open ? peek.id : null, { limit: 15 });
  const canEdit = ws.can('records.edit');

  const go = (path: string) => {
    openPeek(null);
    navigate(path);
  };

  return (
    <Sheet open={open} onOpenChange={value => !value && openPeek(null)} width="lg" label="Company">
      <SheetHeader
        onClose={() => openPeek(null)}
        actions={data && <Button variant="secondary" size="sm" leading={<ArrowSquareOut size={15} />} onClick={() => go(`/companies/${data.company.id}`)}>Open</Button>}
      >
        {isPending || !data ? (
          <Skeleton className="h-5 w-48" />
        ) : (
          <div className="flex min-w-0 items-center gap-2.5">
            <CompanyMark name={data.company.name} id={data.company.id} logoUrl={data.company.logoUrl} size="sm" />
            <div className="min-w-0">
              <div className="truncate text-ui font-semibold text-ink">{data.company.name}</div>
              <div className="truncate text-meta text-ink-3">{data.company.domain ?? data.company.city ?? 'No domain'}</div>
            </div>
          </div>
        )}
      </SheetHeader>
      <SheetBody>
        {isPending || !data ? (
          <div className="flex flex-col gap-4 p-5">
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : (
          <div className="flex flex-col gap-6 p-4">
            <DuplicateBanner type="company" id={data.company.id} onMerged={survivorId => go(`/companies/${survivorId}`)} />

            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <span className="font-display text-[26px] leading-8 text-ink">
                <Money value={data.figures.openPipeline} compact />
              </span>
              <span className="text-meta text-ink-2">
                open across {plural(data.figures.openDeals, 'deal')} · <Money value={data.figures.wonRevenue} compact /> won
              </span>
              {data.company.type && <Badge tone={COMPANY_TYPE_TONE[data.company.type] ?? 'neutral'}>{data.company.type}</Badge>}
              <Button variant="ghost" size="xs" className="ml-auto" trailing={<ArrowRight size={13} />} onClick={() => go(`/companies/${data.company.id}/deals`)}>
                All deals
              </Button>
            </div>

            <Card padded className="!p-4">
              <CompanyFacts company={data.company} parentName={data.parent?.name} columns={2} />
            </Card>

            <CompanyContactsPanel companyId={data.company.id} companyName={data.company.name} />
            <RelatedDealsPanel filters={{ companyId: data.company.id }} emptyHint={`Nothing is in flight with ${data.company.name} yet.`} />

            <Section title="Activity">
              <div className="flex flex-col gap-4">
                {canEdit && <Composer links={{ companyId: data.company.id }} />}
                <Timeline data={timeline.data} isLoading={timeline.isPending} emptyHint="Log the first call or note — this is the record everyone else will read." />
              </div>
            </Section>
          </div>
        )}
      </SheetBody>
    </Sheet>
  );
}
