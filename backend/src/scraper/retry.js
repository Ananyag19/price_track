import { toScrapeError } from "./errors.js";

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** 1.5s, 3s, 6s ... plus a little jitter so retries do not land in lockstep. */
export const backoffMs = (attempt, baseMs) => baseMs * 2 ** (attempt - 1) + Math.floor(Math.random() * baseMs * 0.3);

/**
 * Runs attemptFn(attemptNumber) up to maxAttempts times.
 * Reports EVERY attempt through onAttempt - including the ones that will be retried - so the
 * caller can write an honest log. Non-retryable errors stop immediately.
 *
 * onAttempt receives: { attempt, ok, result?, error?, willRetry, durationMs }
 */
export async function runWithRetries(attemptFn, { maxAttempts, baseDelayMs, onAttempt, sleep = defaultSleep }) {
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const started = Date.now();
    try {
      const result = await attemptFn(attempt);
      await onAttempt({ attempt, ok: true, result, willRetry: false, durationMs: Date.now() - started });
      return { ok: true, attempts: attempt, result };
    } catch (err) {
      const error = toScrapeError(err);
      lastError = error;
      const willRetry = error.retryable && attempt < maxAttempts;
      await onAttempt({ attempt, ok: false, error, willRetry, durationMs: Date.now() - started });
      if (!willRetry) return { ok: false, attempts: attempt, error };
      await sleep(backoffMs(attempt, baseDelayMs));
    }
  }
  return { ok: false, attempts: maxAttempts, error: lastError };
}
