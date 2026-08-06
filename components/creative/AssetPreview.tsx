/**
 * Deterministic placeholder art.
 *
 * Not a stock image and not a grey box: a generated composition seeded by the
 * asset id, so the library reads as a library while making it obvious that no
 * image model has run. Real renders replace this the moment a provider is set.
 *
 * Shared by the Creative Studio and the `assets` capability panel — one drawing,
 * so an asset looks identical wherever it appears in the OS.
 */

import type { CreativeAsset } from '@/lib/domain';
import { hash32 } from '@/lib/domain';

/** Width ÷ height. Drives the tile's aspect-ratio so the grid keeps its rhythm. */
const RATIOS: Record<CreativeAsset['aspect'], number> = {
  '1:1': 1,
  '4:5': 0.8,
  '16:9': 1.777,
  '9:16': 0.5625,
  '3:2': 1.5,
};

export function AssetPreview({
  seed,
  aspect,
}: {
  seed: string;
  aspect: CreativeAsset['aspect'];
}) {
  // FNV-1a, the same hash the id suffixes and space tints use: two assets with the
  // same seed must draw identically forever, including across deploys.
  let h = hash32(seed);
  const bars = Array.from({ length: 7 }, (_, i) => {
    h = Math.imul(h ^ (i + 1), 2654435761) >>> 0;
    return 12 + (h % 76);
  });

  return (
    <div className="asset-preview" style={{ aspectRatio: String(RATIOS[aspect]) }} aria-hidden="true">
      <svg viewBox="0 0 100 60" preserveAspectRatio="none">
        {bars.map((value, i) => (
          <rect
            key={i}
            x={i * 14.3 + 1}
            y={60 - value * 0.6}
            width="12"
            height={value * 0.6}
            rx="1"
            opacity={0.14 + (i % 3) * 0.07}
          />
        ))}
      </svg>
    </div>
  );
}
