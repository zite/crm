import { closestCenter, DndContext, DragOverlay, PointerSensor, pointerWithin, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CaretDown, DotsSixVertical, Plus, Prohibit, Trophy } from '@phosphor-icons/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { deleteStage, getPipelineDetail, reorderStages, savePipeline, saveStage, type GetPipelineDetailOutputType } from 'zitejs/api';
import { Badge } from '../../ui/Chip';
import { Button } from '../../ui/Button';
import { FormDialog } from '../../ui/Dialog';
import { Field, Input, Select, Textarea } from '../../ui/Form';
import { Skeleton } from '../../ui/Layout';
import { MenuItem, MenuSeparator } from '../../ui/Menu';
import { cn } from '../../ui/cn';
import { STAGE_KINDS, type StageKind } from '@project/shared/constants';
import { errorMessage } from '../../lib/errors';
import { invalidate as invalidateRoots } from '../../lib/queries';
import { plural } from '../../lib/format';
import { useInvalidateWorkspace, useWorkspace, type Pipeline } from '../../lib/workspace';
import { Explainer, Group, RowMenu, SectionHead } from './kit';

type StageDetail = GetPipelineDetailOutputType['stages'][number];

/**
 * Pipelines and their stages.
 *
 * Dragging a stage *is* the reorder — same rules as the deal board: a
 * pointer-based collision test, and a drag overlay that renders a
 * presentational copy rather than a second draggable. The list is optimistic,
 * because a reorder that waits for a round trip feels broken.
 */
export function PipelinesSection() {
  const ws = useWorkspace();
  const invalidateWorkspace = useInvalidateWorkspace();
  const qc = useQueryClient();
  const live = ws.pipelines.filter(p => !p.archived);
  const archived = ws.pipelines.filter(p => p.archived);
  const [openId, setOpenId] = useState<string | null>(live[0]?.id ?? null);
  const [pipelineDialog, setPipelineDialog] = useState<{ pipeline: Pipeline | null } | null>(null);

  useEffect(() => {
    if (openId && ws.pipelines.some(p => p.id === openId)) return;
    setOpenId(ws.pipelines.find(p => !p.archived)?.id ?? null);
  }, [ws.pipelines, openId]);

  const afterWrite = () => {
    void invalidateWorkspace();
    invalidateRoots(qc, 'pipelineDetail', 'deals', 'deal', 'reports', 'home');
  };

  const save = useMutation({
    mutationFn: (input: Parameters<typeof savePipeline>[0]) => savePipeline(input),
    onSuccess: result => {
      afterWrite();
      toast.success(result.created ? 'Pipeline created, with its first stages' : 'Pipeline saved');
      if (result.created) setOpenId(result.pipelineId);
      setPipelineDialog(null);
    },
    onError: error => toast.error(errorMessage(error, 'Couldn’t save that pipeline')),
  });

  return (
    <div className="flex flex-col gap-8">
      <SectionHead
        title="Pipelines"
        description="The stages a deal moves through. Each stage carries a probability, a note for whoever picks the deal up, and a limit on how long it may sit there before it counts as stalled."
        actions={
          <Button variant="primary" leading={<Plus size={16} weight="bold" />} onClick={() => setPipelineDialog({ pipeline: null })}>
            New pipeline
          </Button>
        }
      />

      <div className="flex flex-col gap-3">
        {live.map(pipeline => (
          <PipelineCard
            key={pipeline.id}
            pipeline={pipeline}
            open={openId === pipeline.id}
            onToggle={() => setOpenId(id => (id === pipeline.id ? null : pipeline.id))}
            onEdit={() => setPipelineDialog({ pipeline })}
            onMakeDefault={() => save.mutate({ pipelineId: pipeline.id, name: pipeline.name, isDefault: true })}
            onArchive={() => save.mutate({ pipelineId: pipeline.id, name: pipeline.name, archived: true })}
            onChanged={afterWrite}
          />
        ))}
      </div>

      {archived.length > 0 && (
        <Group title="Archived" note="Their deals still exist and still report; no new deal can be created in them.">
          <div className="overflow-hidden rounded-lg border border-line bg-card shadow-hairline">
            {archived.map(pipeline => (
              <div key={pipeline.id} className="flex min-h-[54px] items-center gap-3 border-b border-line px-4 last:border-b-0">
                <span className="min-w-0 flex-1 truncate text-ui text-ink-2">{pipeline.name}</span>
                <Button variant="secondary" size="sm" onClick={() => save.mutate({ pipelineId: pipeline.id, name: pipeline.name, archived: false })}>
                  Restore
                </Button>
              </div>
            ))}
          </div>
        </Group>
      )}

      <Explainer summary="How probability, rotting days and guidance are used">
        <p>
          <strong className="font-medium text-ink">Probability</strong> weights the forecast: a $60,000 deal in a 40% stage counts as $24,000 of weighted pipeline. It is also what the stage meter fills to.
        </p>
        <p>
          <strong className="font-medium text-ink">Rotting days</strong> is how long a deal may sit in a stage before it is badged “Stalled”. It counts from the day the deal entered the stage, not from when it was created,
          and only open stages have one.
        </p>
        <p>
          <strong className="font-medium text-ink">Guidance</strong> is the sentence that says what has to be true before a deal moves on. It shows on the deal page under the stage track.
        </p>
      </Explainer>

      {pipelineDialog && <PipelineDialog pipeline={pipelineDialog.pipeline} onClose={() => setPipelineDialog(null)} onSave={input => save.mutate(input)} pending={save.isPending} />}
    </div>
  );
}

