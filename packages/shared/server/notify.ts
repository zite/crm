import { zite } from 'zitejs/db';
import { withRetry } from './sql';

/**
 * The inbox. `notify` writes one Notifications row per recipient and never
 * notifies the actor about their own action. `link` is a CRM hash route
 * ('/deals/<id>'), rendered as a button in the inbox and in any email.
 *
 * Kinds (free text, keep to these so the inbox can filter and pick a glyph):
 *   assigned · mention · lead · deal_won · deal_lost · deal_stage · task_due ·
 *   meeting_booked · quote_viewed · quote_accepted · quote_declined ·
 *   form_submission · sequence · automation · import · reply · system
 */

export type NotifyInput = {
  recipientIds: Array<string | null | undefined>;
  kind: string;
  title: string;
  body?: string | null;
  link?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  actorId?: string | null;
};

export async function notify(n: NotifyInput) {
  const ids = [...new Set(n.recipientIds.filter((id): id is string => Boolean(id) && id !== n.actorId))];
  if (!ids.length) return 0;
  const now = new Date().toISOString();
  const records = ids.map(recipientId => ({
    recipientId,
    kind: n.kind,
    title: n.title.slice(0, 240),
    body: n.body ? n.body.slice(0, 2000) : null,
    link: n.link ?? null,
    entityType: n.entityType ?? null,
    entityId: n.entityId ?? null,
    actorId: n.actorId ?? null,
    occurredAt: now,
  }));
  try {
    await withRetry(() => zite.notifications.bulkCreate({ records }));
  } catch (err) {
    console.error('notify failed', err instanceof Error ? err.message : err);
  }
  return ids.length;
}

/** Member ids for managers and admins — who hears about wins, big losses and routing gaps. */
export async function managerIds(): Promise<string[]> {
  const { rows } = await zite.sql({ query: `SELECT id FROM "Members" WHERE "role" IN ('Admin', 'Manager') AND "status" <> 'Deactivated'`, params: [] });
  return rows.map(r => String(r.id));
}
