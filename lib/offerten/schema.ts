/**
 * Offerten is deliberately a company-local, generated fixture workflow.
 * Customer documents and the internal calculation sheet have disjoint schemas:
 * projecting a customer document is an allowlist, never deleting secret fields.
 */
import { z } from 'zod';
import type { CompanyScope } from '@/lib/domain';

const text = z.string().trim().min(1).max(500);
const money = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const date = z.iso.date();
const timestamp = z.iso.datetime();
const nullableMoney = money.nullable();
const placeholder = z.string().regex(/^\{\{secret:[A-Za-z0-9_-]+\}\}$/);

export const ConnectorConfigSchema = z.object({
  host: z.string().regex(/^[A-Za-z0-9.-]+(?::\d{1,5})?$/).default('fixture.local'),
  type: z.enum(['fixture', 'postgres', 'mysql', 'mssql', 'sqlite']).default('fixture'),
  mapping: z.record(z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/), text).default({}),
  secrets: z.record(z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/), placeholder).default({}),
}).strict();
export type ConnectorConfig = z.infer<typeof ConnectorConfigSchema>;

export const QuoteHeaderSchema = z.object({
  customer: text.nullable().default(null),
  site: text.nullable().default(null),
  date: date.nullable().default(null),
  currency: z.enum(['CHF', 'EUR', 'USD', 'GBP']).nullable().default(null),
  vatRate: z.number().min(0).max(100).nullable().default(null),
  language: z.enum(['de', 'en', 'fr', 'it']).nullable().default(null),
  status: z.enum(['draft', 'approved', 'sent', 'accepted', 'rejected']).default('draft'),
}).strict();
export type QuoteHeader = z.infer<typeof QuoteHeaderSchema>;

export const PositionInputSchema = z.object({
  id: text.optional(),
  description: text,
  quantity: z.number().positive().max(1e9).nullable().default(null),
  unit: text.nullable().default(null),
  unitPrice: nullableMoney.optional(),
  cost: nullableMoney.default(null),
  handPrice: nullableMoney.default(null),
  sourceQuoteId: text.nullable().default(null),
}).strict();
export type PositionInput = z.infer<typeof PositionInputSchema>;

export const PRICE_REASON_TEXT = {
  'past-position': 'Price follows an exact comparable position.',
  'explicit-rule': 'Price follows an established pricing rule.',
  cost: 'Price is a provisional calculation requiring owner review.',
  'owner-number': "Unknown price — needs the owner's number.",
  'owner-edited': 'Price reviewed by the owner.',
  provisional: 'Provisional price requiring owner review.',
} as const;
export const PriceReasonSchema = z.object({
  code: z.enum(['past-position', 'explicit-rule', 'cost', 'owner-number', 'owner-edited', 'provisional']),
  text: z.string().max(1000),
  source: z.object({
    kind: z.enum(['position', 'rule', 'cost', 'owner']),
    id: z.string().max(80),
    positionId: z.string().max(80).optional(),
  }).strict().nullable().default(null),
  appliesBecause: z.string().max(1000).default(''),
  nearestComparableDelta: z.number().int().nullable().default(null),
}).strict();
export type PriceReason = z.infer<typeof PriceReasonSchema>;

export const OffertenPositionSchema = z.object({
  id: text,
  description: text,
  quantity: z.number().positive().nullable(),
  unit: text.nullable(),
  unitPrice: nullableMoney,
  proposedUnitPrice: nullableMoney.default(null),
  handPrice: nullableMoney,
  reason: PriceReasonSchema,
  sourceQuoteId: text.nullable(),
}).strict();
export type OffertenPosition = z.infer<typeof OffertenPositionSchema>;

export const CustomerDocumentSchema = z.object({
  generated: z.literal(true),
  quoteId: text,
  revision: z.number().int().positive(),
  header: QuoteHeaderSchema,
  positions: z.array(z.object({
    id: text,
    description: text,
    quantity: z.number().positive().nullable(),
    unit: text.nullable(),
    unitPrice: nullableMoney,
    total: nullableMoney,
    reason: PriceReasonSchema,
  }).strict()),
  subtotal: nullableMoney,
  vat: nullableMoney,
  total: nullableMoney,
}).strict();
export type CustomerDocument = z.infer<typeof CustomerDocumentSchema>;

export const InternalSheetSchema = z.object({
  generated: z.literal(true),
  positions: z.array(z.object({
    positionId: text,
    cost: nullableMoney,
    margin: z.number().int().nullable(),
    lineCost: nullableMoney.default(null),
    lineRevenue: nullableMoney.default(null),
    lineMargin: z.number().int().nullable().default(null),
    commentary: z.string().max(3000),
  }).strict()),
  notes: z.array(z.string().max(3000)),
  totalCost: nullableMoney.default(null),
  totalRevenue: nullableMoney.default(null),
  totalMargin: z.number().int().nullable().default(null),
}).strict();
export type InternalSheet = z.infer<typeof InternalSheetSchema>;

