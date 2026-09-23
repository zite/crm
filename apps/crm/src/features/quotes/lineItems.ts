import type { Billing } from '@project/shared/constants';
import { lineTotal, quoteTotals, type LineInput } from '@project/shared/quotes';
import type { ListLineItemsOutputType, ListProductsOutputType, GetQuoteOutputType } from 'zitejs/api';

/**
 * Whether an amount really carries cents. Deal and quote figures are round
 * almost always, so a trailing `.00` is noise on a scanning surface — but
 * $1,234,567.89 must never be shown as $1,234,568.
 */
export const hasCents = (value: number | null | undefined) => Boolean(value) && Math.abs((value as number) % 1) > 0.004;

/**
 * The shape a line is edited in, shared by the deal panel and the quote editor.
 * Every figure on screen comes from `@project/shared/quotes`, so the rep, the
 * PDF and the buyer's page can never disagree.
 */
export type EditableLine = {
  /** Stable while editing; a row saved before keeps its record id. */
  id: string;
  name: string;
  description: string | null;
  productId: string | null;
  quantity: number;
  unitPrice: number;
  discount: number;
  billing: Billing;
  termMonths: number | null;
};

let seq = 0;
export const newLineId = () => `new-${Date.now().toString(36)}-${(seq++).toString(36)}`;

export const blankLine = (): EditableLine => ({
  id: newLineId(),
  name: '',
  description: null,
  productId: null,
  quantity: 1,
  unitPrice: 0,
  discount: 0,
  billing: 'One-time',
  termMonths: null,
});

type Product = ListProductsOutputType['products'][number];

export function lineFromProduct(product: Product): EditableLine {
  const billing = (product.billing as Billing) ?? 'One-time';
  return {
    id: newLineId(),
    name: product.name,
    description: null,
    productId: product.id,
    quantity: 1,
    unitPrice: product.unitPrice,
    discount: 0,
    billing,
    termMonths: billing === 'One-time' ? null : 12,
  };
}

export const fromLineItems = (items: ListLineItemsOutputType['items']): EditableLine[] =>
  items.map(i => ({
    id: i.id,
    name: i.name,
    description: i.description,
    productId: i.productId,
    quantity: i.quantity,
    unitPrice: i.unitPrice,
    discount: i.discount,
    billing: i.billing as Billing,
    termMonths: i.termMonths,
  }));

export const fromQuoteItems = (items: GetQuoteOutputType['items']): EditableLine[] =>
  items.map(i => ({
    id: i.id,
    name: i.name,
    description: i.description,
    productId: i.productId,
    quantity: i.quantity,
    unitPrice: i.unitPrice,
    discount: i.discount,
    billing: i.billing as Billing,
    termMonths: i.termMonths,
  }));

/** What the endpoints take: the editing id is dropped for a line that was never saved. */
export const toPayload = (lines: EditableLine[]) =>
  lines.map(l => ({
    ...(l.id.startsWith('new-') ? {} : { id: l.id }),
    name: l.name.trim(),
    description: l.description?.trim() || null,
    productId: l.productId,
    quantity: Number.isFinite(l.quantity) ? l.quantity : 0,
    unitPrice: Number.isFinite(l.unitPrice) ? l.unitPrice : 0,
    discount: Number.isFinite(l.discount) ? l.discount : 0,
    billing: l.billing,
    termMonths: l.billing === 'One-time' ? null : Math.max(1, Math.round(l.termMonths ?? 12)),
  }));

export const totalOf = (line: EditableLine) => lineTotal(line as LineInput);
export const totalsOf = (lines: EditableLine[], taxRate = 0) => quoteTotals(lines as LineInput[], taxRate);

/** Two sets of lines that would save to the same thing. */
export const sameLines = (a: EditableLine[], b: EditableLine[]) => JSON.stringify(toPayload(a)) === JSON.stringify(toPayload(b));

export const isComplete = (lines: EditableLine[]) => lines.every(l => l.name.trim().length > 0);

/**
 * The calendar day a timestamp fell on *here*. Slicing an ISO string gives the
 * UTC day, which reads a day ahead for anyone west of Greenwich in the evening.
 */
export const localDay = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString('en-CA') : null);
