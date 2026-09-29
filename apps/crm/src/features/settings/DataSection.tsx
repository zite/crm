import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Broom, CheckCircle } from '@phosphor-icons/react';
import { useState } from 'react';
import { toast } from 'sonner';
import { clearDemoData } from 'zitejs/api';
import { Button } from '../../ui/Button';
import { FormDialog } from '../../ui/Dialog';
import { Input, Field } from '../../ui/Form';
import { EmptyState, Skeleton } from '../../ui/Layout';
import { ProgressBar } from '../../ui/Progress';
import { errorMessage } from '../../lib/errors';
import { invalidate as invalidateRoots } from '../../lib/queries';
import { dateTime, plural } from '../../lib/format';
import { useInvalidateWorkspace, useWorkspace } from '../../lib/workspace';
import { Explainer, Group, SectionHead } from './kit';
import { LoadSample, useLoadSample } from './SampleLoad';

/**
 * The sample organization: loading it into an empty workspace, and taking it
 * out again.
 *
 * A fresh install starts empty. While it has no companies, contacts, deals or
 * leads, an admin can load a made-up company from the bottom of Settings →
 * General to see the CRM with work in it. This page is in the nav only while
 * the sample is loaded (or while you are on it). Once loaded, it is how a real team
 * gets rid of it without taking their own work with it: the dialog states real
 * counts from a dry run, and the removal runs in batches, children first, so
 * an interrupted run picks up where it stopped.
 */
