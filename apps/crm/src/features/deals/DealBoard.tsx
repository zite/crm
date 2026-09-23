import { DndContext, DragOverlay, PointerSensor, closestCorners, pointerWithin, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from '@dnd-kit/core';
import { CalendarBlank, DotsThree, Plus, Warning } from '@phosphor-icons/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Avatar, Unassigned } from '../../ui/Avatar';
import { Badge } from '../../ui/Chip';
import { Button } from '../../ui/Button';
import { Tooltip } from '../../ui/Tooltip';
import { cn } from '../../ui/cn';
import { CompanyMark, Money, StalledBadge } from '../../glyphs';
import { useAppActions } from '../../lib/app-actions';
import { dueLabel, dueState, shortDate, todayString } from '../../lib/format';
import { useWorkspace } from '../../lib/workspace';
import { dealStalledDays, totalsFor, type Deal } from './dealHelpers';

/**
 * The pipeline board. Dragging a card *is* the stage change: the move is
 * optimistic, the overlay is a presentational copy (never a second draggable),
 * and edge auto-scroll is keyed off the pointer, not the card — dnd-kit's own
 * auto-scroll runs away once the board starts moving under the cursor.
 */
export function DealBoard({ deals, pipelineId, onMove, onOpen, onPeek, focusId }: { deals: Deal[]; pipelineId: string; onMove: (dealId: string, stageId: string, position: number) => void; onOpen: (deal: Deal) => void; onPeek: (deal: Deal) => void; focusId?: string | null }) {
  const ws = useWorkspace();
  const { openCreate } = useAppActions();
  const canEdit = ws.can('records.edit');
  const [dragging, setDragging] = useState<Deal | null>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const pointerX = useRef<number | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const stages = useMemo(() => ws.stagesFor(pipelineId).filter(s => !s.archived), [ws, pipelineId]);
  const byStage = useMemo(() => {
    const map = new Map<string, Deal[]>();
    for (const stage of stages) map.set(stage.id, []);
    for (const deal of deals) {
      if (!map.has(deal.stageId)) map.set(deal.stageId, []);
      map.get(deal.stageId)!.push(deal);
    }
    for (const list of map.values()) list.sort((a, b) => a.position - b.position || Date.parse(b.openedAt ?? '') - Date.parse(a.openedAt ?? ''));
    return map;
  }, [deals, stages]);

  // Edge auto-scroll driven by the pointer's distance from the container edge.
  useEffect(() => {
    if (!dragging) return;
    const move = (e: PointerEvent) => (pointerX.current = e.clientX);
    window.addEventListener('pointermove', move);
    const timer = window.setInterval(() => {
      const el = scrollerRef.current;
      const x = pointerX.current;
      if (!el || x == null) return;
      const rect = el.getBoundingClientRect();
      const edge = 90;
      if (x < rect.left + edge) el.scrollLeft -= Math.max(6, (rect.left + edge - x) / 4);
      else if (x > rect.right - edge) el.scrollLeft += Math.max(6, (x - (rect.right - edge)) / 4);
    }, 16);
    return () => {
      window.removeEventListener('pointermove', move);
      window.clearInterval(timer);
    };
  }, [dragging]);

  const onDragStart = (event: DragStartEvent) => {
    const deal = deals.find(d => d.id === event.active.id);
    setDragging(deal ?? null);
  };

  const onDragEnd = (event: DragEndEvent) => {
    setDragging(null);
    const dealId = String(event.active.id);
    const overId = event.over ? String(event.over.id) : null;
    if (!overId) return;
    const deal = deals.find(d => d.id === dealId);
    const stageId = overId.startsWith('stage:') ? overId.slice(6) : null;
    if (!deal || !stageId || deal.stageId === stageId) return;
    const target = byStage.get(stageId) ?? [];
    const position = target.length ? Math.min(...target.map(d => d.position)) - 1000 : 1000;
    onMove(dealId, stageId, position);
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={args => {
        const hits = pointerWithin(args);
        return hits.length ? hits : closestCorners(args);
      }}
      autoScroll={false}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => setDragging(null)}
    >
      <div ref={scrollerRef} className="flex h-full gap-3 overflow-x-auto px-5 pb-6 pt-4 sm:px-8">
        {stages.map(stage => {
          const rows = byStage.get(stage.id) ?? [];
          const totals = totalsFor(rows);
          return (
            <StageLane
              key={stage.id}
              stage={stage}
              count={totals.count}
              amount={totals.amount}
              onAdd={canEdit ? () => openCreate('deal', { pipelineId, stageId: stage.id }) : undefined}
            >
              {rows.map(deal => (
                <DealCard key={deal.id} deal={deal} onOpen={onOpen} onPeek={onPeek} focused={focusId === deal.id} dragging={dragging?.id === deal.id} canDrag={canEdit} />
              ))}
              {rows.length === 0 && <p className="rounded-md border border-dashed border-line px-3 py-6 text-center text-meta text-ink-3">Nothing here yet</p>}
            </StageLane>
          );
        })}
      </div>
      <DragOverlay dropAnimation={null}>{dragging ? <CardFace deal={dragging} className="w-[268px] rotate-1 shadow-drag" /> : null}</DragOverlay>
    </DndContext>
  );
}

