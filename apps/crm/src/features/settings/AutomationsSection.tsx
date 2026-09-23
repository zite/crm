import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle, Lightning, Plus, Prohibit, WarningCircle } from '@phosphor-icons/react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Link } from 'react-router-dom';
import { deleteAutomation, listAutomationRuns, listAutomations, runAutomationNow, saveAutomation, type ListAutomationsOutputType } from 'zitejs/api';
import { Badge } from '../../ui/Chip';
import { Button } from '../../ui/Button';
import { Switch } from '../../ui/Form';
import { EmptyState, Skeleton } from '../../ui/Layout';
import { MenuItem, MenuSeparator } from '../../ui/Menu';
import { cn } from '../../ui/cn';
import { errorMessage } from '../../lib/errors';
import { invalidate as invalidateRoots } from '../../lib/queries';
import { timeAgo } from '../../lib/format';
import { useAppActions } from '../../lib/app-actions';
import { useWorkspace } from '../../lib/workspace';
import { entityPathFor } from './automationPaths';
import { AutomationDialog } from './AutomationDialog';
import { automationSentence, type Names } from './automationText';
import { Explainer, Group, RowMenu, SectionHead } from './kit';

export type AutomationRow = ListAutomationsOutputType['automations'][number];

/**
 * Automations: a page of sentences.
 *
 * A rule people can't read is a rule people switch off, so the list is the
 * sentence, not a grid of ids. "Run on the last match" runs the rule for real
 * against the most recent record it fits — the only test worth having.
 */
