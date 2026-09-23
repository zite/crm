/**
 * Automations engine — the contract every write path calls.
 *
 * Mutations call `runTrigger(trigger, payload)` AFTER their own writes succeed.
 * It finds active Automations whose trigger matches, checks their conditions
 * against the record, runs their actions, and records an AutomationRuns row.
 * It never throws: an automation failing must not fail the change that fired it.
 *
 * Triggers (the `trigger` column):
 *   deal.created · deal.stage_changed · deal.won · deal.lost · deal.stalled (daily)
 *   lead.created · lead.status_changed · lead.converted
 *   contact.created · company.created
 *   form.submitted · meeting.booked · quote.accepted · quote.declined
 *   task.completed · activity.logged
 *
 * The implementation lives in ./automationsEngine.ts (owned by the settings
 * area). This file only re-exports, so every caller imports one stable path.
 */
export type TriggerKind =
  | 'deal.created'
  | 'deal.stage_changed'
  | 'deal.won'
  | 'deal.lost'
  | 'deal.stalled'
  | 'lead.created'
  | 'lead.status_changed'
  | 'lead.converted'
  | 'contact.created'
  | 'company.created'
  | 'form.submitted'
  | 'meeting.booked'
  | 'quote.accepted'
  | 'quote.declined'
  | 'task.completed'
  | 'activity.logged';

export type TriggerPayload = {
  entityType: 'deal' | 'lead' | 'contact' | 'company' | 'quote' | 'task' | 'activity' | 'form';
  entityId: string;
  /** Null for public-app and scheduled triggers. */
  actorId: string | null;
  /** Trigger-specific detail, e.g. { fromStageId, toStageId } or { formId }. */
  data?: Record<string, unknown>;
};

export { runTrigger } from './automationsEngine';
