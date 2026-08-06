/**
 * Creative Studio and the AI Product Factory.
 *
 * Both take a founder's intent and produce a *structured plan* rather than a wall
 * of prose. In V1 nothing calls an image or video model: the Studio produces real
 * briefs, real specifications and clearly-labelled placeholder renders, so the
 * pipeline is genuine and only the final pixel-generation step is pending.
 */

import type { ScopedRecord } from './work';

/* ------------------------------------------------------ creative studio --- */

export const ASSET_KINDS = [
  'image',
  'video',
  'ad',
  'presentation',
  'logo',
  'website',
  'app',
  'ui-design',
  'product-photo',
  'marketing-asset',
  'social-post',
] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

export const ASSET_STATUSES = ['brief', 'generating', 'draft', 'approved', 'published'] as const;
export type AssetStatus = (typeof ASSET_STATUSES)[number];

/**
 * A creative brief. This is the reusable unit — the same brief shape feeds a
 * social post, an ad and a presentation, and carries the space's Brand DNA so
 * output stays on-brand without the founder restating it every time.
 */
export interface CreativeBrief extends ScopedRecord {
  readonly title: string;
  readonly objective: string;
  readonly audience: string;
  readonly keyMessage: string;
  readonly mustInclude: readonly string[];
  readonly mustAvoid: readonly string[];
  readonly formats: readonly AssetKind[];
  readonly toneOverride?: string;
  readonly channel?: string;
}

export interface CreativeAsset extends ScopedRecord {
  readonly title: string;
  readonly kind: AssetKind;
  readonly status: AssetStatus;
  readonly briefId?: string;
  readonly prompt: string;
  /** Deterministic placeholder art. Replaced by a real render when a provider is set. */
  readonly previewSeed: string;
  readonly aspect: '1:1' | '4:5' | '16:9' | '9:16' | '3:2';
  readonly copy?: string;
  readonly notes?: string;
  readonly generatedBy: string;
  readonly simulated: boolean;
}

/* ------------------------------------------------------- product factory -- */

export const PRODUCT_PLAN_SECTIONS = [
  'requirements',
  'ux',
  'ui',
  'backend',
  'frontend',
  'database',
  'api',
  'documentation',
  'testing',
  'deployment',
  'marketing',
  'launch',
] as const;
export type ProductPlanSection = (typeof PRODUCT_PLAN_SECTIONS)[number];

export interface ProductPlanBlock {
  readonly section: ProductPlanSection;
  readonly heading: string;
  readonly bullets: readonly string[];
  readonly specialistId: string;
}

export interface ProductSpec extends ScopedRecord {
  readonly name: string;
  readonly idea: string;
  readonly problem: string;
  readonly audience: string;
  readonly status: 'drafting' | 'planned' | 'building' | 'launched' | 'parked';
  readonly blocks: readonly ProductPlanBlock[];
  readonly openQuestions: readonly string[];
  readonly simulated: boolean;
}
