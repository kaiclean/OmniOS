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