export const OffertenQuoteSchema = z.object({
  id: text,
  revision: z.number().int().positive(),
  header: QuoteHeaderSchema,
  positions: z.array(OffertenPositionSchema).min(1).max(200),
  internal: InternalSheetSchema,
  generated: z.literal(true),
  createdAt: timestamp,
  updatedAt: timestamp,
  documents: z.object({ customer: CustomerDocumentSchema, internal: InternalSheetSchema }).strict(),
  sentRevision: z.number().int().positive().nullable(),
  manualBaselineMinutes: z.number().positive().nullable().default(null),
  intakeMinutes: z.number().nonnegative().nullable().default(null),
}).strict().superRefine((quote, ctx) => {
  const ids = new Set(quote.positions.map((position) => position.id));
  if (ids.size !== quote.positions.length) {
    ctx.addIssue({ code: 'custom', message: 'Duplicate position ids.', path: ['positions'] });
  }
  const internalIds = quote.internal.positions.map((position) => position.positionId);
  if (new Set(internalIds).size !== internalIds.length || internalIds.some((id) => !ids.has(id))) {
    ctx.addIssue({ code: 'custom', message: 'Internal sheet has duplicate or unknown position links.', path: ['internal', 'positions'] });
  }
});
export type OffertenQuote = z.infer<typeof OffertenQuoteSchema>;

export const IngestReceiptSchema = z.object({
  id: text,
  generated: z.literal(true),
  adapter: z.literal('fixture'),
  quoteIds: z.array(text),
  quoteCount: z.number().int().nonnegative(),
  positionCount: z.number().int().nonnegative(),
  at: timestamp,
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  verified: z.literal(true),
}).strict();
export type IngestReceipt = z.infer<typeof IngestReceiptSchema>;

export const OffertenRuleSchema = z.object({
  id: text,
  tag: text,
  fact: z.string().trim().min(1).max(3000),
  established: timestamp,
  expires: timestamp,
  source: text,
  pricing: z.object({
    description: text,
    unit: text.nullable(),
    currency: z.enum(['CHF', 'EUR', 'USD', 'GBP']),
    unitPrice: money,
    customer: text.nullable().default(null),
    site: text.nullable().default(null),
  }).strict().optional(),
}).strict();
export type OffertenRule = z.infer<typeof OffertenRuleSchema>;

export const OffertenEditSchema = z.object({
  expectedRevision: z.number().int().positive(),
  header: QuoteHeaderSchema.partial().optional(),
  manualBaselineMinutes: z.number().positive().nullable().optional(),
  positions: z.array(z.object({
    id: text,
    unitPrice: nullableMoney.optional(),
    quantity: z.number().positive().nullable().optional(),
    handPrice: nullableMoney.optional(),
    reason: PriceReasonSchema.optional(),
  }).strict()).max(200).default([]),
}).strict();
export type OffertenEdit = z.infer<typeof OffertenEditSchema>;

export interface OffertenAudit {
  id: string;
  at: string;
  event: 'ingest' | 'draft' | 'edit' | 'send-fixture' | 'memory-update' | 'expiry';
  quoteId: string | null;
  detail: string;
}

export interface OffertenSendReceipt {
  id: string;
  quoteId: string;
  revision: number;
  callId: string;
  decidedAt: string;
  decidedBy: string;
  documentHash: string;
  document: CustomerDocument;
  at: string;
  generated: true;
}

export interface OffertenMetrics {
  observationCount: number | null;
  acceptanceRate: number | null;
  timeSavedMinutes: number | null;
  priceDeviation: number | null;
  approvedAsDrafted: number | null;
  approvedEdited: number | null;
  rejected: number | null;
  relativePriceDeviation: number | null;
  handComparisonCount: number | null;
  handDeviationDistribution: { n: number; median: number; p90: number } | null;
}

export interface OffertenObservation {
  id: string;
  quoteId: string;
  revision: number;
  at: string;
  decision: 'approved-as-drafted' | 'approved-edited' | 'rejected';
  positions: {
    positionId: string; proposed: number | null; final: number | null;
    deviation: number | null; relativeDeviation: number | null;
    handPrice: number | null; handDeviation: number | null; handRelativeDeviation: number | null;
  }[];
  quoteDeviation: number | null;
  quoteRelativeDeviation: number | null;
  quoteHandDeviation: number | null;
  quoteHandRelativeDeviation: number | null;
  baselineMinutes: number | null;
  intakeMinutes: number | null;
  currency: QuoteHeader['currency'];
  generated: true;
}

export const CostMasterSchema = z.object({
  description: text,
  unit: text.nullable(),
  currency: z.enum(['CHF', 'EUR', 'USD', 'GBP']),
  cost: money,
  effectiveAt: timestamp,
  generated: z.literal(true),
}).strict();
export type CostMaster = z.infer<typeof CostMasterSchema>;

export interface OffertenState {
  id: string;
  scope: CompanyScope;
  generated: true;
  connector: ConnectorConfig;
  quotes: OffertenQuote[];
  catalogue: OffertenQuote[];
  receipts: IngestReceipt[];
  sends: OffertenSendReceipt[];
  rules: OffertenRule[];
  audit: OffertenAudit[];
  metrics: OffertenMetrics;
  memoryHash: string | null;
  observations: OffertenObservation[];
  memoryRetentionDays: number;
  costMasters: CostMaster[];
}

export interface OffertenExport {
  generated: true;
  state: OffertenState;
  memoryMarkdown: string;
  records: Record<string, unknown[]>;
  sha256: string;
}

export interface ComparableDelta {
  quoteId: string;
  positionId: string;
  unitPrice: number | null;
  delta: number | null;
  quantityDelta: number | null;
}

export interface OffertenComparison {
  quoteId: string;
  revision: number;
  positions: {
    positionId: string;
    unitPrice: number | null;
    handPrice: number | null;
    delta: number | null;
    nearestComparables: ComparableDelta[];
  }[];
  totalDelta: number | null;
}
