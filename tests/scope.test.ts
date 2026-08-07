import { describe, expect, it } from 'vitest';

import {
  canRead,
  companyScope,
  parseScopeKey,
  personalScope,
  promotionCheck,
  readableScopes,
  scopeKey,
  scopesEqual,
  sharedScope,
} from '@/lib/domain/scope';

describe('scope keys', () => {
  it('round-trips through parseScopeKey', () => {
    const scopes = [companyScope('meridian-build-a1b2'), personalScope(), sharedScope('finance')];
    for (const scope of scopes) {
      expect(parseScopeKey(scopeKey(scope))).toEqual(scope);
    }
  });

  it('rejects malformed keys', () => {
    expect(parseScopeKey('company:')).toBeNull();
    expect(parseScopeKey('nonsense')).toBeNull();
    expect(parseScopeKey('')).toBeNull();
  });

  it('gives different companies different keys', () => {
    expect(scopesEqual(companyScope('a'), companyScope('b'))).toBe(false);
    expect(scopesEqual(companyScope('a'), companyScope('a'))).toBe(true);
  });
});

describe('read permissions', () => {
  const a = companyScope('alpha');
  const b = companyScope('beta');

  it('never lets one company read another', () => {
    expect(canRead(a, b)).toBe(false);
    expect(canRead(b, a)).toBe(false);
  });

  it('never lets a company read personal life', () => {
    expect(canRead(a, personalScope())).toBe(false);
  });

  it('never lets personal life read a company scope directly', () => {
    expect(canRead(personalScope(), a)).toBe(false);
  });

  it('lets any space read shared capability knowledge', () => {
    expect(canRead(a, sharedScope('marketing'))).toBe(true);
    expect(canRead(personalScope(), sharedScope('marketing'))).toBe(true);
  });

  it('does not let shared knowledge reach back into a space', () => {
    expect(canRead(sharedScope('marketing'), a)).toBe(false);
    expect(canRead(sharedScope('marketing'), personalScope())).toBe(false);
  });

  it('offers exactly own-scope plus shared scopes', () => {
    const scopes = readableScopes(a, ['marketing', 'finance']);
    expect(scopes).toHaveLength(3);
    expect(scopes.filter((s) => s.kind === 'company')).toHaveLength(1);
    expect(scopes.every((s) => s.kind !== 'personal')).toBe(true);
  });
});

describe('promotion into shared capability memory', () => {
  it('allows a genuinely generalised lesson', () => {
    const verdict = promotionCheck(
      'An unpriced offer stalls conversations before they reach a quote.',
      ['Meridian Build'],
    );
    expect(verdict.allowed).toBe(true);
    expect(verdict.violations).toEqual([]);
  });

  it('blocks text naming the source scope', () => {
    const verdict = promotionCheck('Meridian Build closes faster when the price is public.', [
      'Meridian Build',
    ]);
    expect(verdict.allowed).toBe(false);
    expect(verdict.violations.join(' ')).toContain('Meridian Build');
  });

  it('blocks email addresses', () => {
    expect(promotionCheck('Ask a.brunner@example.com to confirm.').allowed).toBe(false);
  });

  it('blocks monetary amounts', () => {
    expect(promotionCheck('The deal closed at CHF 42,000.').allowed).toBe(false);
    expect(promotionCheck('Charged €1 200 for the audit.').allowed).toBe(false);
  });

  it('blocks phone numbers, IBANs, wallets and credential-shaped tokens', () => {
    expect(promotionCheck('Call +41 79 123 45 67 first.').allowed).toBe(false);
    expect(promotionCheck('Paid to CH9300762011623852957.').allowed).toBe(false);
    expect(promotionCheck('Sent to 0x52908400098527886E0F7030069857D2E4169EE7.').allowed).toBe(false);
    expect(promotionCheck('Key sk-abcdefghijklmnop leaked.').allowed).toBe(false);
  });

  it('ignores forbidden terms shorter than three characters', () => {
    expect(promotionCheck('A general lesson about pricing.', ['a']).allowed).toBe(true);
  });

  it('reports every violation, not just the first', () => {
    const verdict = promotionCheck('Mail a.b@c.io about the CHF 900 invoice.');
    expect(verdict.violations.length).toBeGreaterThanOrEqual(2);
  });
});