function StageLane({ stage, count, amount, onAdd, children }: { stage: { id: string; name: string; kind: string; probability: number }; count: number; amount: number; onAdd?: () => void; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: `stage:${stage.id}` });
  return (
    <section ref={setNodeRef} className={cn('flex w-[284px] shrink-0 flex-col rounded-lg border bg-sunken/60 transition-colors', isOver ? 'border-accent bg-accent/[0.06]' : 'border-line')}>
      <header className="flex items-center gap-2 px-3 py-2.5">
        <h3 className="truncate text-ui font-semibold text-ink">{stage.name}</h3>
        <span className="tabular text-meta text-ink-3">{count}</span>
        <span className="ml-auto tabular text-meta text-ink-2">
          <Money value={amount} compact />
        </span>
        {/* A viewer can read every lane but is never offered a way to add to one. */}
        {onAdd && (
          <Tooltip content={`New deal in ${stage.name}`}>
            <Button variant="ghost" size="xs" icon aria-label={`New deal in ${stage.name}`} onClick={onAdd}>
              <Plus size={14} weight="bold" />
            </Button>
          </Tooltip>
        )}
      </header>
      <div className="flex min-h-[80px] flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">{children}</div>
    </section>
  );
}

function DealCard({ deal, onOpen, onPeek, focused, dragging, canDrag }: { deal: Deal; onOpen: (deal: Deal) => void; onPeek: (deal: Deal) => void; focused: boolean; dragging: boolean; canDrag: boolean }) {
  const { attributes, listeners, setNodeRef } = useDraggable({ id: deal.id, disabled: !canDrag });
  return (
    <div ref={setNodeRef} {...attributes} {...listeners} style={{ touchAction: 'none' }} className={cn(dragging && 'opacity-40')} data-row-id={deal.id}>
      <CardFace
        deal={deal}
        draggable={canDrag}
        focused={focused}
        onClick={() => onPeek(deal)}
        onDoubleClick={() => onOpen(deal)}
      />
    </div>
  );
}

/** Presentational only — the drag overlay renders this, so it never registers a second draggable. */
function CardFace({ deal, className, focused, draggable = true, onClick, onDoubleClick }: { deal: Deal; className?: string; focused?: boolean; draggable?: boolean; onClick?: () => void; onDoubleClick?: () => void }) {
  const ws = useWorkspace();
  const owner = ws.memberById(deal.ownerId);
  const stalled = dealStalledDays(deal, ws);
  const due = deal.nextStep?.dueDate ? dueState(deal.nextStep.dueDate) : 'none';
  return (
    <article
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      className={cn(
        'rounded-lg border bg-card p-3 text-left shadow-hairline transition-shadow',
        draggable ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer',
        focused ? 'border-accent ring-1 ring-accent/30' : 'border-line hover:shadow-raised',
        className,
      )}
    >
      <div className="flex items-start gap-2">
        <CompanyMark name={deal.companyName ?? deal.name} id={deal.companyId ?? deal.id} size="sm" />
        <div className="min-w-0 flex-1">
          <h4 className="truncate text-ui font-medium text-ink">{deal.name}</h4>
          {deal.companyName && <p className="truncate text-meta text-ink-3">{deal.companyName}</p>}
        </div>
      </div>
      <div className="mt-2.5 flex items-center gap-2">
        <span className="text-title font-semibold text-ink">
          <Money value={deal.amount} compact />
        </span>
        {deal.closeDate && (
          <span className="ml-auto inline-flex items-center gap-1 text-meta text-ink-3">
            <CalendarBlank size={13} />
            {shortDate(deal.closeDate)}
          </span>
        )}
      </div>
      {(deal.nextStep || stalled > 0) && (
        <div className="mt-2.5 flex items-center gap-1.5 border-t border-line pt-2">
          {stalled > 0 ? (
            <StalledBadge days={stalled} />
          ) : deal.nextStep ? (
            // The due label is the part you scan for, so the title truncates and it doesn't.
            <span className={cn('flex min-w-0 items-center gap-1 text-meta', due === 'overdue' ? 'text-danger' : due === 'today' ? 'text-accent' : 'text-ink-2')}>
              <span className="truncate">{deal.nextStep.title}</span>
              <span className="shrink-0">· {dueLabel(deal.nextStep.dueDate ?? undefined, todayString())}</span>
            </span>
          ) : null}
          <span className="ml-auto shrink-0">{owner ? <Avatar person={owner} size="xs" /> : <Unassigned size="xs" />}</span>
        </div>
      )}
      {!deal.nextStep && stalled === 0 && (
        <div className="mt-2.5 flex items-center gap-1.5 border-t border-line pt-2">
          <span className="inline-flex items-center gap-1 text-meta text-warning">
            <Warning size={13} /> No next step
          </span>
          <span className="ml-auto shrink-0">{owner ? <Avatar person={owner} size="xs" /> : <Unassigned size="xs" />}</span>
        </div>
      )}
    </article>
  );
}
