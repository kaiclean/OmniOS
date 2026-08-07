/**
 * Space tint.
 *
 * Every space owns a hue, derived deterministically from its id. Entering a
 * company re-tints the shell — accent, active markers, metric rails, the seam —
 * so a founder knows which world they are in before reading a single word.
 *
 * Two guardrails make this safe rather than decorative:
 *
 * 1. Only the *hue* varies. Lightness and chroma are fixed in tokens.css, so
 *    every space's accent carries identical contrast. No company can mint an
 *    illegible identity.
 * 2. The hue is a pure function of the id, so it never shifts when companies are
 *    added, renamed or removed.
 */

import { hash32 } from '@/lib/domain/ids';

/** The OS's own hue, used at root level where no space is active. */
export const OS_HUE = 258;

/** Personal life is fixed and warm — it must never read as "just another company". */
export const PERSONAL_HUE = 32;

/**
 * Hues reserved by the semantic palette (ok / warn / deny / info). A company hue
 * landing on top of one of these would make "on track" and "this company" the
 * same colour, so those bands are skipped.
 */
const RESERVED: ReadonlyArray<readonly [number, number]> = [
  [12, 40], // deny — red
  [62, 92], // warn — amber
  [140, 168], // ok — green
];

function isReserved(hue: number): boolean {
  return RESERVED.some(([lo, hi]) => hue >= lo && hue <= hi);
}

/** Deterministic, stable, and never inside a reserved band. */
export function hueForSpaceKey(spaceKey: string): number {
  if (spaceKey === 'personal') return PERSONAL_HUE;
  if (!spaceKey || spaceKey === 'os') return OS_HUE;

  let hue = hash32(spaceKey) % 360;
  // Walk out of a reserved band rather than rejecting and re-hashing, so the
  // result stays a pure function of the key.
  for (let step = 0; step < 360 && isReserved(hue); step += 1) {
    hue = (hue + 7) % 360;
  }
  return hue;
}

export function hueForCompany(companyId: string): number {
  return hueForSpaceKey(`company:${companyId}`);
}

/** The inline style the shell applies. One custom property drives everything. */
export function tintStyle(hue: number): { ['--space-hue']: string } {
  return { '--space-hue': String(hue) };
}

/**
 * A standalone colour in the same family, for dots and swatches that sit outside
 * an element carrying the tint variable.
 */
export function hueColor(hue: number, lightness = 0.76, chroma = 0.126): string {
  return `oklch(${lightness} ${chroma} ${hue})`;
}
