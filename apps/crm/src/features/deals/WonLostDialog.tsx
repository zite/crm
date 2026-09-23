import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { FormDialog } from '../../ui/Dialog';
import { Field, Textarea } from '../../ui/Form';
import { ChoicePicker, FieldButton, StagePicker } from '../../pickers/pickers';
import { useDealActions } from '../../lib/mutations';
import { useWorkspace } from '../../lib/workspace';
import type { Deal } from './dealHelpers';

/**
 * Closing a deal asks for the one thing a pipeline review always needs: why.
 * A lost reason is required when the organization asks for it (Settings →
 * General), and both outcomes take a note.
 */
export function WonLostDialog({ open, onOpenChange, deals, outcome, onDone }: { open: boolean; onOpenChange: (open: boolean) => void; deals: Deal[]; outcome: 'Won' | 'Lost'; onDone?: () => void }) {
  const ws = useWorkspace();
  const { update } = useDealActions();
  const [reason, setReason] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [stageId, setStageId] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  const pipelineId = deals[0]?.pipelineId ?? ws.defaultPipeline?.id ?? '';
  const closingStages = useMemo(() => ws.stagesFor(pipelineId).filter(s => s.kind === outcome && !s.archived), [ws, pipelineId, outcome]);

  useEffect(() => {
    if (!open) return;
    setReason(null);
    setNote('');
    setError(null);
    setStageId(closingStages[0]?.id ?? '');
  }, [open]);

  const requireReason = outcome === 'Lost' && ws.settings.preferences.requireLostReason;
  const total = deals.reduce((sum, d) => sum + (d.amount ?? 0), 0);

  const submit = async () => {
    if (!stageId) {
      setError(`This pipeline has no ${outcome.toLowerCase()} stage — add one in Settings → Pipelines.`);
      return;
    }
    if (requireReason && !reason) {
      setError('Choose a reason');
      return;
    }
    await update.mutateAsync({
      ids: deals.map(d => d.id),
      patch: { stageId, lostReason: outcome === 'Lost' ? reason : null, closeNote: note.trim() || undefined },
      optimistic: deal => ({ ...deal, stageId, status: outcome }),
    });
    toast.success(outcome === 'Won' ? `${deals.length === 1 ? 'Deal' : `${deals.length} deals`} marked won — nice one` : `${deals.length === 1 ? 'Deal' : `${deals.length} deals`} marked lost`);
    onOpenChange(false);
    onDone?.();
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      // A 60-character deal name would otherwise run the serif title to four lines.
      title={<span className="line-clamp-2">{deals.length === 1 ? `Mark “${deals[0]?.name}” ${outcome.toLowerCase()}` : `Mark ${deals.length} deals ${outcome.toLowerCase()}`}</span>}
      description={outcome === 'Won' ? `${ws.money(total)} closing. The company becomes a customer.` : 'Why it went away — this is what pipeline reviews read.'}
      submitLabel={outcome === 'Won' ? 'Mark won' : 'Mark lost'}
      onSubmit={submit}
      pending={update.isPending}
      size="sm"
      destructive={outcome === 'Lost'}
    >
      <div className="flex flex-col gap-4">
        {closingStages.length > 1 && (
          <Field label="Stage">
            <StagePicker pipelineId={pipelineId} value={stageId} onChange={setStageId} trigger={<FieldButton aria-label="Stage">{ws.stageById(stageId)?.name ?? 'Choose'}</FieldButton>} />
          </Field>
        )}
        {outcome === 'Lost' && (
          <Field label="Reason" required={requireReason} error={error && !reason ? error : undefined}>
            <ChoicePicker list="Lost Reason" value={reason} onChange={setReason} trigger={<FieldButton aria-label="Lost reason" placeholder={!reason} invalid={Boolean(error && !reason)}>{reason ?? 'Choose a reason'}</FieldButton>} />
          </Field>
        )}
        <Field label="Note" hint={outcome === 'Won' ? 'What got it over the line?' : 'Anything worth knowing if they come back.'}>
          <Textarea value={note} onChange={e => setNote(e.target.value)} minRows={3} />
        </Field>
        {error && (reason || outcome === 'Won') ? <p className="text-meta text-danger">{error}</p> : null}
      </div>
    </FormDialog>
  );
}
