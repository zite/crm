import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { seedWorkspace } from 'zitejs/api';
import { Button } from '../../ui/Button';
import { useAppActions } from '../../lib/app-actions';
import { errorMessage } from '../../lib/errors';
import { invalidateWorkspace, useWorkspaceQuery } from '../../lib/workspace';

/**
 * Loading the sample: the load runs in phases, and each call says which one to
 * carry on from. Hold this in the page, not in the control, so a refetch that
 * flips the workspace to "loaded" after the first phase can't unmount a load
 * that is still running.
 */
export function useLoadSample() {
  const actions = useAppActions();
  const qc = useQueryClient();
  const [step, setStep] = useState<string | null>(null);

  // The workspace is only refetched when something invalidates it, so the
  // first company added a moment ago may not have reached it yet. Check again
  // whenever a page offering the load opens, and hold the offer back until the
  // answer is in (`checking`).
  const workspace = useWorkspaceQuery();
  useEffect(() => {
    void invalidateWorkspace(qc);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const load = useMutation({
    mutationFn: async () => {
      let resume: { seededAt: string; phase: string } | undefined;
      for (let pass = 0; pass < 20; pass++) {
        const result = await seedWorkspace(resume ? { resume } : {});
        if (result.done || !result.phase) return;
        resume = { seededAt: result.seededAt, phase: result.phase };
        setStep(result.label);
      }
      throw new Error('Loading the sample data didn’t finish. Reload the page to see where it got to.');
    },
    onSuccess: async () => {
      setStep(null);
      // Every list, count and report changes, so nothing cached is worth keeping.
      await qc.invalidateQueries();
      toast.success('Sample data loaded');
    },
    onError: error => {
      setStep(null);
      // A load that stopped partway still left rows behind; Settings → Sample data shows how to remove them.
      void qc.invalidateQueries();
      toast.error(errorMessage(error, 'The sample data couldn’t be loaded. Reload the page and try again.'));
    },
  });

  const start = async () => {
    const ok = await actions.confirm({
      title: 'Load the sample data?',
      description:
        'This adds Ashgrove Software, a made-up company, with seven sample teammates, 36 companies, about 60 contacts, about 70 deals and 34 leads, plus quotes, sequences and six months of activity. You can remove all of it later from Settings → Sample data.',
      confirmLabel: 'Load sample data',
    });
    if (ok) load.mutate();
  };

  return { load, step, start, checking: workspace.isFetching };
}

/**
 * The quiet way in: a heading, a sentence and a small button at the bottom of
 * the page, shown only while the workspace is still empty.
 */
export function LoadSample({ load, step, start }: Pick<ReturnType<typeof useLoadSample>, 'load' | 'step' | 'start'>) {
  return (
    <section className="flex flex-col gap-1.5">
      <h2 className="text-ui font-medium text-ink">Sample data</h2>
      <p className="max-w-2xl text-meta text-ink-2 text-pretty">Adds Ashgrove Software, a made-up company with deals, contacts, leads and six months of activity, for trying the CRM while this workspace is still empty.</p>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <Button variant="secondary" size="sm" onClick={start} loading={load.isPending}>
          Load sample data
        </Button>
        {load.isPending && <span className="text-meta text-ink-3">{step ? `Loading ${step}…` : 'Loading…'}</span>}
      </div>
    </section>
  );
}
