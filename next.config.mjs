/**
 * Response headers for every route. Deliberately limited to headers that cannot
 * change how the app renders: the Content-Security-Policy carries no script or
 * default source, because Next emits inline bootstrap scripts and a policy
 * without nonces would block them.
 * `frame-ancestors` is the modern form of X-Frame-Options; both are sent so older
 * browsers are covered. Exported so tests/security-headers.test.ts can pin them.
 */
export const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
  typescript: {
    // Type errors fail the build. `npm run verify` also runs tsc first, so a
    // type error surfaces before the slowest step rather than inside it.
    ignoreBuildErrors: false,
  },
};

export default nextConfig;
