/**
 * Pricing never asks a model to invent a number. Only exact, scoped historical
 * positions, an unexpired explicit rule, or a known cost can supply one.
 * The public explanation is selected from fixed strings, not private rule text.
 */
import type {
  CustomerDocument, InternalSheet, OffertenComparison, OffertenPosition,
  OffertenQuote, OffertenRule, PositionInput, QuoteHeader, PriceReason,
} from './schema';
import { CustomerDocumentSchema, PRICE_REASON_TEXT } from './schema';

const normalise = (value: string | null) => value?.trim().toLocaleLowerCase('en').replace(/\s+/g, ' ') ?? '';
const same = (left: string | null, right: string | null) => normalise(left) === normalise(right);
export const safeReason = (code: PriceReason['code'], detail: Partial<PriceReason> = {}): PriceReason => ({
  ...detail, code, text: PRICE_REASON_TEXT[code],
  source: detail.source ?? null,
  appliesBecause: PRICE_REASON_TEXT[code],
  nearestComparableDelta: detail.nearestComparableDelta ?? null,
});

export function activeRule(rule: OffertenRule, now: Date): boolean {
  return Date.parse(rule.established) <= now.getTime() &&
    Date.parse(rule.expires) > now.getTime();
}

function eligible(quote: OffertenQuote, header: QuoteHeader): boolean {
  return quote.header.status !== 'rejected' && quote.header.status !== 'draft' &&
    header.currency !== null && quote.header.currency === header.currency;
}

export function pricePositions(
  inputs: PositionInput[],
  header: QuoteHeader,
  catalogue: OffertenQuote[],
  rules: OffertenRule[],
  now: Date,
): { positions: OffertenPosition[]; internal: InternalSheet } {
  const internal: InternalSheet = {
    generated: true, positions: [], notes: [], totalCost: null, totalRevenue: null, totalMargin: null,
  };
  const positions = inputs.map((input, index): OffertenPosition => {
    const id = input.id ?? `position-${index + 1}`;
    // A customer/site-specific exact position outranks a merely similar job.
    const exact = catalogue.filter((quote) => eligible(quote, header))
      .sort((a, b) => {
        const score = (quote: OffertenQuote) =>
          Number(same(quote.header.customer, header.customer)) * 2 + Number(same(quote.header.site, header.site));
        return score(b) - score(a) || (b.header.date ?? '').localeCompare(a.header.date ?? '') || a.id.localeCompare(b.id);
      })
      .flatMap((quote) => quote.positions.map((position) => ({ quote, position })))
      .find(({ position }) => input.unit !== null && position.unit !== null &&
        same(position.description, input.description) && same(position.unit, input.unit) &&
        position.unitPrice !== null);
    const rule = rules.filter((entry) => activeRule(entry, now) && entry.pricing)
      .sort((a, b) => b.established.localeCompare(a.established) || a.id.localeCompare(b.id))
      .find(({ pricing }) => pricing && input.unit !== null && pricing.unit !== null && same(pricing.description, input.description) &&
        same(pricing.unit, input.unit) && pricing.currency === header.currency &&
        (pricing.customer === null || same(pricing.customer, header.customer)) &&
        (pricing.site === null || same(pricing.site, header.site)));
    let unitPrice: number | null = null;
    let code: PriceReason['code'] = 'owner-number';
    if (exact) {
      unitPrice = exact.position.unitPrice;
      code = 'past-position';
    } else if (rule?.pricing) {
      unitPrice = rule.pricing.unitPrice;
      code = 'explicit-rule';
    } else if (input.cost !== null) {
      // Cost alone is a lower bound, not an invented markup or margin target.
      unitPrice = input.cost;
      code = 'cost';
    }
    internal.positions.push({
      positionId: id,
      cost: input.cost,
      margin: unitPrice === null || input.cost === null ? null : unitPrice - input.cost,
      lineCost: null, lineRevenue: null, lineMargin: null,
      commentary: code === 'cost' ? 'Cost-only lower bound. Owner must confirm the selling price.' : '',
    });
    const nearest = catalogue.filter((quote) => eligible(quote, header))
      .flatMap((quote) => quote.positions)
      .filter((position) => same(position.unit, input.unit) && position.unitPrice !== null)
      .sort((a, b) => Number(same(b.description, input.description)) - Number(same(a.description, input.description)) ||
        Math.abs((a.unitPrice ?? 0) - (unitPrice ?? 0)) - Math.abs((b.unitPrice ?? 0) - (unitPrice ?? 0)))[0];
    return {
      id, description: input.description, quantity: input.quantity, unit: input.unit,
      unitPrice, proposedUnitPrice: unitPrice, handPrice: input.handPrice,
      reason: safeReason(code, {
        source: exact
          ? { kind: 'position', id: `reference-${index + 1}`, positionId: `position-${index + 1}` }
          : rule ? { kind: 'rule', id: `rule-${index + 1}` }
            : code === 'cost' ? { kind: 'cost', id } : null,
        nearestComparableDelta: nearest?.unitPrice == null || unitPrice === null ? null : unitPrice - nearest.unitPrice,
      }),
      sourceQuoteId: exact?.quote.id ?? null,
    };
  });
  return { positions, internal: completeInternalSheet(positions, internal) };
}

