/**
 * The connector port describes read-only ERP ingestion, but this release
 * instantiates only the bundled fixture. Configuration is not a connection.
 */
import type { ConnectorConfig, OffertenQuote, PositionInput, QuoteHeader } from './schema';
import { OffertenQuoteSchema } from './schema';
import { completeInternalSheet, customerDocument, safeReason } from './pricing';

export interface OffertenAdapter {
  readonly kind: 'fixture';
  listQuotesSince(since: string | null): Promise<string[]>;
  fetchQuote(id: string): Promise<unknown>;
  fetchCostMasters?(): Promise<unknown[]>;
  fetchArticles?(): Promise<unknown[]>;
}

function fixtureQuote(id: string, header: QuoteHeader, inputs: PositionInput[]): OffertenQuote {
  const positions = inputs.map((input, index) => ({
    id: `${id}-position-${index + 1}`, description: input.description,
    quantity: input.quantity, unit: input.unit, unitPrice: input.unitPrice ?? null, proposedUnitPrice: input.unitPrice ?? null,
    handPrice: null, reason: safeReason('past-position'), sourceQuoteId: id,
  }));
  const internal = completeInternalSheet(positions, {
    generated: true as const,
    positions: inputs.map((input, index) => ({
      positionId: positions[index]!.id,
      cost: input.cost,
      margin: input.cost === null || input.unitPrice == null ? null : input.unitPrice - input.cost,
      lineCost: null, lineRevenue: null, lineMargin: null,
      commentary: '',
    })),
    notes: ['Generated fixture; not a live ERP observation.'],
    totalCost: null, totalRevenue: null, totalMargin: null,
  });
  const quote = {
    id, revision: 1, header, positions, internal, generated: true as const,
    createdAt: `${header.date}T12:00:00.000Z`, updatedAt: `${header.date}T12:00:00.000Z`,
    sentRevision: 1,
  };
  return OffertenQuoteSchema.parse({ ...quote, documents: { customer: customerDocument(quote), internal } });
}

const quotes = [
  fixtureQuote('fixture-maintenance-001', {
    customer: 'Fixture Customer', site: 'Zurich', date: '2026-01-15', currency: 'CHF',
    vatRate: 8.1, language: 'de', status: 'accepted',
  }, [
    { description: 'Maintenance cleaning', quantity: 10, unit: 'hour', unitPrice: 6500, cost: 4200, handPrice: null, sourceQuoteId: null },
    { description: 'Window cleaning', quantity: 20, unit: 'm²', unitPrice: 850, cost: 500, handPrice: null, sourceQuoteId: null },
  ]),
  fixtureQuote('fixture-deep-clean-002', {
    customer: 'Fixture Customer', site: 'Bern', date: '2026-02-01', currency: 'CHF',
    vatRate: 8.1, language: 'de', status: 'sent',
  }, [
    { description: 'Deep cleaning', quantity: 8, unit: 'hour', unitPrice: 7900, cost: 5100, handPrice: null, sourceQuoteId: null },
  ]),
];

export function fixtureAdapter(config?: ConnectorConfig): OffertenAdapter {
  if (config && config.type !== 'fixture') throw new Error('Only the fixture connector is implemented. No live ERP connection was made.');
  return {
    kind: 'fixture',
    async listQuotesSince(since) {
      return quotes.filter((quote) => since === null || quote.updatedAt > since).map((quote) => quote.id);
    },
    async fetchQuote(id) {
      const quote = quotes.find((entry) => entry.id === id);
      if (!quote) throw new Error('Fixture quote not found.');
      return structuredClone(quote);
    },
    async fetchCostMasters() {
      return [{ description: 'Special cleaning', unit: 'hour', currency: 'CHF', cost: 6000, effectiveAt: '2026-01-01T00:00:00.000Z', generated: true }];
    },
    async fetchArticles() { return [{ id: 'fixture-cleaning', description: 'Maintenance cleaning', generated: true }]; },
  };
}