function PipelineCard({
  pipeline,
  open,
  onToggle,
  onEdit,
  onMakeDefault,
  onArchive,
  onChanged,
}: {
  pipeline: Pipeline;
  open: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onMakeDefault: () => void;
  onArchive: () => void;
  onChanged: () => void;
}) {
  const ws = useWorkspace();
  const openStages = ws.openStagesFor(pipeline.id).length;
  return (
    <section className="overflow-hidden rounded-lg border border-line bg-card shadow-hairline">
      <header className="flex items-center gap-3 px-4 py-3">
        <button type="button" onClick={onToggle} aria-expanded={open} className="flex min-w-0 flex-1 items-center gap-2 text-left">
          <CaretDown size={14} className={cn('shrink-0 text-ink-3 transition-transform', open && 'rotate-180')} />
          <span className="truncate text-title font-semibold text-ink">{pipeline.name}</span>
          {pipeline.isDefault && <Badge tone="accent">Default</Badge>}
          <span className="shrink-0 text-meta text-ink-3">{plural(openStages, 'open stage')}</span>
        </button>
        <RowMenu label={`Actions for ${pipeline.name}`}>
          <MenuItem onSelect={onEdit}>Rename pipeline</MenuItem>
          {!pipeline.isDefault && <MenuItem onSelect={onMakeDefault}>Make it the default</MenuItem>}
          <MenuSeparator />
          <MenuItem destructive disabled={pipeline.isDefault} onSelect={onArchive}>
            Archive pipeline
          </MenuItem>
        </RowMenu>
      </header>
      {open && <StageEditor pipeline={pipeline} onChanged={onChanged} />}
    </section>
  );
}

