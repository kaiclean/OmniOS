/**
 * Stands in for the `server-only` marker package under vitest.
 *
 * The real module throws on import so that a server module pulled into a client
 * bundle fails loudly at build time. Under test there is no bundle and no client,
 * so the guard has nothing to protect and would only make the store and the
 * secret vault — the code most worth testing — impossible to test.
 */

export {};
