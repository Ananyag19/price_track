import { randomUUID } from "node:crypto";
import { launchBrowser } from "./browser.js";
import { scrapeProduct } from "./scrapeProduct.js";

/**
 * Serialises scraping. Chromium is heavy (free-tier Render has ~512MB), so only ONE job runs at a
 * time; extra requests wait their turn. Requests return immediately with a runId - the work happens
 * in the background and the outcome is visible in scrape_logs.
 */
export function createRunner({ repo, config, logger, launch = launchBrowser, scrape = scrapeProduct }) {
  let chain = Promise.resolve();
  const pending = new Set(); // tracked_product ids that are queued or running

  const dbSink = {
    saveObservation: (product, obs) => repo.insertHistory(product.id, obs),
    logAttempt: (entry) => repo.insertLog(entry),
  };

  async function execute(products, trigger, runId) {
    logger.info(`Run ${runId} started (${trigger}): ${products.length} product(s)`);
    let browser;
    try {
      browser = await launch({ headless: config.headless, executablePath: config.chromiumExecutablePath });
    } catch (err) {
      // Could not even start a browser: record that for every product instead of failing silently.
      logger.error(`Browser launch failed: ${err.message}`);
      for (const product of products) {
        await repo
          .insertLog({
            run_id: runId, tracked_product_id: product.id, trigger, attempt_number: 1, status: "failed",
            error_code: "browser_launch_failed", error_message: String(err.message).split("\n")[0].slice(0, 500),
          })
          .catch((e) => logger.error(`Could not write scrape log: ${e.message}`));
      }
      return;
    }

    try {
      for (const product of products) {
        try {
          await scrape({ browser, product, sink: dbSink, config, runId, trigger, logger, headless: config.headless });
        } catch (err) {
          logger.error(`Unexpected error scraping ${product.name}: ${err.message}`);
        }
      }
    } finally {
      await browser.close().catch(() => {});
      logger.info(`Run ${runId} finished`);
    }
  }

  return {
    /** Queue products for scraping. Returns { runId, queued } (queued excludes products already waiting). */
    enqueue(products, trigger) {
      const fresh = products.filter((p) => !pending.has(p.id));
      const runId = randomUUID();
      if (fresh.length === 0) return { runId: null, queued: 0 };

      fresh.forEach((p) => pending.add(p.id));
      chain = chain
        .then(() => execute(fresh, trigger, runId))
        .catch((err) => logger.error(`Run ${runId} crashed: ${err.stack || err.message}`))
        .finally(() => fresh.forEach((p) => pending.delete(p.id)));
      return { runId, queued: fresh.length };
    },
    isBusy: () => pending.size > 0,
  };
}