export function lineTotal(quantity: number | null, unitPrice: number | null): number | null {
  if (quantity === null || unitPrice === null) return null;
  const total = Math.round(quantity * unitPrice);
  if (!Number.isSafeInteger(total)) throw new Error('Money calculation exceeds the safe integer range.');
  return total;
}

function sumKnown(values: (number | null)[]): number | null {
  if (values.some((value) => value === null)) return null;
  const sum = values.reduce<number>((total, value) => total + (value ?? 0), 0);
  if (!Number.isSafeInteger(sum)) throw new Error('Money calculation exceeds the safe integer range.');
  return sum;
}

export function customerDocument(
  quote: Pick<OffertenQuote, 'id' | 'revision' | 'header' | 'positions'>,
): CustomerDocument {
  const positions = quote.positions.map((position) => ({
    id: position.id,
    description: position.description,
    quantity: position.quantity,
    unit: position.unit,
    unitPrice: position.unitPrice,
    total: lineTotal(position.quantity, position.unitPrice),
    reason: position.reason.code === 'cost'
      ? safeReason('provisional', { nearestComparableDelta: position.reason.nearestComparableDelta })
      : safeReason(position.reason.code, position.reason),
  }));
  const subtotal = sumKnown(positions.map((position) => position.total));
  const vat = subtotal === null || quote.header.vatRate === null
    ? null : Math.round(subtotal * quote.header.vatRate / 100);
  const total = subtotal === null || vat === null ? null : subtotal + vat;
  return CustomerDocumentSchema.parse({
    generated: true, quoteId: quote.id, revision: quote.revision,
    header: quote.header, positions, subtotal, vat, total,
  });
}

export function completeInternalSheet(positions: OffertenPosition[], sheet: InternalSheet): InternalSheet {
  const lines = positions.map((position) => {
    const previous = sheet.positions.find((entry) => entry.positionId === position.id);
    const cost = previous?.cost ?? null;
    const lineCost = lineTotal(position.quantity, cost);
    const lineRevenue = lineTotal(position.quantity, position.unitPrice);
    return {
      positionId: position.id, cost,
      margin: cost === null || position.unitPrice === null ? null : position.unitPrice - cost,
      lineCost, lineRevenue,
      lineMargin: lineCost === null || lineRevenue === null ? null : lineRevenue - lineCost,
      commentary: previous?.commentary ?? '',
    };
  });
  const totalCost = sumKnown(lines.map((line) => line.lineCost));
  const totalRevenue = sumKnown(lines.map((line) => line.lineRevenue));
  return {
    generated: true, positions: lines, notes: sheet.notes, totalCost, totalRevenue,
    totalMargin: totalCost === null || totalRevenue === null ? null : totalRevenue - totalCost,
  };
}

export function comparison(quote: OffertenQuote, catalogue: OffertenQuote[]): OffertenComparison {
  const positions = quote.positions.map((position) => ({
    positionId: position.id, unitPrice: position.unitPrice, handPrice: position.handPrice,
    delta: position.unitPrice === null || position.handPrice === null ? null : position.unitPrice - position.handPrice,
    nearestComparables: catalogue.filter((other) => eligible(other, quote.header) && other.id !== quote.id)
      .flatMap((other) => other.positions
        .filter((candidate) => position.unit !== null && candidate.unit !== null && same(candidate.unit, position.unit))
        .map((candidate) => ({
          quoteId: other.id, positionId: candidate.id, unitPrice: candidate.unitPrice,
          delta: position.unitPrice === null || candidate.unitPrice === null ? null : position.unitPrice - candidate.unitPrice,
          quantityDelta: position.quantity === null || candidate.quantity === null ? null : position.quantity - candidate.quantity,
          exact: same(candidate.description, position.description),
        })))
      .sort((a, b) => Number(b.exact) - Number(a.exact) ||
        Math.abs(a.delta ?? Number.MAX_SAFE_INTEGER) - Math.abs(b.delta ?? Number.MAX_SAFE_INTEGER))
      .slice(0, 3)
      .map(({ exact: _exact, ...entry }) => entry),
  }));
  return {
    quoteId: quote.id, revision: quote.revision, positions,
    totalDelta: sumKnown(quote.positions.map((position) =>
      position.handPrice === null || position.unitPrice === null
        ? null : lineTotal(position.quantity, position.unitPrice - position.handPrice))),
  };
}
