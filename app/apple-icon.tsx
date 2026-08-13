import { ImageResponse } from 'next/og';

/**
 * The Home Screen icon iOS actually uses — it ignores manifest icons entirely
 * and wants a 180×180 PNG. Rendered from the same aperture mark as
 * `app/icon.svg`, with no rounding: iOS applies its own mask.
 */
export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#0b0b0c',
        }}
      >
        <div
          style={{
            width: 106,
            height: 106,
            borderRadius: 9999,
            border: '9px solid rgba(143, 146, 245, 0.45)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div style={{ width: 40, height: 40, borderRadius: 9999, background: '#8f92f5' }} />
        </div>
      </div>
    ),
    size,
  );
}
