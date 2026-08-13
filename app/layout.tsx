import type { Metadata, Viewport } from 'next';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';

import { getWorkspace } from '@/lib/data/store';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'OmniOS',
    template: '%s · OmniOS',
  },
  description:
    'An operating system for a founder: companies, capabilities and private life in one place, with one AI Executive Assistant across all of it.',
  applicationName: 'OmniOS',
  robots: { index: false, follow: false },
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'OmniOS',
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#0b0b0c' },
    { media: '(prefers-color-scheme: light)', color: '#fbfbfa' },
  ],
  width: 'device-width',
  initialScale: 1,
  // Lets the app paint under the iPhone's notch and home indicator; the
  // safe-area insets in the stylesheets keep content out of both.
  viewportFit: 'cover',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const workspace = await getWorkspace();
  const { theme, reduceMotion, spaceTint } = workspace.settings;

  return (
    <html
      lang="en"
      data-theme={theme}
      data-motion={reduceMotion ? 'reduced' : 'full'}
      data-tint={spaceTint ? 'on' : 'off'}
      className={`${GeistSans.variable} ${GeistMono.variable}`}
      suppressHydrationWarning
    >
      {/* Browser extensions (Monica, Grammarly, password managers) stamp their
          own attributes onto <body> before React hydrates, which is outside
          this app's control and harmless — suppressing here silences exactly
          that class of mismatch without hiding real ones deeper in the tree. */}
      <body suppressHydrationWarning>
        <a className="skip-link" href="#work">
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
