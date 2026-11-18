/**
 * A sliding-window counter for the login form.
 *
 * In-module state is enough here: the store is single-process by design, so
 * the login action runs in exactly one Node runtime. Ten attempts a minute is
 * generous for a human with a password manager and hopeless for a dictionary.
 */

export const LOGIN_WINDOW_MS = 60_000;
export const LOGIN_MAX_ATTEMPTS = 10;

export function makeLimiter(windowMs = LOGIN_WINDOW_MS, max = LOGIN_MAX_ATTEMPTS) {
  const attempts: number[] = [];
  return {
    /** Records the attempt and says whether it may proceed. */
    allow(now = Date.now()): boolean {
      while (attempts.length > 0 && now - (attempts[0] ?? 0) > windowMs) attempts.shift();
      if (attempts.length >= max) return false;
      attempts.push(now);
      return true;
    },
  };
}

/**
 * Failed-login budgets per client, with a looser ceiling over everyone.
 *
 * One budget shared by all callers meant a stranger's wrong guesses used up the
 * founder's own allowance of typos. Keying by client keeps each caller's budget
 * their own. The ceiling still bounds total guessing if the key a client
 * presents is made up, since a forwarded-for header is only as honest as the
 * proxy that set it.
 */
export const LOGIN_GLOBAL_MAX_ATTEMPTS = 100;
const MAX_TRACKED_CLIENTS = 1000;

export function makeClientLimiter(
  windowMs = LOGIN_WINDOW_MS,
  perClientMax = LOGIN_MAX_ATTEMPTS,
  globalMax = LOGIN_GLOBAL_MAX_ATTEMPTS,
) {
  const clients = new Map<string, number[]>();
  const everyone = makeLimiter(windowMs, globalMax);
  return {
    /** Records a failed attempt by `client` and says whether it may proceed. */
    allow(client: string, now = Date.now()): boolean {
      if (!everyone.allow(now)) return false;
      const attempts = clients.get(client) ?? [];
      while (attempts.length > 0 && now - (attempts[0] ?? 0) > windowMs) attempts.shift();
      if (attempts.length >= perClientMax) {
        clients.set(client, attempts);
        return false;
      }
      attempts.push(now);
      // Re-insert so the Map's order tracks recency; evict the stalest client
      // rather than growing without bound under a flood of distinct keys.
      clients.delete(client);
      clients.set(client, attempts);
      if (clients.size > MAX_TRACKED_CLIENTS) {
        const oldest = clients.keys().next().value;
        if (oldest !== undefined) clients.delete(oldest);
      }
      return true;
    },
  };
}

/**
 * Who is knocking, as far as the headers say: the tunnel's connecting-address
 * header first, then the first hop of a forwarded-for chain, else one shared
 * bucket for callers that present neither.
 */
export function clientKeyOf(headers: { get(name: string): string | null }): string {
  const connecting = headers.get('cf-connecting-ip')?.trim();
  if (connecting) return connecting;
  const forwarded = headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  if (forwarded) return forwarded;
  return 'unknown';
}
