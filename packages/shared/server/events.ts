import { zite } from 'zitejs/db';
import type { EntityType } from '../constants';
import { withRetry } from './sql';

/**
 * Record history: the "who changed what" half of every timeline (the other
 * half is Activities). Every meaningful write calls `logEvent` with a finished
 * sentence fragment that reads after the actor's name:
 *
 *   logEvent({ kind: 'deal.stage_changed', entity: { type: 'deal', id }, actorId,
 *              summary: 'moved the deal to Proposal', dealId, companyId })
 *
 * Kinds are dotted strings (`<entity>.<verb>`), free to extend. Keep `data`
 * small: it is shown as detail, never re-read for business logic.
 */

export type EventInput = {
  kind: string;
  entity: { type: EntityType | 'quote' | 'sequence' | 'form' | 'bookingPage' | 'task' | 'import' | 'settings' | 'member'; id: string };
  actorId: string | null;
  summary: string;
  data?: Record<string, unknown> | null;
  companyId?: string | null;
  contactId?: string | null;
  dealId?: string | null;
  leadId?: string | null;
  occurredAt?: string;
};

export async function logEvent(e: EventInput) {
  const record = {
    kind: e.kind,
    entityType: e.entity.type,
    entityId: e.entity.id,
    actorId: e.actorId,
    summary: e.summary.slice(0, 480),
    data: e.data ? JSON.stringify(e.data).slice(0, 8000) : null,
    occurredAt: e.occurredAt ?? new Date().toISOString(),
    companyId: e.companyId ?? (e.entity.type === 'company' ? e.entity.id : null),
    contactId: e.contactId ?? (e.entity.type === 'contact' ? e.entity.id : null),
    dealId: e.dealId ?? (e.entity.type === 'deal' ? e.entity.id : null),
    leadId: e.leadId ?? (e.entity.type === 'lead' ? e.entity.id : null),
  };
  try {
    await withRetry(() => zite.events.create({ record }));
  } catch (err) {
    // History is best-effort: never fail the change it describes.
    console.error('logEvent failed', err instanceof Error ? err.message : err);
  }
}

/** Several events in one insert (bulk edits). */
export async function logEvents(list: EventInput[]) {
  for (let i = 0; i < list.length; i += 100) {
    const batch = list.slice(i, i + 100).map(e => ({
      kind: e.kind,
      entityType: e.entity.type,
      entityId: e.entity.id,
      actorId: e.actorId,
      summary: e.summary.slice(0, 480),
      data: e.data ? JSON.stringify(e.data).slice(0, 8000) : null,
      occurredAt: e.occurredAt ?? new Date().toISOString(),
      companyId: e.companyId ?? (e.entity.type === 'company' ? e.entity.id : null),
      contactId: e.contactId ?? (e.entity.type === 'contact' ? e.entity.id : null),
      dealId: e.dealId ?? (e.entity.type === 'deal' ? e.entity.id : null),
      leadId: e.leadId ?? (e.entity.type === 'lead' ? e.entity.id : null),
    }));
    try {
      await withRetry(() => zite.events.bulkCreate({ records: batch }));
    } catch (err) {
      console.error('logEvents failed', err instanceof Error ? err.message : err);
    }
  }
}
