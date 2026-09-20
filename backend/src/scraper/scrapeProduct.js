import { runWithRetries } from "./retry.js";
import { scrapeOnce } from "./pageScraper.js";
import { validateObservation } from "./validate.js";

const clip = (s, n = 500) => (s ? String(s).slice(0, n) : null);

/**
 * Scrapes one product with retries and records every attempt.
 *
 * `sink` is where results go:
 *   saveObservation(product, observation)  - called ONLY with validated data
 *   logAttempt(entry)                      - called for every attempt, success or not
 * (Supabase in the server, the terminal in the headed demo, an array in tests.)
 */
export async function scrapeProduct({ browser, product, sink, config, runId, trigger, chaosPlan = [], logger, headless = true }) {
  const url = `${config.storeBaseUrl}/product/${encodeURIComponent(product.store_product_id)}`;

  const outcome = await runWithRetries(
    async (attempt) => {
      logger.info(`[${product.name}] attempt ${attempt}/${config.scrape.maxAttempts}`);

      const raw = await scrapeOnce({ browser, url, config, chaos: chaosPlan[attempt - 1] ?? null, logger, headless });
      const observation = validateObservation(raw); // throws -> attempt counts as failed, nothing saved
      await sink.saveObservation(product, observation);
      return observation;
    },
    {
      maxAttempts: config.scrape.maxAttempts,
      baseDelayMs: config.scrape.retryBaseDelayMs,
      onAttempt: async ({ attempt, ok, result, error, willRetry, durationMs }) => {
        const entry = {
          run_id: runId,
          tracked_product_id: product.id,
          trigger,
          attempt_number: attempt,
          duration_ms: durationMs,
          status: ok ? "success" : willRetry ? "retried" : "failed",
          error_code: ok ? null : error.code,
          error_message: ok ? null : clip(error.message),
          price: ok ? result.price : null,
          currency: ok ? result.currency : null,
          stock_status: ok ? result.stockStatus : null,
          stock_quantity: ok ? result.stockQuantity : null,
        };
        try {
          await sink.logAttempt(entry);
        } catch (logErr) {
          logger.error(`Could not write scrape log: ${logErr.message}`); // never let logging hide the scrape outcome
        }
        if (ok) logger.ok(`[${product.name}] success on attempt ${attempt}`);
        else logger.warn(`[${product.name}] attempt ${attempt} ${entry.status}: ${error.code} - ${error.message}${willRetry ? " (will retry)" : ""}`);
      },
    },
  );

  return outcome;
}
