import { ArrowSquareOut } from '@phosphor-icons/react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../../ui/Button';
import { Sheet, SheetBody, SheetHeader } from '../../ui/Sheet';
import { Skeleton } from '../../ui/Layout';
import { CompanyMark, LeadStatusBadge } from '../../glyphs';
import { useAppActions } from '../../lib/app-actions';
import { LeadDetail } from './LeadDetail';
import { useLead } from './leadData';

/**
 * The peek: a lead opened over the list, so J/K keep walking the rows behind
 * it. Everything on it is live — it is the same detail the full page renders.
 */
export function LeadSheet() {
  const { peek, openPeek } = useAppActions();
  const navigate = useNavigate();
  const open = peek?.type === 'lead';
  const { data, isPending } = useLead(open ? peek.id : null);

  return (
    <Sheet open={open} onOpenChange={value => !value && openPeek(null)} width="lg" label="Lead">
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
                navigate(`/leads/${data.lead.id}`);
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
            <CompanyMark name={data.lead.companyName ?? data.lead.name} id={data.lead.companyName ?? data.lead.id} size="sm" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-ui font-semibold text-ink">{data.lead.name}</div>
              <div className="truncate text-meta text-ink-3">{data.lead.companyName ?? data.lead.email ?? 'No company'}</div>
            </div>
            <LeadStatusBadge status={data.lead.status} />
          </div>
        )}
      </SheetHeader>
      <SheetBody>{open && <LeadDetail leadId={peek.id} compact />}</SheetBody>
    </Sheet>
  );
}
