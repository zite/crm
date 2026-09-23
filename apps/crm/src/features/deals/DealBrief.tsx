import { Sparkle, Warning } from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import { aiDealBrief } from 'zitejs/api';
import { Button } from '../../ui/Button';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '../../ui/Dialog';
import { Skeleton } from '../../ui/Layout';
import { useAppActions } from '../../lib/app-actions';
import { todayString } from '../../lib/format';
import { useWorkspace } from '../../lib/workspace';

/**
 * "Where does this deal stand?" — the answer before a pipeline review, with
 * each suggested next step one click from becoming a task. With no Anthropic
 * connection the same brief is written from the deal's facts.
 */
export function DealBriefDialog({ open, onOpenChange, dealId, dealName, companyId, contactId }: { open: boolean; onOpenChange: (open: boolean) => void; dealId: string; dealName: string; companyId: string | null; contactId: string | null }) {
  const ws = useWorkspace();
  const actions = useAppActions();
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ['deal-brief', dealId],
    queryFn: () => aiDealBrief({ id: dealId, today: todayString() }),
    enabled: open,
    staleTime: 60_000,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader title="Where this stands" description={dealName} />
        <DialogBody className="flex flex-col gap-5">
          {isPending ? (
            <div className="flex flex-col gap-3">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          ) : isError || !data ? (
            <div className="flex flex-col items-start gap-3">
              <p className="text-body text-ink-2">The brief couldn’t be written just now.</p>
              <Button variant="secondary" size="sm" onClick={() => refetch()}>
                Try again
              </Button>
            </div>
          ) : (
            <>
              <p className="text-body text-ink">{data.summary}</p>
              {data.risks.length > 0 && (
                <section>
                  <h3 className="mb-2 text-micro font-semibold uppercase text-ink-3">Worth watching</h3>
                  <ul className="flex flex-col gap-1.5">
                    {data.risks.map(risk => (
                      <li key={risk} className="flex items-start gap-2 text-ui text-ink">
                        <Warning size={15} className="mt-0.5 shrink-0 text-warning" />
                        {risk}
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {data.nextSteps.length > 0 && (
                <section>
                  <h3 className="mb-2 text-micro font-semibold uppercase text-ink-3">Suggested next steps</h3>
                  <ul className="flex flex-col divide-y divide-line rounded-lg border border-line">
                    {data.nextSteps.map(step => (
                      <li key={step} className="flex items-center gap-3 px-3 py-2.5">
                        <span className="min-w-0 flex-1 text-ui text-ink">{step}</span>
                        {ws.can('records.edit') && (
                          <Button
                            variant="secondary"
                            size="xs"
                            onClick={() => {
                              onOpenChange(false);
                              actions.openCreate('task', { title: step, dealId, dealName, companyId, contactId });
                            }}
                          >
                            Add task
                          </Button>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          )}
        </DialogBody>
        <DialogFooter start={data && !data.aiGenerated ? <span className="text-meta text-ink-3">Written from the deal’s own data — connect Anthropic in settings for a written brief.</span> : <span className="inline-flex items-center gap-1.5 text-meta text-ink-3"><Sparkle size={13} /> Written by Claude from this deal’s history</span>}>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
