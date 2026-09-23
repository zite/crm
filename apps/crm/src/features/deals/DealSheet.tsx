import { ArrowSquareOut, X } from '@phosphor-icons/react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../../ui/Button';
import { Sheet, SheetBody, SheetHeader } from '../../ui/Sheet';
import { Skeleton } from '../../ui/Layout';
import { CompanyMark } from '../../glyphs';
import { useAppActions } from '../../lib/app-actions';
import { useDeal } from '../../lib/queries';
import { DealDetail } from './DealDetail';

/**
 * The peek: a deal opened over the list, so J/K keep walking the rows behind
 * it. Everything on it is live — it is the same detail the full page renders.
 */
export function DealSheet() {
  const { peek, openPeek } = useAppActions();
  const navigate = useNavigate();
  const open = peek?.type === 'deal';
  const { data, isPending } = useDeal(open ? peek.id : null);

  return (
    <Sheet open={open} onOpenChange={value => !value && openPeek(null)} width="lg" label="Deal">
      <SheetHeader
        onClose={() => openPeek(null)}
        actions={
          data && (
            <Button
              variant="secondary"
              size="sm"
              leading={<ArrowSquareOut size={15} />}
              onClick={() => {
                openPeek(null);
                navigate(`/deals/${data.deal.id}`);
              }}
            >
              Open
            </Button>
          )
        }
      >
        {isPending || !data ? (
          <Skeleton className="h-5 w-48" />
        ) : (
          <div className="flex min-w-0 items-center gap-2.5">
            <CompanyMark name={data.company?.name ?? data.deal.name} id={data.deal.companyId ?? data.deal.id} size="sm" />
            <div className="min-w-0">
              <div className="truncate text-ui font-semibold text-ink">{data.deal.name}</div>
              <div className="truncate text-meta text-ink-3">{data.company?.name ?? 'No company'}</div>
            </div>
          </div>
        )}
      </SheetHeader>
      <SheetBody>{open && <DealDetail dealId={peek.id} compact />}</SheetBody>
    </Sheet>
  );
}
