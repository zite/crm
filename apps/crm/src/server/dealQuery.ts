import { zite } from 'zitejs/db';
import { bool, day, iso, json, num, numOrNull, Params, ref, str } from '@project/shared/server/sql';
import { nextStepsFor } from '@project/shared/server/tasks';
import { jsonHasAny } from '@project/shared/server/records';
import { defaultForecastCategory, effectiveProbability, weightedAmount } from '@project/shared/deals';
import type { DealStatus } from '@project/shared/constants';
import type { DealFilters } from './schemas';

/**
 * The one deal query: the ledger, the board, a company's deals, reports
 * drill-downs and the deal page all read rows through here, so a deal looks
 * the same everywhere.
 */

export const DEAL_SORT_KEYS = ['name', 'amount', 'weighted', 'closeDate', 'stage', 'owner', 'company', 'lastActivityAt', 'openedAt', 'closedAt', 'position', 'probability'] as const;
export type DealSortKey = (typeof DEAL_SORT_KEYS)[number];

export async function queryDeals(f: DealFilters, sort: { key: DealSortKey; dir: 'asc' | 'desc' } | undefined, limit: number, today: string) {
  const p = new Params();
  const where: string[] = [];
  where.push(f.archived ? 'COALESCE(d."archived", false) = true' : 'COALESCE(d."archived", false) = false');
  if (f.ids?.length) where.push(`d.id::text IN ${p.list(f.ids)}`);
  if (f.pipelineId) where.push(`d."pipelineId" = ${p.add(f.pipelineId)}`);
  if (f.status?.length) where.push(`d."status" IN ${p.list(f.status)}`);
  if (f.stageIds?.length) where.push(`d."stageId" IN ${p.list(f.stageIds)}`);
  if (f.ownerIds?.length) {
    const real = f.ownerIds.filter(o => o !== 'none');
    const parts: string[] = [];
    if (real.length) parts.push(`d."ownerId" IN ${p.list(real)}`);
    if (f.ownerIds.includes('none')) parts.push(`COALESCE(d."ownerId", '') = ''`);
    where.push(`(${parts.join(' OR ')})`);
  }
  if (f.teamId) where.push(`d."ownerId" IN (SELECT id::text FROM "Members" WHERE "teamId" = ${p.add(f.teamId)})`);
  if (f.companyId) where.push(`d."companyId" = ${p.add(f.companyId)}`);
  if (f.contactId) where.push(`(d."contactId" = ${p.add(f.contactId)} OR EXISTS (SELECT 1 FROM "DealContacts" dc WHERE dc."dealId" = d.id::text AND dc."contactId" = ${p.add(f.contactId)}))`);
  if (f.tagIds?.length) where.push(jsonHasAny('d."tagIds"', p.list(f.tagIds)));
  if (f.types?.length) where.push(`d."type" IN ${p.list(f.types)}`);
  if (f.sources?.length) where.push(`d."source" IN ${p.list(f.sources)}`);
  if (f.lostReasons?.length) where.push(`d."lostReason" IN ${p.list(f.lostReasons)}`);
  if (f.forecastCategories?.length) {
    // An unset category falls back by probability; mirror defaultForecastCategory in SQL.
    where.push(`COALESCE(NULLIF(d."forecastCategory", ''), CASE WHEN d."status" <> 'Open' THEN 'Closed' WHEN COALESCE(d."probability", s."probability", 0) >= 80 THEN 'Commit' WHEN COALESCE(d."probability", s."probability", 0) >= 50 THEN 'Best Case' ELSE 'Pipeline' END) IN ${p.list(f.forecastCategories)}`);
  }
  if (f.closeFrom) where.push(`d."closeDate" >= ${p.add(f.closeFrom)}::date`);
  if (f.closeTo) where.push(`d."closeDate" <= ${p.add(f.closeTo)}::date`);
  if (f.closedFrom) where.push(`d."closedAt" >= ${p.add(f.closedFrom)}::date`);
  if (f.closedTo) where.push(`d."closedAt" < (${p.add(f.closedTo)}::date + 1)`);
  if (f.amountMin != null) where.push(`d."amount" >= ${p.add(f.amountMin)}`);
  if (f.amountMax != null) where.push(`d."amount" <= ${p.add(f.amountMax)}`);
  if (f.stalled) where.push(`d."status" = 'Open' AND COALESCE(s."rottingDays", 0) > 0 AND d."stageEnteredAt" < (${p.add(today)}::date - s."rottingDays"::int)`);
  if (f.closingOverdue) where.push(`d."status" = 'Open' AND d."closeDate" < ${p.add(today)}::date`);
  if (f.noNextStep) where.push(`d."status" = 'Open' AND NOT EXISTS (SELECT 1 FROM "Tasks" tk WHERE tk."dealId" = d.id::text AND tk."status" = 'Open')`);
  if (f.search?.trim()) {
    const like = p.add(`%${f.search.trim().toLowerCase()}%`);
    where.push(`(LOWER(d."name") LIKE ${like} OR LOWER(co."name") LIKE ${like} OR LOWER(pc."name") LIKE ${like})`);
  }
  if (f.custom && Object.keys(f.custom).length) {
    for (const [key, value] of Object.entries(f.custom)) {
      if (!/^[a-z0-9_]{1,40}$/.test(key) || value == null || value === '') continue;
      where.push(`COALESCE(NULLIF(d."customFields", ''), '{}')::jsonb ->> ${p.add(key)} = ${p.add(String(value))}`);
    }
  }

  const dir = sort?.dir === 'desc' ? 'DESC' : 'ASC';
  const order =
    {
      name: `LOWER(d."name") ${dir}`,
      amount: `d."amount" ${dir} NULLS LAST`,
      weighted: `(COALESCE(d."amount", 0) * CASE WHEN d."status" = 'Won' THEN 100 WHEN d."status" = 'Lost' THEN 0 ELSE COALESCE(d."probability", s."probability", 0) END) ${dir}`,
      closeDate: `d."closeDate" ${dir} NULLS LAST`,
      stage: `pl."position" ${dir}, s."position" ${dir}`,
      owner: `LOWER(m."name") ${dir} NULLS LAST`,
      company: `LOWER(co."name") ${dir} NULLS LAST`,
      lastActivityAt: `d."lastActivityAt" ${dir} NULLS LAST`,
      openedAt: `COALESCE(d."openedAt", d.created_at) ${dir}`,
      closedAt: `d."closedAt" ${dir} NULLS LAST`,
      position: `s."position" ASC, d."position" ${dir} NULLS LAST`,
      probability: `COALESCE(d."probability", s."probability", 0) ${dir}`,
    }[sort?.key ?? 'position'] ?? `d."position" ASC`;

  const { rows, truncated } = await zite.sql({
    query: `
      SELECT d.*, co."name" AS "companyName", pc."name" AS "contactName", s."probability" AS "stageProbability",
        (SELECT COUNT(*) FROM "Quotes" q WHERE q."dealId" = d.id::text AND q."status" <> 'Void') AS "quoteTotal"
      FROM "Deals" d
      LEFT JOIN "Stages" s ON s.id::text = d."stageId"
      LEFT JOIN "Pipelines" pl ON pl.id::text = d."pipelineId"
      LEFT JOIN "Companies" co ON co.id::text = d."companyId"
      LEFT JOIN "Contacts" pc ON pc.id::text = d."contactId"
      LEFT JOIN "Members" m ON m.id::text = d."ownerId"
      WHERE ${where.join(' AND ')}
      ORDER BY ${order}, d.created_at DESC
      LIMIT ${Math.min(limit, 2000)}`,
    params: p.values,
  });

  const next = await nextStepsFor('dealId', rows.map(r => String(r.id)));
  return {
    deals: rows.map(r => {
      const status = (str(r.status) || 'Open') as DealStatus;
      const probability = effectiveProbability(status, numOrNull(r.probability), { probability: numOrNull(r.stageProbability) });
      const amount = numOrNull(r.amount);
      return {
        id: String(r.id),
        name: str(r.name) ?? '',
        companyId: ref(r.companyId),
        companyName: str(r.companyName) || null,
        contactId: ref(r.contactId),
        contactName: str(r.contactName) || null,
        pipelineId: str(r.pipelineId) ?? '',
        stageId: str(r.stageId) ?? '',
        ownerId: ref(r.ownerId),
        amount,
        closeDate: day(r.closeDate),
        status,
        probability,
        probabilityOverride: numOrNull(r.probability),
        weighted: weightedAmount(amount, probability),
        forecastCategory: (str(r.forecastCategory) || defaultForecastCategory(status, probability)) as string,
        forecastCategorySet: Boolean(str(r.forecastCategory)),
        type: str(r.type) || null,
        source: str(r.source) || null,
        nextStepNote: str(r.nextStep) || null,
        lostReason: str(r.lostReason) || null,
        closedAt: iso(r.closedAt),
        stageEnteredAt: iso(r.stageEnteredAt),
        openedAt: iso(r.openedAt) ?? iso(r.created_at),
        lastActivityAt: iso(r.lastActivityAt),
        position: num(r.position),
        tagIds: json<string[]>(r.tagIds, []),
        customFields: json<Record<string, unknown>>(r.customFields, {}),
        archived: bool(r.archived),
        quoteCount: num(r.quoteTotal),
        nextStep: next.get(String(r.id)) ?? null,
      };
    }),
    truncated: Boolean(truncated),
  };
}
