import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Tests assert against registry data that lives beside JSX (the icon set), so
  // the transform needs the automatic runtime even though nothing here renders.
  esbuild: { jsx: 'automatic' },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./', import.meta.url)),
      /**
       * `server-only` throws on import outside a React Server Component, which
       * is the whole point of the marker — it stops server modules being pulled
       * into a client bundle. Vitest is neither, so it resolves to an empty
       * module here. Without this, anything reachable from the store or the
       * secret vault is untestable, which is exactly the code most worth testing.
       */
      'server-only': fileURLToPath(new URL('./tests/stubs/server-only.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    reporters: 'default',
  },
});
