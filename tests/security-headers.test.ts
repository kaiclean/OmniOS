import { fileURLToPath, pathToFileURL } from 'node:url';

import { beforeAll, describe, expect, it } from 'vitest';

interface Header {
  key: string;
  value: string;
}
interface ConfigModule {
  default: { headers(): Promise<{ source: string; headers: Header[] }[]> };
  securityHeaders: Header[];
}

// Loaded by URL because the config is plain JS and the project is `allowJs: false`.
const configUrl = pathToFileURL(fileURLToPath(new URL('../next.config.mjs', import.meta.url))).href;
let nextConfig: ConfigModule['default'];
let securityHeaders: Header[];

beforeAll(async () => {
  const mod = (await import(/* @vite-ignore */ configUrl)) as ConfigModule;
  nextConfig = mod.default;
  securityHeaders = mod.securityHeaders;
});

/**
 * The header set is a contract with the browser, so it is pinned: dropping one
 * should fail here instead of passing silently.
 */
describe('response security headers', () => {
  it('applies the set to every route', async () => {
    const rules = await nextConfig.headers();
    expect(rules).toHaveLength(1);
    expect(rules[0]?.source).toBe('/:path*');
    expect(rules[0]?.headers).toBe(securityHeaders);
  });

  it.each([
    ['X-Content-Type-Options', 'nosniff'],
    ['X-Frame-Options', 'DENY'],
    ['Content-Security-Policy', "frame-ancestors 'none'"],
  ])('sends %s', (key, value) => {
    const found = securityHeaders.find((h) => h.key === key);
    expect(found?.value).toBe(value);
  });

  it('does not send a script policy that would block the framework bootstrap', () => {
    const csp = securityHeaders.find(
      (h) => h.key === 'Content-Security-Policy',
    );
    expect(csp?.value).not.toMatch(/script-src|default-src/);
  });
});
