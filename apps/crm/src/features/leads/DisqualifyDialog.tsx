import { useEffect, useState } from 'react';
import { FormDialog } from '../../ui/Dialog';
import { Field } from '../../ui/Form';
import { cn } from '../../ui/cn';
import { useWorkspace } from '../../lib/workspace';
import { useLeadActions } from './leadData';

/**
 * Disqualifying always asks why — the reason is what makes the leads report
 * worth reading, so it is required and comes from the organization's own list.
 */
export function DisqualifyDialog({ open, onOpenChange, leadIds, leadName, onDone }: { open: boolean; onOpenChange: (open: boolean) => void; leadIds: string[]; leadName?: string | null; onDone?: () => void }) {
  const ws = useWorkspace();
  const actions = useLeadActions();
  const reasons = ws.choicesFor('Disqualify Reason');
  const [reason, setReason] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setReason(null);
    setError(null);
  }, [open]);

  const submit = async () => {
    if (!reason) {
      setError('Choose a reason');
      return;
    }
    await actions.update.mutateAsync({ ids: leadIds, patch: { status: 'Disqualified', disqualifyReason: reason }, optimistic: lead => ({ ...lead, status: 'Disqualified', disqualifyReason: reason }) });
    onOpenChange(false);
    onDone?.();
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      size="sm"
      title={leadIds.length === 1 ? `Disqualify ${leadName ?? 'this lead'}?` : `Disqualify ${leadIds.length} leads?`}
      description="They stay in the list with their reason, so the leads report can show what isn’t worth chasing."
      submitLabel="Disqualify"
      onSubmit={submit}
      disabled={!reason}
    >
      <Field label="Reason" required error={error ?? undefined}>
        {reasons.length === 0 ? (
          <p className="text-ui text-ink-2">Nobody has set up disqualify reasons yet. An admin can add them in Settings → Lists.</p>
        ) : (
          <div className="flex flex-col gap-1" role="radiogroup" aria-label="Reason">
            {reasons.map((choice, i) => (
              <button
                key={choice.id}
                type="button"
                role="radio"
                aria-checked={reason === choice.label}
                autoFocus={i === 0}
                onClick={() => {
                  setReason(choice.label);
                  setError(null);
                }}
                className={cn(
                  'flex h-9 items-center rounded-md border px-3 text-left text-body transition-colors',
                  reason === choice.label ? 'border-accent bg-accent/[0.07] text-ink dark:bg-accent/10' : 'border-line text-ink-2 hover:border-line-strong hover:text-ink',
                )}
              >
                {choice.label}
              </button>
            ))}
          </div>
        )}
      </Field>
    </FormDialog>
  );
}