export function AutomationsSection() {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const { confirm } = useAppActions();
  const [dialog, setDialog] = useState<{ rule: AutomationRow | null } | null>(null);

  const query = useQuery({ queryKey: ['automations'], queryFn: () => listAutomations({}) });
  const runs = useQuery({ queryKey: ['automationRuns', 'all'], queryFn: () => listAutomationRuns({ limit: 20 }) });

  const names: Names = useMemo(
    () => ({
      member: id => ws.memberById(id)?.name ?? 'a teammate',
      stage: id => ws.stageById(id)?.name ?? 'that stage',
      pipeline: id => ws.pipelineById(id)?.name ?? 'that pipeline',
      tag: id => ws.tagById(id)?.name ?? 'that tag',
      template: id => query.data?.templates.find(t => t.id === id)?.name ?? 'that template',
      sequence: id => query.data?.sequences.find(s => s.id === id)?.name ?? 'that sequence',
      money: n => ws.money(n),
    }),
    [ws, query.data],
  );

  const refresh = () => {
    invalidateRoots(qc, 'automations', 'automationRuns');
  };

  const save = useMutation({
    mutationFn: (input: Parameters<typeof saveAutomation>[0]) => saveAutomation(input),
    onSuccess: result => {
      refresh();
      toast.success(result.created ? 'Automation created' : 'Automation saved');
      setDialog(null);
    },
    onError: error => toast.error(errorMessage(error, 'Couldn’t save that automation')),
  });

  const toggle = useMutation({
    mutationFn: (rule: AutomationRow) =>
      saveAutomation({
        automationId: rule.id,
        name: rule.name,
        description: rule.description ?? undefined,
        trigger: rule.trigger,
        conditions: rule.conditions as Parameters<typeof saveAutomation>[0]['conditions'],
        actions: rule.actions as Parameters<typeof saveAutomation>[0]['actions'],
        active: !rule.active,
      }),
    onMutate: async rule => {
      await qc.cancelQueries({ queryKey: ['automations'] });
      const previous = qc.getQueryData<ListAutomationsOutputType>(['automations']);
      if (previous) qc.setQueryData<ListAutomationsOutputType>(['automations'], { ...previous, automations: previous.automations.map(a => (a.id === rule.id ? { ...a, active: !a.active } : a)) });
      return { previous };
    },
    onError: (error, _rule, context) => {
      if (context?.previous) qc.setQueryData(['automations'], context.previous);
      toast.error(errorMessage(error, 'Couldn’t change that automation'));
    },
    onSettled: refresh,
  });

  const remove = useMutation({
    mutationFn: (automationId: string) => deleteAutomation({ automationId }),
    onSuccess: result => {
      refresh();
      toast.success(`“${result.name}” deleted`);
    },
    onError: error => toast.error(errorMessage(error, 'Couldn’t delete that automation')),
  });

  const runNow = useMutation({
    mutationFn: (automationId: string) => runAutomationNow({ automationId }),
    onSuccess: result => {
      refresh();
      if (result.status === 'Succeeded') toast.success(result.detail);
      else if (result.status === 'Skipped') toast.message(result.detail);
      else toast.error(result.detail);
    },
    onError: error => toast.error(errorMessage(error, 'Couldn’t run that automation')),
  });

  const onDelete = async (rule: AutomationRow) => {
    const ok = await confirm({
      title: `Delete “${rule.name}”?`,
      description: rule.runCount ? `It has run ${rule.runCount === 1 ? 'once' : `${rule.runCount} times`}; that log goes with it. Switching it off instead keeps both.` : 'Switching it off instead keeps it for later.',
      confirmLabel: 'Delete automation',
      destructive: true,
    });
    if (ok) remove.mutate(rule.id);
  };

  const automations = query.data?.automations ?? [];

  return (
    <div className="flex flex-col gap-8">
      <SectionHead
        title="Automations"
        description="Rules that do the obvious thing so nobody has to remember to. Each one reads as a sentence, and you can try it on a real record before letting it loose."
        actions={
          <Button variant="primary" leading={<Plus size={16} weight="bold" />} onClick={() => setDialog({ rule: null })}>
            New automation
          </Button>
        }
      />

      {query.isPending ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-[92px] rounded-lg" />
          ))}
        </div>
      ) : automations.length === 0 ? (
        <EmptyState
          icon={<Lightning size={22} weight="duotone" />}
          title="No automations yet"
          actions={
            <Button variant="primary" onClick={() => setDialog({ rule: null })}>
              Write the first rule
            </Button>
          }
        >
          Start with the one everybody forgets: when a deal is won, create a task to hand it off.
        </EmptyState>
      ) : (
        <Group>
          <div className="flex flex-col gap-2">
            {automations.map(rule => (
              <AutomationCard
                key={rule.id}
                rule={rule}
                names={names}
                onToggle={() => toggle.mutate(rule)}
                onEdit={() => setDialog({ rule })}
                onDelete={() => void onDelete(rule)}
                onRun={() => runNow.mutate(rule.id)}
                running={runNow.isPending && runNow.variables === rule.id}
              />
            ))}
          </div>
        </Group>
      )}

      <Group title="Run log" note="The last twenty things your rules did, newest first.">
        {runs.isPending ? (
          <Skeleton className="h-40 rounded-lg" />
        ) : (runs.data?.runs.length ?? 0) === 0 ? (
          <div className="rounded-lg border border-dashed border-line px-5 py-8 text-center text-ui text-ink-2">Nothing has run yet. Try a rule on its last matching record to see what it would do.</div>
        ) : (
          <ol className="overflow-hidden rounded-lg border border-line bg-card shadow-hairline">
            {runs.data?.runs.map(run => {
              const path = entityPathFor(run.entityType, run.entityId);
              return (
                <li key={run.id} className="flex items-start gap-3 border-b border-line px-4 py-3 last:border-b-0">
                  <span className="mt-0.5 shrink-0">
                    {run.status === 'Succeeded' ? (
                      <CheckCircle size={17} weight="fill" className="text-success" />
                    ) : run.status === 'Failed' ? (
                      <WarningCircle size={17} weight="fill" className="text-danger" />
                    ) : (
                      <Prohibit size={17} className="text-ink-3" />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className="text-ui font-medium text-ink">{run.automationName ?? 'A deleted automation'}</span>
                      <span className="text-meta text-ink-3">{run.ranAt ? timeAgo(run.ranAt) : ''}</span>
                    </div>
                    <p className="mt-0.5 text-meta text-ink-2 text-pretty">{run.detail}</p>
                    {path && run.recordName && (
                      <Link to={path} className="mt-0.5 inline-block text-meta text-accent hover:underline">
                        {run.recordName}
                      </Link>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </Group>

      <Explainer summary="How a rule decides, and why it can’t chase its own tail">
        <p>A rule runs the moment its trigger happens, after the change that caused it has been saved. Conditions are checked against the record itself; every one has to be true.</p>
        <p>
          A rule that is already running can’t start itself again, so a rule whose action fires its own trigger stops after one pass. Every task a rule creates is stamped with the rule and the record, so running the same
          rule twice on the same deal leaves one task, not two.
        </p>
        <p>Imports never fire automations. Loading last year’s conference list should not send three hundred emails.</p>
      </Explainer>

      {dialog && (
        <AutomationDialog
          rule={dialog.rule}
          templates={query.data?.templates ?? []}
          sequences={query.data?.sequences ?? []}
          onClose={() => setDialog(null)}
          onSave={input => save.mutate(input)}
          pending={save.isPending}
        />
      )}
    </div>
  );
}

function AutomationCard({
  rule,
  names,
  onToggle,
  onEdit,
  onDelete,
  onRun,
  running,
}: {
  rule: AutomationRow;
  names: Names;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onRun: () => void;
  running: boolean;
}) {
  const sentence = automationSentence(rule, names);
  return (
    <article className={cn('rounded-lg border bg-card px-4 py-3.5 shadow-hairline transition-opacity', rule.active ? 'border-line' : 'border-line opacity-70')}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h3 className="truncate text-ui font-semibold text-ink">{rule.name}</h3>
            {!rule.active && <Badge tone="neutral">Off</Badge>}
          </div>
          <p className="mt-1 text-body text-ink-2 text-pretty">
            <span className="font-medium text-ink">{sentence.when}</span>
            {sentence.conditions.length > 0 && <span> and {sentence.conditions.join(' and ')}</span>}
            <span>, </span>
            {sentence.actions.map((action, i) => (
              <span key={i}>
                {i > 0 && (i === sentence.actions.length - 1 ? ' and ' : ', ')}
                <span className="text-ink">{action}</span>
              </span>
            ))}
            .
          </p>
          <p className="mt-1.5 text-meta text-ink-3">
            {rule.runCount ? `Run ${rule.runCount === 1 ? 'once' : `${rule.runCount} times`}` : 'Never run'}
            {rule.lastRunAt ? ` · last ${timeAgo(rule.lastRunAt)}` : ''}
            {rule.description ? ` · ${rule.description}` : ''}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Switch checked={rule.active} onCheckedChange={onToggle} id={`auto-${rule.id}`} />
          <RowMenu label={`Actions for ${rule.name}`}>
            <MenuItem onSelect={onEdit}>Edit automation</MenuItem>
            <MenuItem onSelect={onRun} disabled={running}>
              Run on the last match
            </MenuItem>
            <MenuSeparator />
            <MenuItem destructive onSelect={onDelete}>
              Delete automation
            </MenuItem>
          </RowMenu>
        </div>
      </div>
    </article>
  );
}
