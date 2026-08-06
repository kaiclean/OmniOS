/**
 * Identifier helpers.
 *
 * Ids are human-readable slugs with a short stable suffix. Readability matters
 * here because ids appear in URLs (`/companies/all-rueckbau-24-7f3a`) and in the
 * space-tint hash — a founder should be able to read a URL and know where they are.
 */

const SUFFIX_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

export function slugify(input: string): string {
  return input
    .replace(/ß/g, 'ss')
    .normalize('NFKD')
    // strip combining diacritical marks left behind by NFKD (ü -> u, é -> e)
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

/**
 * Deterministic 32-bit string hash (FNV-1a).
 *
 * Used for both id suffixes and space tint hues. It must stay stable forever:
 * changing it would re-colour every existing space.
 */
export function hash32(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function shortSuffix(seed: string): string {
  let h = hash32(seed);
  let out = '';
  for (let i = 0; i < 4; i += 1) {
    out += SUFFIX_ALPHABET[h % SUFFIX_ALPHABET.length];
    h = Math.floor(h / SUFFIX_ALPHABET.length) + 7;
  }
  return out;
}

/** A readable, collision-resistant id: `acme-robotics-k2p9`. */
export function makeId(name: string, seed: string = name): string {
  const base = slugify(name) || 'item';
  return `${base}-${shortSuffix(`${base}:${seed}`)}`;
}

/** An opaque id for records with no natural name (log lines, runs, messages). */
export function makeRecordId(prefix: string, seed: string): string {
  return `${prefix}_${hash32(seed).toString(36)}${shortSuffix(seed)}`;
}