function StageEditor({ pipeline, onChanged }: { pipeline: Pipeline; onChanged: () => void }) {
  const query = useQuery({
    queryKey: ['pipelineDetail', pipeline.id],
    queryFn: () => getPipelineDetail({ pipelineId: pipeline.id }),
  });
  const stages = useMemo(() => (query.data?.stages ?? []).filter(s => !s.archived), [query.data]);

  const [order, setOrder] = useState<string[]>([]);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ stage: StageDetail | null } | null>(null);
  const [moveFrom, setMoveFrom] = useState<StageDetail | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  useEffect(() => setOrder(stages.map(s => s.id)), [stages]);

  const byId = useMemo(() => new Map(stages.map(s => [s.id, s])), [stages]);
  const openIds = order.filter(id => byId.get(id)?.kind === 'Open');
  const closedIds = order.filter(id => byId.get(id) && byId.get(id)!.kind !== 'Open');

  const reorder = useMutation({
    mutationFn: (stageIds: string[]) => reorderStages({ pipelineId: pipeline.id, stageIds }),
    onError: (error: unknown) => {
      setOrder(stages.map(s => s.id));
      toast.error(errorMessage(error, 'Couldn’t save that order'));
    },
    onSettled: onChanged,
  });

  const save = useMutation({
    mutationFn: (input: Parameters<typeof saveStage>[0]) => saveStage(input),
    onSuccess: result => {
      onChanged();
      toast.success(result.created ? 'Stage added' : 'Stage saved');
      setDialog(null);
    },
    onError: error => toast.error(errorMessage(error, 'Couldn’t save that stage')),
  });

  const remove = useMutation({
    mutationFn: (input: { stageId: string; moveToStageId?: string }) => deleteStage(input),
    onSuccess: result => {
      onChanged();
      toast.success(result.moved ? `${result.stageName} deleted, ${plural(result.moved, 'deal')} moved` : 'Stage deleted');
      setMoveFrom(null);
    },
    onError: (error: unknown, vars) => {
      const message = errorMessage(error, 'Couldn’t delete that stage');
      // The server refuses a stage that still holds deals and says how many — offer the move.
      if (!vars.moveToStageId && /deal/i.test(message)) {
        setMoveFrom(byId.get(vars.stageId) ?? null);
        toast.message(message);
      } else toast.error(message);
    },
  });

  const onDragEnd = (event: DragEndEvent) => {
    setDragging(null);
    const activeId = String(event.active.id);
    const overId = event.over ? String(event.over.id) : null;
    if (!overId || activeId === overId) return;
    const from = openIds.indexOf(activeId);
    const to = openIds.indexOf(overId);
    if (from < 0 || to < 0) return;
    const next = [...openIds];
    next.splice(to, 0, ...next.splice(from, 1));
    const full = [...next, ...closedIds];
    setOrder(full);
    reorder.mutate(full);
  };

  if (query.isPending) {
    return (
      <div className="flex flex-col gap-1.5 border-t border-line bg-sunken/40 px-3 py-3 sm:px-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-[52px] rounded-md" />
        ))}
      </div>
    );
  }

  return (
    <div className="border-t border-line bg-sunken/40 px-3 py-3 sm:px-4">
      <DndContext
        sensors={sensors}
        collisionDetection={args => {
          const hits = pointerWithin(args);
          return hits.length ? hits : closestCenter(args);
        }}
        onDragStart={(event: DragStartEvent) => setDragging(String(event.active.id))}
        onDragEnd={onDragEnd}
        onDragCancel={() => setDragging(null)}
      >
        <SortableContext items={openIds} strategy={verticalListSortingStrategy}>
          <ul className="flex flex-col gap-1.5">
            {openIds.map((id, index) => {
              const stage = byId.get(id);
              if (!stage) return null;
              return <SortableStageRow key={id} stage={stage} index={index} dragging={dragging === id} onEdit={() => setDialog({ stage })} onDelete={() => remove.mutate({ stageId: id })} />;
            })}
          </ul>
        </SortableContext>
        <DragOverlay dropAnimation={null}>{dragging && byId.get(dragging) ? <StageFace stage={byId.get(dragging)!} className="rotate-[0.4deg] shadow-drag" /> : null}</DragOverlay>
      </DndContext>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" leading={<Plus size={15} weight="bold" />} onClick={() => setDialog({ stage: null })}>
          Add stage
        </Button>
        {reorder.isPending && <span className="text-meta text-ink-3">Saving order…</span>}
      </div>

      <ul className="mt-3 flex flex-col gap-1.5 border-t border-line pt-3">
        {closedIds.map(id => {
          const stage = byId.get(id);
          if (!stage) return null;
          return (
            <li key={id}>
              <StageFace stage={stage} onEdit={() => setDialog({ stage })} closed />
            </li>
          );
        })}
      </ul>

      {dialog && <StageDialog pipeline={pipeline} stage={dialog.stage} onClose={() => setDialog(null)} onSave={input => save.mutate(input)} pending={save.isPending} />}
      {moveFrom && (
        <MoveDealsDialog
          stage={moveFrom}
          options={stages.filter(s => s.id !== moveFrom.id)}
          onClose={() => setMoveFrom(null)}
          onConfirm={moveToStageId => remove.mutate({ stageId: moveFrom.id, moveToStageId })}
          pending={remove.isPending}
        />
      )}
    </div>
  );
}

function SortableStageRow({ stage, index, dragging, onEdit, onDelete }: { stage: StageDetail; index: number; dragging: boolean; onEdit: () => void; onDelete: () => void }) {
  // No transform: the overlay is what moves. Transforming the row under it doubles the motion.
  const { attributes, listeners, setNodeRef, isDragging } = useSortable({ id: stage.id });
  return (
    <li ref={setNodeRef} className={cn(isDragging || dragging ? 'opacity-40' : '')} style={{ touchAction: 'none' }}>
      <StageFace stage={stage} index={index} handleProps={{ ...attributes, ...listeners }} onEdit={onEdit} onDelete={onDelete} />
    </li>
  );
}