export function DataSection() {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const invalidateWorkspace = useInvalidateWorkspace();
  const [confirming, setConfirming] = useState(false);
  const [phrase, setPhrase] = useState('');
  const [progress, setProgress] = useState<{ deleted: number; total: number; label: string | null } | null>(null);

  // Held here rather than in the control, so a refetch that flips the page to
  // "loaded" after the first phase can't unmount a load that is still running.
  // It also refetches the workspace on open, so the offer is never stale.
  const sample = useLoadSample();
  const loaded = ws.sample.loaded && !sample.load.isPending;
  const canLoad = (ws.sample.canLoad && !sample.checking) || sample.load.isPending;
  const removed = !loaded && !sample.load.isPending && Boolean(ws.settings.demoRemovedAt);

  const plan = useQuery({
    queryKey: ['demoPlan'],
    queryFn: () => clearDemoData({ dryRun: true }),
    enabled: loaded,
  });

  const run = useMutation({
    mutationFn: async () => {
      let deleted = 0;
      const total = plan.data?.total ?? 0;
      // Batched on purpose: a big workspace would time out in one call, and this way an interrupted run resumes.
      for (let pass = 0; pass < 40; pass++) {
        const result = await clearDemoData({ dryRun: false, confirm: true });
        deleted += result.deleted;
        setProgress({ deleted, total: Math.max(total, deleted + result.remaining), label: result.label });
        if (result.done) return { deleted, failed: result.failed };
      }
      return { deleted, failed: 0 };
    },
    onSuccess: result => {
      setProgress(null);
      setConfirming(false);
      setPhrase('');
      void invalidateWorkspace();
      invalidateRoots(qc, 'demoPlan', 'deals', 'deal', 'companies', 'contacts', 'leads', 'tasks', 'home', 'reports', 'automations', 'automationRuns', 'imports', 'pipelineDetail');
      toast.success(`Sample data removed: ${plural(result.deleted, 'record')} deleted`);
    },
    onError: error => {
      setProgress(null);
      toast.error(errorMessage(error, 'The removal stopped partway. Nothing was lost, so run it again to carry on.'));
    },
  });

  if (!loaded && !removed) {
    return (
      <div className="flex flex-col gap-8">
        <SectionHead
          title="Sample data"
          description={sample.load.isPending ? 'Adding the sample organization. Keep this tab open until it finishes.' : 'Nothing in this workspace came from the sample organization.'}
        />
        {canLoad && <LoadSample {...sample} />}
      </div>
    );
  }

  if (removed) {
    return (
      <div className="flex flex-col gap-8">
        <SectionHead title="Sample data" description="The sample organization is gone. What is here now is yours." />
        <EmptyState icon={<CheckCircle size={22} weight="duotone" />} title="Removed">
          Cleared on {dateTime(ws.settings.demoRemovedAt)}. Your own records, the teammates you invited and anything you changed were all left exactly as they were.
        </EmptyState>
        {canLoad && <LoadSample {...sample} />}
      </div>
    );
  }

  const counts = plan.data?.counts ?? [];
  const total = plan.data?.total ?? 0;
  const demoMembers = counts.find(c => c.table === 'Members')?.count ?? 0;
  // The dialog has room for six lines, so spend them on the biggest losses rather
  // than whatever happens to be first in deletion order.
  const biggest = [...counts].sort((a, b) => b.count - a.count).slice(0, 6);

  return (
    <div className="flex flex-col gap-8">
      <SectionHead
        title="Sample data"
        description="Ashgrove Software is a made-up company with real-looking deals, loaded so you can see the CRM with work in it. Clear it when your own work has started."
      />

      <Group title="What would go" note={plan.data?.seededAt ? `Anything written in the fifteen minutes after the sample data was loaded on ${dateTime(plan.data.seededAt)}, plus anything added under it since.` : undefined}>
        {plan.isPending ? (
          <Skeleton className="h-52 rounded-lg" />
        ) : total === 0 ? (
          <div className="rounded-lg border border-dashed border-line px-5 py-8 text-center text-ui text-ink-2">Nothing left to remove.</div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-line bg-card shadow-hairline">
            <div className="flex items-baseline gap-2 border-b border-line bg-sunken px-4 py-2.5">
              <span className="font-display text-[22px] leading-7 text-ink tabular">{total.toLocaleString('en-US')}</span>
              <span className="text-ui text-ink-2">records in all</span>
            </div>
            <ul className="grid grid-cols-1 sm:grid-cols-2">
              {counts.map(row => (
                <li key={row.table} className="flex items-baseline justify-between gap-3 border-b border-line px-4 py-2 text-ui last:border-b-0 sm:[&:nth-last-child(2)]:border-b-0">
                  <span className="truncate text-ink-2">{row.label}</span>
                  <span className="tabular shrink-0 text-ink">{row.count.toLocaleString('en-US')}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Group>

      <Group title="What stays">
        <ul className="flex flex-col gap-2 text-ui text-ink-2">
          <li className="flex gap-2.5">
            <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-ink-3" />
            <span>
              <span className="font-medium text-ink">You, and anyone you invited.</span> A teammate is only removed if their address is one of the reserved example domains the seed invents.
            </span>
          </li>
          <li className="flex gap-2.5">
            <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-ink-3" />
            <span>
              <span className="font-medium text-ink">Everything that was here before, and the records you added since.</span> A company, contact, deal or lead created after the sample was loaded stays, unless it sits under a sample
              company, where it would have nowhere to live.
            </span>
          </li>
          <li className="flex gap-2.5">
            <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-ink-3" />
            <span>
              <span className="font-medium text-ink">Settings you changed.</span> {plan.data?.keepsSettings ? 'You have changed the organization’s settings since, so its name, address and footer are kept as they are.' : 'The organization’s name, address and footer are cleared where they still read as the sample set them, and kept where you set your own.'}
            </span>
          </li>
          <li className="flex gap-2.5">
            <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-ink-3" />
            <span>
              <span className="font-medium text-ink">A working app.</span> The sample’s pipelines and list values go with it. The starter “Sales” pipeline and the standard lost and disqualify reasons stay, or are put back if they are gone.
            </span>
          </li>
        </ul>
      </Group>

      {progress && (
        <div className="rounded-lg border border-line bg-card px-4 py-3 shadow-hairline">
          <div className="flex items-baseline justify-between gap-3 text-ui">
            <span className="text-ink">Removing {progress.label ?? 'records'}…</span>
            <span className="tabular text-ink-2">
              {progress.deleted.toLocaleString('en-US')} of {progress.total.toLocaleString('en-US')}
            </span>
          </div>
          <ProgressBar value={progress.total ? progress.deleted / progress.total : 0} className="mt-2" />
        </div>
      )}

      <div>
        <Button variant="danger" leading={<Broom size={16} />} onClick={() => setConfirming(true)} disabled={total === 0 || run.isPending} loading={run.isPending}>
          Remove sample data
        </Button>
      </div>

      <Explainer summary="How it knows what is sample data">
        <p>
          The seed backdates business dates (a deal “opened” four months ago) but not the row’s own <code className="font-mono">created_at</code>. Every sample row is written in the minutes after it was loaded, so anything
          created from a minute before that moment to fifteen minutes after it is sample data. Anything older was here first and stays.
        </p>
        <p>
          Anything hanging off a sample record goes too, whatever its own age: a note you logged this morning on a sample deal, a contact added under a sample company. They have nowhere to live once the parent is gone.
        </p>
        <p>Children are deleted before parents, in batches, so a run that is interrupted leaves nothing orphaned and can simply be run again.</p>
      </Explainer>

      <FormDialog
        open={confirming}
        onOpenChange={o => !o && !run.isPending && (setConfirming(false), setPhrase(''))}
        title="Remove the sample data?"
        description={`${plural(total, 'record')} will be deleted${demoMembers ? `, including ${plural(demoMembers, 'sample teammate')}` : ''}. This can’t be undone.`}
        submitLabel="Remove it all"
        destructive
        pending={run.isPending}
        disabled={phrase.trim().toLowerCase() !== 'remove'}
        onSubmit={() => run.mutate()}
      >
        <div className="flex flex-col gap-4">
          <ul className="flex flex-col gap-1 text-ui text-ink-2">
            {biggest.map(row => (
              <li key={row.table} className="flex items-baseline justify-between gap-3">
                <span className="truncate">{row.label}</span>
                <span className="tabular text-ink">{row.count.toLocaleString('en-US')}</span>
              </li>
            ))}
            {counts.length > biggest.length && <li className="text-meta text-ink-3">and {counts.length - biggest.length} more kinds of record</li>}
          </ul>
          <Field label="Type remove to confirm" htmlFor="demo-confirm">
            <Input id="demo-confirm" autoFocus value={phrase} onChange={e => setPhrase(e.target.value)} placeholder="remove" autoComplete="off" />
          </Field>
        </div>
      </FormDialog>
    </div>
  );
}
