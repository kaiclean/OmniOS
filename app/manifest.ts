import type { MetadataRoute } from 'next';

/**
 * What lets an iPhone install OmniOS as a standalone app: Share → Add to Home
 * Screen. iOS takes its icon from `app/apple-icon.tsx`; the SVGs here serve
 * every other platform. Colours match the dark canvas so the launch frame
 * never flashes white.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'OmniOS',
    short_name: 'OmniOS',
    description: 'Every company and your life, one operating system.',
    start_url: '/',
    display: 'standalone',
    background_color: '#0b0b0c',
    theme_color: '#0b0b0c',
    icons: [
      { src: '/icons/app.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
      { src: '/icons/app-maskable.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
    ],
  };
}