/** Presentational only — the drag overlay renders this, so it never registers a second draggable. */
function StageFace({
  stage,
  index,
  handleProps,
  onEdit,
  onDelete,
  closed,
  className,
}: {
  stage: StageDetail;
  index?: number;
  handleProps?: Record<string, unknown>;
  onEdit?: () => void;
  onDelete?: () => void;
  closed?: boolean;
  className?: string;
}) {
  return (
    <div className={cn('flex min-h-[52px] items-center gap-2 rounded-md border border-line bg-card px-2 py-2 sm:gap-3 sm:px-3', className)}>
      {handleProps ? (
        <button type="button" {...handleProps} aria-label={`Reorder ${stage.name}`} className="shrink-0 cursor-grab rounded-sm p-1 text-ink-3 hover:bg-hover hover:text-ink active:cursor-grabbing">
          <DotsSixVertical size={16} weight="bold" />
        </button>
      ) : (
        <span className="flex h-6 w-6 shrink-0 items-center justify-center" aria-hidden>
          {stage.kind === 'Won' ? <Trophy size={15} weight="duotone" className="text-success" /> : <Prohibit size={15} weight="duotone" className="text-danger" />}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          {index != null && <span className="tabular shrink-0 text-meta text-ink-3">{index + 1}</span>}
          <span className="truncate text-ui font-medium text-ink">{stage.name}</span>
          {closed && <Badge tone={stage.kind === 'Won' ? 'success' : 'danger'}>{stage.kind}</Badge>}
        </div>
        <div className="truncate text-meta text-ink-3">
          {stage.kind === 'Open' ? `${stage.probability}% · ${stage.rottingDays ? `stalls after ${stage.rottingDays}d` : 'never stalls'} · ` : ''}
          {stage.openDealCount ? plural(stage.openDealCount, 'open deal') : stage.dealCount ? `${plural(stage.dealCount, 'deal')}, all closed` : 'no deals'}
          {stage.guidance ? ` · ${stage.guidance}` : ''}
        </div>
      </div>
      {onEdit && (
        <RowMenu label={`Actions for ${stage.name}`}>
          <MenuItem onSelect={onEdit}>Edit stage</MenuItem>
          {onDelete && (
            <>
              <MenuSeparator />
              <MenuItem destructive onSelect={onDelete}>
                Delete stage
              </MenuItem>
            </>
          )}
        </RowMenu>
      )}
    </div>
  );
}

function PipelineDialog({ pipeline, onClose, onSave, pending }: { pipeline: Pipeline | null; onClose: () => void; onSave: (input: Parameters<typeof savePipeline>[0]) => void; pending: boolean }) {
  const [name, setName] = useState(pipeline?.name ?? '');
  const [description, setDescription] = useState('');
  return (
    <FormDialog
      open
      onOpenChange={o => !o && onClose()}
      title={pipeline ? `Rename ${pipeline.name}` : 'New pipeline'}
      description={pipeline ? undefined : 'It starts with one open stage plus Won and Lost, so you can put a deal in it right away.'}
      submitLabel={pipeline ? 'Save' : 'Create pipeline'}
      onSubmit={() => onSave({ ...(pipeline ? { pipelineId: pipeline.id } : {}), name: name.trim(), description: description.trim() || undefined })}
      pending={pending}
      disabled={!name.trim()}
    >
      <div className="flex flex-col gap-4">
        <Field label="Name" required htmlFor="pipeline-name">
          <Input id="pipeline-name" autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="Renewals" maxLength={80} />
        </Field>
        {!pipeline && (
          <Field label="What it is for" htmlFor="pipeline-desc">
            <Textarea id="pipeline-desc" value={description} onChange={e => setDescription(e.target.value)} minRows={2} maxLength={400} placeholder="Existing customers coming up for renewal." />
          </Field>
        )}
      </div>
    </FormDialog>
  );
}

function StageDialog({ pipeline, stage, onClose, onSave, pending }: { pipeline: Pipeline; stage: StageDetail | null; onClose: () => void; onSave: (input: Parameters<typeof saveStage>[0]) => void; pending: boolean }) {
  const [name, setName] = useState(stage?.name ?? '');
  const [kind, setKind] = useState<StageKind>((stage?.kind as StageKind) ?? 'Open');
  const [probability, setProbability] = useState(String(stage?.probability ?? 50));
  const [rottingDays, setRottingDays] = useState(stage?.rottingDays == null ? '' : String(stage.rottingDays));
  const [guidance, setGuidance] = useState(stage?.guidance ?? '');
  const prob = Number(probability);
  const rot = rottingDays.trim() === '' ? null : Number(rottingDays);
  const valid = Boolean(name.trim()) && Number.isFinite(prob) && prob >= 0 && prob <= 100 && (rot === null || (Number.isFinite(rot) && rot >= 1 && rot <= 365));

  return (
    <FormDialog
      open
      onOpenChange={o => !o && onClose()}
      title={stage ? `Edit ${stage.name}` : `Add a stage to ${pipeline.name}`}
      submitLabel={stage ? 'Save stage' : 'Add stage'}
      onSubmit={() =>
        onSave({
          ...(stage ? { stageId: stage.id } : {}),
          pipelineId: pipeline.id,
          name: name.trim(),
          kind,
          probability: Math.round(prob),
          rottingDays: rot,
          guidance: guidance.trim(),
        })
      }
      pending={pending}
      disabled={!valid}
    >
      <div className="flex flex-col gap-4">
        <Field label="Name" required htmlFor="stage-name">
          <Input id="stage-name" autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="Security review" maxLength={60} />
        </Field>
        <Field label="Kind" hint="Won and Lost close the deal. A pipeline has exactly one of each, so they can’t be added twice." htmlFor="stage-kind">
          <Select id="stage-kind" value={kind} onChange={e => setKind(e.target.value as StageKind)} disabled={Boolean(stage)}>
            {STAGE_KINDS.map(k => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </Select>
        </Field>
        {kind === 'Open' && (
          <>
            <Field label="Probability" hint="Weights the forecast and fills the stage meter." htmlFor="stage-prob">
              <div className="flex items-center gap-2">
                <Input id="stage-prob" type="number" min={0} max={100} value={probability} onChange={e => setProbability(e.target.value)} className="w-24" />
                <span className="text-ui text-ink-2">%</span>
              </div>
            </Field>
            <Field label="Stalls after" hint="Leave it empty and a deal in this stage is never badged as stalled." htmlFor="stage-rot">
              <div className="flex items-center gap-2">
                <Input id="stage-rot" type="number" min={1} max={365} value={rottingDays} onChange={e => setRottingDays(e.target.value)} placeholder="14" className="w-24" />
                <span className="text-ui text-ink-2">days in this stage</span>
              </div>
            </Field>
            <Field label="Guidance" hint="What has to be true before a deal moves on. Shown on the deal page." htmlFor="stage-guide">
              <Textarea id="stage-guide" value={guidance} onChange={e => setGuidance(e.target.value)} minRows={2} maxLength={600} placeholder="Who signs, and what do they need to see first?" />
            </Field>
          </>
        )}
      </div>
    </FormDialog>
  );
}

function MoveDealsDialog({ stage, options, onClose, onConfirm, pending }: { stage: StageDetail; options: StageDetail[]; onClose: () => void; onConfirm: (stageId: string) => void; pending: boolean }) {
  const [target, setTarget] = useState(options.find(s => s.kind === 'Open')?.id ?? options[0]?.id ?? '');
  return (
    <FormDialog
      open
      onOpenChange={o => !o && onClose()}
      title={`Move the deals out of ${stage.name}?`}
      description={`${plural(stage.dealCount, 'deal')} still ${stage.dealCount === 1 ? 'sits' : 'sit'} here. Deleting the stage can’t take them with it, so choose where they go — each one moves properly, with its stage history, its events and any automation that watches for the move.`}
      submitLabel="Move and delete"
      destructive
      onSubmit={() => onConfirm(target)}
      pending={pending}
      disabled={!target}
    >
      <Field label="Move them to" htmlFor="move-target">
        <Select id="move-target" autoFocus value={target} onChange={e => setTarget(e.target.value)}>
          {options.map(s => (
            <option key={s.id} value={s.id}>
              {s.name}
              {s.kind !== 'Open' ? ` (${s.kind})` : ''}
            </option>
          ))}
        </Select>
      </Field>
    </FormDialog>
  );
}
