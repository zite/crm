import type { Billing } from './constants';
import { fromCents, toCents } from './money';

/**
 * Line item and quote arithmetic, in integer cents. Used by the deal's line
 * items (which set the deal amount), the quote builder, the quote PDF and the
 * public quote page, so a buyer never sees a total that differs from the rep's.
 */

export type LineInput = {
  name: string;
  quantity: number;
  unitPrice: number;
  /** Percent, 0–100. */
  discount: number;
  billing: Billing;
  /** Months of service a recurring line covers; ignored for one-time lines. */
  termMonths: number | null;
};

/** Contract value of one line: recurring lines are multiplied out over their term (monthly × months, annual × years). */
export function lineTotal(line: LineInput): number {
  const qty = Number(line.quantity) || 0;
  const unit = toCents(line.unitPrice);
  const gross = Math.round(unit * qty);
  const net = Math.round(gross * (1 - Math.min(100, Math.max(0, Number(line.discount) || 0)) / 100));
  const term = Math.max(1, Number(line.termMonths) || 12);
  const multiplier = line.billing === 'Monthly' ? term : line.billing === 'Annual' ? Math.max(1, term / 12) : 1;
  return fromCents(Math.round(net * multiplier));
}

export function lineDiscount(line: LineInput): number {
  const qty = Number(line.quantity) || 0;
  const gross = Math.round(toCents(line.unitPrice) * qty);
  const term = Math.max(1, Number(line.termMonths) || 12);
  const multiplier = line.billing === 'Monthly' ? term : line.billing === 'Annual' ? Math.max(1, term / 12) : 1;
  return fromCents(Math.round(gross * multiplier) - toCents(lineTotal(line)));
}

export type QuoteTotals = { subtotal: number; discountTotal: number; tax: number; total: number };

/** Subtotal is before discounts; tax applies to the discounted amount. `taxRate` is a percent. */
export function quoteTotals(lines: LineInput[], taxRate: number): QuoteTotals {
  let net = 0;
  let discount = 0;
  for (const l of lines) {
    net += toCents(lineTotal(l));
    discount += toCents(lineDiscount(l));
  }
  const tax = Math.round((net * Math.max(0, Number(taxRate) || 0)) / 100);
  return { subtotal: fromCents(net + discount), discountTotal: fromCents(discount), tax: fromCents(tax), total: fromCents(net + tax) };
}

/** "per month · 12 months" style description of a line's billing. */
export function billingLabel(billing: Billing, termMonths: number | null) {
  if (billing === 'One-time') return 'One-time';
  const term = Math.max(1, Number(termMonths) || 12);
  if (billing === 'Monthly') return `Monthly · ${term} mo`;
  return term % 12 === 0 ? `Annual · ${term / 12} yr` : `Annual · ${term} mo`;
}
