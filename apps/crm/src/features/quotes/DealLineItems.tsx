import { FileText, ListPlus, Receipt } from '@phosphor-icons/react';
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { saveLineItems } from 'zitejs/api';
import { Button } from '../../ui/Button';
import { Section, Skeleton } from '../../ui/Layout';
import { errorMessage } from '../../lib/errors';
import { useWorkspace } from '../../lib/workspace';
import { LineItemsEditor, ReadOnlyLine, TotalsBlock } from './LineItemsEditor';
import { blankLine, fromLineItems, isComplete, sameLines, toPayload, totalsOf, type EditableLine } from './lineItems';
import { invalidateQuotes, useLineItems } from './queries';

/**
 * Line items and quotes on a deal. A deal with lines takes its amount from
 * their total — so the board, the forecast and every quote agree — and a deal
 * without them keeps an amount the rep types by hand.
 *
 * Rendered by features/deals/DealDetail.tsx.
 */
export function DealLineItems({ dealId, canEdit }: { dealId: string; canEdit: boolean }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data, isPending } = useLineItems(dealId);
  const [draft, setDraft] = useState<EditableLine[] | null>(null);
  const [showErrors, setShowErrors] = useState(false);

  const saved = useMemo(() => fromLineItems(data?.items ?? []), [data]);
  const lines = draft ?? saved;
  const dirty = draft !== null && !sameLines(draft, saved);
  const totals = totalsOf(lines, 0);

  // A refetch that lands while nothing is being edited should show through.
  useEffect(() => {
    if (draft && sameLines(draft, saved)) setDraft(null);
  }, [saved, draft]);

  const save = useMutation({
    mutationFn: (next: EditableLine[]) => saveLineItems({ dealId, items: toPayload(next) }),
    onSuccess: result => {
      setDraft(null);
      setShowErrors(false);
      invalidateQuotes(qc, { dealId });
      toast.success(result.count ? `Line items saved — the deal is now ${ws.money(result.total)}` : 'Line items removed — set the amount by hand');
    },
    onError: error => toast.error(errorMessage(error, 'Couldn’t save the line items')),
  });

  const submit = () => {
    if (!isComplete(lines)) {
      setShowErrors(true);
      toast.error('Every line needs a description');
      return;
    }
    save.mutate(lines);
  };

  const action = (
    <div className="flex items-center gap-1.5">
      {lines.length > 0 && ws.can('quotes.manage') && (
        <Button variant="ghost" size="xs" leading={<FileText size={14} />} onClick={() => navigate(`/quotes/new?deal=${dealId}`)}>
          New quote
        </Button>
      )}
      {canEdit && lines.length > 0 && (
        <Button variant="ghost" size="xs" leading={<ListPlus size={14} />} onClick={() => setDraft([...lines, blankLine()])}>
          Add
        </Button>
      )}
    </div>
  );

  if (isPending) {
    return (
      <Section title="Line items">
        <div className="flex flex-col gap-2 rounded-lg border border-line bg-card p-3">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
      </Section>
    );
  }

  // No lines and nothing being edited: invite pricing, and leave the amount alone.
  if (!lines.length && !dirty) {
    return (
      <Section title="Line items" action={action}>
        <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed border-line-strong bg-card px-4 py-5 sm:flex-row sm:items-center">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-sunken text-ink-2">
            <Receipt size={20} weight="duotone" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-ui font-medium text-ink">Price this deal from the product list</p>
            <p className="mt-0.5 text-meta text-ink-2">Add lines and the deal amount follows their total. Until then the amount stays yours to type.</p>
          </div>
          {canEdit && (
            <Button variant="secondary" size="sm" onClick={() => setDraft([blankLine()])}>
              Add line items
            </Button>
          )}
        </div>
      </Section>
    );
  }

  return (
    <Section title="Line items" count={lines.length} action={action}>
      <div className="flex flex-col gap-3">
        {canEdit ? (
          <LineItemsEditor lines={lines} onChange={setDraft} showErrors={showErrors} />
        ) : (
          <div className="overflow-hidden rounded-lg border border-line bg-card">
            {lines.map(line => (
              <ReadOnlyLine key={line.id} line={line} />
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="text-meta text-ink-2">
            {dirty ? (
              <span className="text-warning">Unsaved — the deal amount becomes {ws.money(totals.total)} when you save.</span>
            ) : (
              <span>The deal amount is the total of these lines.</span>
            )}
          </div>
          <TotalsBlock lines={lines} inset={canEdit ? 'grid' : 'row'} className="max-w-[340px]" />
        </div>

        {canEdit && dirty && (
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => { setDraft(null); setShowErrors(false); }} disabled={save.isPending}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" loading={save.isPending} onClick={submit}>
              Save line items
            </Button>
          </div>
        )}
      </div>
    </Section>
  );
}
