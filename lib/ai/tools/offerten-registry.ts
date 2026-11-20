/**
 * Local Offerten tools use the ordinary gate; previews deliberately never
 * interpolate customer input, source material, rules or connector settings.
 */
import type { ToolArgs, ToolDefinition } from '@/lib/domain';

const COMPANY = ['company'] as const;
const quoteId = (args: ToolArgs): string =>
  typeof args.quoteId === 'string' && /^[a-zA-Z0-9_-]{1,120}$/.test(args.quoteId) ? args.quoteId : '—';

export const OFFERTEN_TOOLS = [
  {
    id: 'offerten.ingest', label: 'Ingest Offerten fixture',
    description: 'Read an explicitly labelled local fixture into the scoped Offerten catalogue. No live connector is implemented.',
    risk: 'external', capabilityId: 'offerten', scopeKinds: COMPANY,
    matches: ['ingest offerten', 'import offerten', 'read offerte fixture'],
    params: [{ name: 'fixture', type: 'string', description: 'Local fixture identifier only.', required: false, default: 'demo' }],
    preview: () => 'Ingest the labelled local Offerten fixture into this company. This needs your approval. No live connector or outward request runs.',
  },
  {
    id: 'offerten.draft', label: 'Draft an Offerte',
    description: 'Generate a local Offerte from scoped comparable positions, explicit rules and owner-supplied quantities. Private source material is never sent to a model.',
    risk: 'write', capabilityId: 'offerten', scopeKinds: COMPANY,
    matches: ['draft offerte', 'create offerte', 'new quotation', 'offerte erstellen'],
    params: [
      { name: 'customer', type: 'string', description: 'Customer name.', required: true },
      { name: 'site', type: 'string', description: 'Site or project.', required: false },
      { name: 'date', type: 'date', description: 'Quote date.', required: false },
      { name: 'currency', type: 'enum', description: 'Quote currency.', required: false, enumValues: ['CHF', 'EUR', 'USD', 'GBP'], default: 'CHF' },
      { name: 'vatRate', type: 'number', description: 'Explicit VAT rate; absent remains unknown.', required: false },
      { name: 'language', type: 'string', description: 'Document language.', required: false, default: 'de' },
      { name: 'manualBaselineMinutes', type: 'number', description: 'Explicit measured manual baseline, in minutes. Omit when unknown.', required: false },
      { name: 'positions', type: 'text', description: 'JSON array of positions with description, quantity, unit and optional cost or handPrice. Kept local.', required: true, maxLength: 512000 },
    ],
    preview: () => 'Generate a labelled local Offerte draft in this company. Nothing is sent and no catalogue feedback is applied.',
  },
  {
    id: 'offerten.compare', label: 'Compare an Offerte',
    description: 'Compute local comparison against hand-calculated prices. Private comparison details remain in the Offerten review screen.',
    risk: 'read', capabilityId: 'offerten', scopeKinds: COMPANY, matches: ['compare offerte', 'offerte comparison'],
    params: [{ name: 'quoteId', type: 'string', description: 'Quote in this company.', required: true }],
    preview: (args: ToolArgs) => `Compute the local comparison for Offerte ${quoteId(args)}.`,
  },
  {
    id: 'offerten.edit', label: 'Revise an Offerte',
    description: 'Apply owner edits as a new immutable local revision. Prior approvals never authorise the new revision.',
    risk: 'write', capabilityId: 'offerten', scopeKinds: COMPANY, matches: ['edit offerte', 'revise offerte'],
    params: [
      { name: 'quoteId', type: 'string', description: 'Quote in this company.', required: true },
      { name: 'edits', type: 'text', description: 'JSON object with header and/or positions edits. Kept local.', required: true, maxLength: 512000 },
    ],
    preview: (args: ToolArgs) => `Create a new local revision of Offerte ${quoteId(args)}. A send requires a fresh revision-bound approval.`,
  },
  {
    id: 'offerten.send', label: 'Approve Offerte send',
    description: 'Record a labelled fixture send receipt for one exact quote revision after persisted human approval. No live delivery is implemented.',
    risk: 'external', capabilityId: 'offerten', scopeKinds: COMPANY, matches: ['send offerte', 'offerte senden'],
    params: [
      { name: 'quoteId', type: 'string', description: 'Exact quote identifier.', required: true },
      { name: 'revision', type: 'number', description: 'Exact immutable revision being approved.', required: true },
    ],
    preview: (args: ToolArgs) => `Offerte ${quoteId(args)}, revision ${typeof args.revision === 'number' && Number.isSafeInteger(args.revision) ? args.revision : '—'} needs your approval: record a generated customer-only local fixture package, then update company-private feedback after persisted read-back. No internal calculation sheet is included. No live delivery runs.`,
  },
  {
    id: 'offerten.update_memory', label: 'Update Offerten memory',
    description: 'Derive local-only catalogue feedback from a quote with a recorded owner-approved package, after reading the persisted quote back.',
    risk: 'write', capabilityId: 'offerten', scopeKinds: COMPANY, matches: ['update offerten memory'],
    params: [{ name: 'quoteId', type: 'string', description: 'Previously approved quote in this company.', required: true }],
    preview: (args: ToolArgs) => `Update local-only Offerten feedback from the persisted approved Offerte ${quoteId(args)}.`,
  },
  {
    id: 'offerten.export', label: 'Prepare Offerten export',
    description: 'Prepare the complete private export locally; download it only through the scoped Offerten screen. No export contents enter assistant context.',
    risk: 'write', capabilityId: 'offerten', scopeKinds: COMPANY, matches: ['export offerten'],
    params: [], preview: () => 'Prepare this company’s private Offerten export locally. Nothing is uploaded or placed in assistant context.',
  },
  {
    id: 'offerten.delete', label: 'Delete Offerten data',
    description: 'Delete this company’s Offerten source data, drafts, derived memory and private audit payloads while retaining decision metadata.',
    risk: 'destructive', capabilityId: 'offerten', scopeKinds: COMPANY, matches: ['delete offerten', 'erase offerten'],
    params: [], preview: () => 'Permanently delete this company’s Offerten data and derived private copies. This cannot be undone. Human decision metadata is retained.',
  },
] as const satisfies readonly ToolDefinition[];
