import { ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import type { DealType, ForecastCategory, StageKind } from '../constants';
import { statusForStageKind } from '../deals';
import { formatMoney } from '../money';
import { longDay } from '../format';
import type { Actor } from './actor';
import { assertMember } from './actor';
import { runTrigger } from './automations';
import { mergeCustomValues } from './customFields';
import { logEvent, type EventInput } from './events';
import { managerIds, notify } from './notify';
import { getSettings, type OrgSettings } from './settings';
import { bool, num, numOrNull, ref, str, withRetry } from './sql';

/**
 * The deal engine. Every create and change to a deal goes through here, so a
 * stage move always updates status, close date, stage history, the company's
 * type, notifications and automations the same way — from the board, the deal
 * page, a bulk edit, an import or an automation.
 */

export type StageInfo = { id: string; name: string; pipelineId: string; position: number; probability: number; kind: StageKind; rottingDays: number | null; archived: boolean };
export type PipelineInfo = { id: string; name: string; isDefault: boolean; archived: boolean; position: number };

export async function loadPipelines(): Promise<{ pipelines: PipelineInfo[]; stages: StageInfo[] }> {
  const [{ rows: p }, { rows: s }] = await Promise.all([
    zite.sql({ query: `SELECT id, "name", "isDefault", "archived", "position" FROM "Pipelines" ORDER BY COALESCE("position", 0), created_at`, params: [] }),
    zite.sql({ query: `SELECT id, "name", "pipelineId", "position", "probability", "kind", "rottingDays", "archived" FROM "Stages" ORDER BY COALESCE("position", 0), created_at`, params: [] }),
  ]);
  return {
    pipelines: p.map(r => ({ id: String(r.id), name: str(r.name) ?? '', isDefault: bool(r.isDefault), archived: bool(r.archived), position: num(r.position) })),
    stages: s.map(r => ({
      id: String(r.id),
      name: str(r.name) ?? '',
      pipelineId: str(r.pipelineId) ?? '',
      position: num(r.position),
      probability: num(r.probability),
      kind: (str(r.kind) || 'Open') as StageKind,
      rottingDays: numOrNull(r.rottingDays),
      archived: bool(r.archived),
    })),
  };
}

export function defaultPipeline(pipelines: PipelineInfo[]) {
  const live = pipelines.filter(p => !p.archived);
  return live.find(p => p.isDefault) ?? live[0] ?? null;
}

export function firstOpenStage(stages: StageInfo[], pipelineId: string) {
  return stages.filter(s => s.pipelineId === pipelineId && !s.archived && s.kind === 'Open').sort((a, b) => a.position - b.position)[0] ?? null;
}

export type DealCreateInput = {
  name: string;
  companyId?: string | null;
  contactId?: string | null;
  pipelineId?: string | null;
  stageId?: string | null;
  ownerId?: string | null;
  amount?: number | null;
  closeDate?: string | null;
  type?: DealType | null;
  source?: string | null;
  nextStep?: string | null;
  description?: string | null;
  probability?: number | null;
  forecastCategory?: ForecastCategory | null;
  tagIds?: string[] | null;
  customFields?: Record<string, unknown> | null;
  importId?: string | null;
  /** Backdating for imports and the seed. */
  openedAt?: string | null;
};

export async function createDeal(actor: Pick<Actor, 'id' | 'name'> | null, input: DealCreateInput, opts: { today?: string; skipTriggers?: boolean } = {}) {
  const name = input.name?.trim();
  if (!name) throw new ZiteError('Give the deal a name', 'BAD_REQUEST');
  const { pipelines, stages } = await loadPipelines();
  const stage = input.stageId ? stages.find(s => s.id === input.stageId) : null;
  if (input.stageId && !stage) throw new ZiteError('That stage no longer exists', 'BAD_REQUEST');
  const pipelineId = stage?.pipelineId ?? input.pipelineId ?? defaultPipeline(pipelines)?.id ?? null;
  if (!pipelineId || !pipelines.some(p => p.id === pipelineId)) throw new ZiteError('Set up a pipeline before adding deals', 'BAD_REQUEST');
  const finalStage = stage ?? firstOpenStage(stages, pipelineId);
  if (!finalStage) throw new ZiteError('That pipeline has no open stages', 'BAD_REQUEST');
  await assertMember(input.ownerId ?? null);
  await assertExists('Companies', input.companyId, 'company');
  await assertExists('Contacts', input.contactId, 'contact');

  const status = statusForStageKind(finalStage.kind);
  const now = new Date().toISOString();
  const { rows: pos } = await zite.sql({ query: `SELECT MIN("position") AS "minPos" FROM "Deals" WHERE "stageId" = $1`, params: [finalStage.id] });
  const position = pos[0]?.minPos == null ? 1000 : num(pos[0].minPos) - 1000;
  const custom = await mergeCustomValues('Deal', null, input.customFields ?? null, { enforceRequired: !input.importId });

  const created = await withRetry(() =>
    zite.deals.create({
      record: {
        name: name.slice(0, 240),
        companyId: input.companyId || null,
        contactId: input.contactId || null,
        pipelineId,
        stageId: finalStage.id,
        ownerId: input.ownerId === undefined ? actor?.id ?? null : input.ownerId,
        amount: input.amount ?? null,
        closeDate: input.closeDate ?? null,
        status,
        probability: input.probability ?? null,
        forecastCategory: input.forecastCategory ?? null,
        type: input.type ?? 'New Business',
        source: input.source ?? null,
        nextStep: input.nextStep ?? null,
        description: input.description ?? null,
        tagIds: input.tagIds?.length ? JSON.stringify(input.tagIds) : null,
        customFields: custom ?? null,
        closedAt: status === 'Open' ? null : now,
        stageEnteredAt: now,
        openedAt: input.openedAt ?? now,
        position,
        importId: input.importId ?? null,
      },
    }),
  );
  if (input.contactId) {
    await withRetry(() => zite.dealContacts.create({ record: { dealId: created.id, contactId: input.contactId, role: 'Decision Maker' } }));
  }
  await withRetry(() => zite.stageChanges.create({ record: { dealId: created.id, pipelineId, fromStageId: null, toStageId: finalStage.id, changedAt: now, actorId: actor?.id ?? null, amount: input.amount ?? null } }));
  await logEvent({
    kind: 'deal.created',
    entity: { type: 'deal', id: created.id },
    actorId: actor?.id ?? null,
    summary: `created the deal in ${finalStage.name}`,
    companyId: input.companyId || null,
    contactId: input.contactId || null,
  });
  const ownerId = input.ownerId === undefined ? actor?.id ?? null : input.ownerId;
  if (ownerId && ownerId !== actor?.id && !input.importId) {
    await notify({ recipientIds: [ownerId], kind: 'assigned', title: `${actor?.name ?? 'Someone'} gave you a deal: ${name}`, link: `/deals/${created.id}`, entityType: 'deal', entityId: created.id, actorId: actor?.id ?? null });
  }
  if (!opts.skipTriggers) await runTrigger('deal.created', { entityType: 'deal', entityId: created.id, actorId: actor?.id ?? null });
  return created.id;
}

async function assertExists(table: 'Companies' | 'Contacts', id: string | null | undefined, noun: string) {
  if (!id) return;
  const { rows } = await zite.sql({ query: `SELECT 1 FROM "${table}" WHERE id::text = $1`, params: [id] });
  if (!rows[0]) throw new ZiteError(`That ${noun} no longer exists`, 'BAD_REQUEST');
}

export type DealPatch = {
  name?: string;
  companyId?: string | null;
  contactId?: string | null;
  pipelineId?: string;
  stageId?: string;
  ownerId?: string | null;
  amount?: number | null;
  closeDate?: string | null;
  probability?: number | null;
  forecastCategory?: ForecastCategory | null;
  type?: DealType | null;
  source?: string | null;
  nextStep?: string | null;
  description?: string | null;
  lostReason?: string | null;
  closeNote?: string | null;
  tagIds?: string[];
  customFields?: Record<string, unknown>;
  position?: number;
  archived?: boolean;
};

type DealRow = Record<string, unknown>;

/**
 * Apply a patch to one deal. Returns the events it produced (already logged).
 * `today` is the actor's local day, used when a won deal's close date needs
 * pulling in.
 */
export async function updateDeal(actor: Pick<Actor, 'id' | 'name'>, dealId: string, patch: DealPatch, ctx: { today: string; settings?: OrgSettings; pipelines?: Awaited<ReturnType<typeof loadPipelines>> }) {
  const { rows } = await zite.sql({ query: `SELECT * FROM "Deals" WHERE id::text = $1`, params: [dealId] });
  const deal = rows[0] as DealRow | undefined;
  if (!deal) throw new ZiteError('That deal no longer exists', 'NOT_FOUND');
  const settings = ctx.settings ?? (await getSettings());
  const { stages } = ctx.pipelines ?? (await loadPipelines());
  const name = str(deal.name) ?? 'the deal';
  const record: Record<string, unknown> = {};
  const events: EventInput[] = [];
  const base = { entity: { type: 'deal' as const, id: dealId }, actorId: actor.id, companyId: ref(deal.companyId), contactId: ref(deal.contactId) };
  const now = new Date().toISOString();
  const triggers: Array<() => Promise<void>> = [];

  if (patch.name !== undefined) {
    const n = patch.name.trim();
    if (!n) throw new ZiteError('A deal needs a name', 'BAD_REQUEST');
    if (n !== name) {
      record.name = n.slice(0, 240);
      events.push({ ...base, kind: 'deal.renamed', summary: `renamed the deal to “${n}”` });
    }
  }

  // Stage (and pipeline) moves.
  let targetStage: StageInfo | undefined;
  if (patch.stageId !== undefined && patch.stageId !== ref(deal.stageId)) {
    targetStage = stages.find(s => s.id === patch.stageId && !s.archived);
    if (!targetStage) throw new ZiteError('That stage no longer exists', 'BAD_REQUEST');
  } else if (patch.pipelineId !== undefined && patch.pipelineId !== ref(deal.pipelineId)) {
    targetStage = firstOpenStage(stages, patch.pipelineId) ?? undefined;
    if (!targetStage) throw new ZiteError('That pipeline has no open stages', 'BAD_REQUEST');
  }
  if (targetStage) {
    const fromStage = stages.find(s => s.id === ref(deal.stageId));
    const status = statusForStageKind(targetStage.kind);
    const prevStatus = str(deal.status) || 'Open';
    if (status === 'Lost' && settings.preferences.requireLostReason && !(patch.lostReason ?? str(deal.lostReason))) {
      throw new ZiteError('Choose a reason the deal was lost', 'BAD_REQUEST');
    }
    record.stageId = targetStage.id;
    record.pipelineId = targetStage.pipelineId;
    record.status = status;
    record.stageEnteredAt = now;
    if (status !== 'Open' && prevStatus === 'Open') {
      record.closedAt = now;
      const close = patch.closeDate !== undefined ? patch.closeDate : (str(deal.closeDate)?.slice(0, 10) ?? null);
      if (status === 'Won' && (!close || close > ctx.today)) record.closeDate = ctx.today;
      if (status === 'Lost' && !close) record.closeDate = ctx.today;
    }
    if (status === 'Open') {
      record.closedAt = null;
      record.lostReason = null;
    }
    const amount = patch.amount !== undefined ? patch.amount : numOrNull(deal.amount);
    await withRetry(() => zite.stageChanges.create({ record: { dealId, pipelineId: targetStage!.pipelineId, fromStageId: fromStage?.id ?? null, toStageId: targetStage!.id, changedAt: now, actorId: actor.id, amount } }));

    const amountText = amount ? ` (${formatMoney(amount, settings.currency, { cents: false })})` : '';
    if (status === 'Won' && prevStatus !== 'Won') {
      events.push({ ...base, kind: 'deal.won', summary: `marked the deal won${amountText}` });
      const owner = ref(deal.ownerId);
      const managers = await managerIds();
      await notify({ recipientIds: [owner, ...managers], kind: 'deal_won', title: `${actor.name} won ${name}${amountText}`, link: `/deals/${dealId}`, entityType: 'deal', entityId: dealId, actorId: actor.id });
      await promoteCompanyToCustomer(ref(deal.companyId), ctx.today, actor.id);
      triggers.push(() => runTrigger('deal.won', { entityType: 'deal', entityId: dealId, actorId: actor.id }));
    } else if (status === 'Lost' && prevStatus !== 'Lost') {
      const reason = patch.lostReason ?? str(deal.lostReason);
      events.push({ ...base, kind: 'deal.lost', summary: `marked the deal lost${reason ? ` — ${reason}` : ''}`, data: { fromStage: fromStage?.name ?? null } });
      const owner = ref(deal.ownerId);
      await notify({ recipientIds: [owner], kind: 'deal_lost', title: `${actor.name} marked ${name} lost${reason ? ` — ${reason}` : ''}`, link: `/deals/${dealId}`, entityType: 'deal', entityId: dealId, actorId: actor.id });
      triggers.push(() => runTrigger('deal.lost', { entityType: 'deal', entityId: dealId, actorId: actor.id }));
    } else if (status === 'Open' && prevStatus !== 'Open') {
      events.push({ ...base, kind: 'deal.reopened', summary: `reopened the deal in ${targetStage.name}` });
    } else {
      events.push({ ...base, kind: 'deal.stage_changed', summary: `moved the deal to ${targetStage.name}`, data: { from: fromStage?.name ?? null, to: targetStage.name } });
    }
    triggers.push(() => runTrigger('deal.stage_changed', { entityType: 'deal', entityId: dealId, actorId: actor.id, data: { fromStageId: fromStage?.id ?? null, toStageId: targetStage!.id } }));
  }

  if (patch.lostReason !== undefined && patch.lostReason !== str(deal.lostReason)) record.lostReason = patch.lostReason;
  if (patch.closeNote !== undefined) record.closeNote = patch.closeNote;

  if (patch.ownerId !== undefined && patch.ownerId !== ref(deal.ownerId)) {
    await assertMember(patch.ownerId);
    record.ownerId = patch.ownerId;
    const { rows: m } = patch.ownerId ? await zite.sql({ query: `SELECT "name" FROM "Members" WHERE id::text = $1`, params: [patch.ownerId] }) : { rows: [] };
    events.push({ ...base, kind: 'deal.owner_changed', summary: patch.ownerId ? `made ${str(m[0]?.name) ?? 'someone'} the owner` : 'removed the owner' });
    if (patch.ownerId && patch.ownerId !== actor.id) {
      await notify({ recipientIds: [patch.ownerId], kind: 'assigned', title: `${actor.name} gave you a deal: ${name}`, link: `/deals/${dealId}`, entityType: 'deal', entityId: dealId, actorId: actor.id });
    }
  }

  if (patch.amount !== undefined && patch.amount !== numOrNull(deal.amount)) {
    if (patch.amount != null && (!Number.isFinite(patch.amount) || patch.amount < 0)) throw new ZiteError('The amount must be zero or more', 'BAD_REQUEST');
    record.amount = patch.amount;
    events.push({ ...base, kind: 'deal.amount_changed', summary: patch.amount == null ? 'cleared the amount' : `changed the amount to ${formatMoney(patch.amount, settings.currency, { cents: false })}`, data: { from: numOrNull(deal.amount), to: patch.amount } });
  }
  if (patch.closeDate !== undefined && record.closeDate === undefined && patch.closeDate !== (str(deal.closeDate)?.slice(0, 10) ?? null)) {
    record.closeDate = patch.closeDate;
    events.push({ ...base, kind: 'deal.close_date_changed', summary: patch.closeDate ? `moved the close date to ${longDay(patch.closeDate)}` : 'cleared the close date' });
  }
  if (patch.companyId !== undefined && patch.companyId !== ref(deal.companyId)) {
    await assertExists('Companies', patch.companyId, 'company');
    record.companyId = patch.companyId;
    events.push({ ...base, kind: 'deal.company_changed', summary: patch.companyId ? 'changed the company' : 'removed the company' });
  }
  if (patch.contactId !== undefined && patch.contactId !== ref(deal.contactId)) {
    await assertExists('Contacts', patch.contactId, 'contact');
    record.contactId = patch.contactId;
    if (patch.contactId) {
      const { rows: existing } = await zite.sql({ query: `SELECT 1 FROM "DealContacts" WHERE "dealId" = $1 AND "contactId" = $2`, params: [dealId, patch.contactId] });
      if (!existing[0]) await withRetry(() => zite.dealContacts.create({ record: { dealId, contactId: patch.contactId, role: 'Decision Maker' } }));
    }
  }
  const simple: Array<keyof DealPatch> = ['probability', 'forecastCategory', 'type', 'source', 'nextStep', 'description', 'position', 'archived'];
  for (const key of simple) if (patch[key] !== undefined) record[key] = patch[key];
  if (patch.forecastCategory !== undefined && patch.forecastCategory !== (str(deal.forecastCategory) || null)) {
    events.push({ ...base, kind: 'deal.forecast_changed', summary: patch.forecastCategory ? `set the forecast category to ${patch.forecastCategory}` : 'reset the forecast category' });
  }
  if (patch.archived !== undefined && patch.archived !== bool(deal.archived)) {
    events.push({ ...base, kind: patch.archived ? 'deal.archived' : 'deal.restored', summary: patch.archived ? 'archived the deal' : 'restored the deal' });
  }
  if (patch.tagIds !== undefined) record.tagIds = patch.tagIds.length ? JSON.stringify([...new Set(patch.tagIds)]) : null;
  if (patch.customFields !== undefined) {
    const merged = await mergeCustomValues('Deal', deal.customFields, patch.customFields);
    if (merged !== undefined) {
      record.customFields = merged;
      events.push({ ...base, kind: 'deal.fields_changed', summary: `updated ${Object.keys(patch.customFields).length === 1 ? 'a field' : 'fields'}` });
    }
  }

  if (Object.keys(record).length) await withRetry(() => zite.deals.update({ id: dealId, record: record as never }));
  for (const e of events) await logEvent(e);
  for (const t of triggers) await t();
  return { changed: Object.keys(record), events: events.length };
}

/** Winning a deal makes a prospect a customer. */
async function promoteCompanyToCustomer(companyId: string | null, today: string, actorId: string) {
  if (!companyId) return;
  const company = await zite.companies.findOne({ id: companyId });
  if (!company) return;
  const patch: Record<string, unknown> = {};
  if (!company.type || company.type === 'Prospect' || company.type === 'Former Customer') patch.type = 'Customer';
  if (!company.customerSince) patch.customerSince = today;
  if (!Object.keys(patch).length) return;
  await withRetry(() => zite.companies.update({ id: companyId, record: patch as never }));
  if (patch.type) await logEvent({ kind: 'company.became_customer', entity: { type: 'company', id: companyId }, actorId, summary: 'won a deal, so the company is now a customer' });
}

/** Keep a deal's amount equal to its line items' total, when it has any. Called by the line item endpoints. */
export async function syncAmountFromLineItems(dealId: string, total: number | null) {
  await withRetry(() => zite.deals.update({ id: dealId, record: { amount: total } }));
}
