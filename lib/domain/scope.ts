/**
 * Scope — the structural boundary between a founder's companies, their private
 * life, and the reusable knowledge that is allowed to travel between them.
 *
 * This is the single most important type in OmniOS. Every stored record carries
 * a scope, and the store API takes a scope on *every* read and write. There is
 * deliberately no "read everything" call: cross-contamination has to be written
 * on purpose, it cannot happen by forgetting a filter.
 */

export const SPACE_KINDS = ['company', 'personal', 'shared'] as const;
export type SpaceKind = (typeof SPACE_KINDS)[number];

/** A company workspace. Isolated from every other company and from personal life. */
export interface CompanyScope {
  readonly kind: 'company';
  readonly companyId: string;
}

/** The founder's private life. Never readable from a company scope. */
export interface PersonalScope {
  readonly kind: 'personal';
}

/**
 * Capability-level knowledge that has been deliberately generalised and stripped
 * of identifying detail. This is the only scope both companies and personal life
 * may read from — and nothing lands here without passing {@link promotionCheck}.
 */
export interface SharedScope {
  readonly kind: 'shared';
  readonly capabilityId: string;
}

export type Scope = CompanyScope | PersonalScope | SharedScope;

export const companyScope = (companyId: string): CompanyScope => ({ kind: 'company', companyId });
export const personalScope = (): PersonalScope => ({ kind: 'personal' });
export const sharedScope = (capabilityId: string): SharedScope => ({ kind: 'shared', capabilityId });

/** Stable string form used as a storage partition key and a React key. */
export function scopeKey(scope: Scope): string {
  switch (scope.kind) {
    case 'company':
      return `company:${scope.companyId}`;
    case 'personal':
      return 'personal';
    case 'shared':
      return `shared:${scope.capabilityId}`;
  }
}

export function parseScopeKey(key: string): Scope | null {
  if (key === 'personal') return personalScope();
  const [kind, ...rest] = key.split(':');
  const id = rest.join(':');
  if (kind === 'company' && id) return companyScope(id);
  if (kind === 'shared' && id) return sharedScope(id);
  return null;
}

export function scopesEqual(a: Scope, b: Scope): boolean {
  return scopeKey(a) === scopeKey(b);
}

/**
 * Which scopes a given scope is allowed to read.
 *
 * A company reads its own records plus shared capability knowledge.
 * Personal life reads its own records plus shared capability knowledge.
 * Nothing reads another company. Nothing reads personal life.
 */
export function readableScopes(from: Scope, capabilityIds: readonly string[]): Scope[] {
  if (from.kind === 'shared') return [from];
  return [from, ...capabilityIds.map(sharedScope)];
}

export function canRead(from: Scope, target: Scope): boolean {
  if (scopesEqual(from, target)) return true;
  return target.kind === 'shared' && from.kind !== 'shared';
}

/** Patterns that must never survive promotion into shared capability memory. */
const IDENTIFYING_PATTERNS: ReadonlyArray<{ readonly label: string; readonly re: RegExp }> = [
  { label: 'email address', re: /[\w.+-]+@[\w-]+\.[\w.]{2,}/ },
  { label: 'IBAN', re: /\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b/ },
  { label: 'phone number', re: /(?:\+|00)\d[\d\s().-]{7,}\d/ },
  { label: 'monetary amount', re: /(?:CHF|EUR|USD|\$|€|£)\s?\d[\d'’,.\s]*/i },
  { label: 'credential-like token', re: /\b(?:sk|pk|ghp|xox[baprs])[-_][A-Za-z0-9]{12,}\b/ },
  { label: 'wallet address', re: /\b(?:0x[a-fA-F0-9]{40}|bc1[a-z0-9]{20,})\b/ },
];

export interface PromotionVerdict {
  readonly allowed: boolean;
  /** Human-readable reasons the promotion was blocked. Empty when allowed. */
  readonly violations: readonly string[];
}

/**
 * Gate for moving a learning from a company or personal scope into shared
 * capability memory.
 *
 * The rule is deliberately conservative: a lesson may generalise, a fact may not.
 * If the text still contains anything that identifies a company, a person, a
 * counterparty or an amount, promotion is refused and the caller must rewrite it.
 */
export function promotionCheck(
  text: string,
  forbiddenTerms: readonly string[] = [],
): PromotionVerdict {
  const violations: string[] = [];
  for (const { label, re } of IDENTIFYING_PATTERNS) {
    if (re.test(text)) violations.push(`contains a(n) ${label}`);
  }
  const haystack = text.toLowerCase();
  for (const term of forbiddenTerms) {
    const needle = term.trim().toLowerCase();
    if (needle.length >= 3 && haystack.includes(needle)) {
      violations.push(`names the source scope ("${term}")`);
    }
  }
  return { allowed: violations.length === 0, violations };
}
