// End-to-end check of the REAL scraper (Playwright + Chromium) against the local mock store.
//   npm run e2e
// Needs a Chromium: either `npx playwright install chromium`, or set CHROMIUM_EXECUTABLE_PATH.
import assert from "node:assert/strict";
import { launchBrowser } from "../src/scraper/browser.js";
import { scrapeProduct } from "../src/scraper/scrapeProduct.js";
import { silentLogger, logger } from "../src/logger.js";
import { DEMO_PLAN } from "../src/scraper/chaos.js";
import { startMockStore } from "./mockStore.js";

const verbose = process.argv.includes("--verbose");
const store = await startMockStore();

const config = {
  storeBaseUrl: store.url,
  scrape: { maxAttempts: 3, navTimeoutMs: 3000, dataTimeoutMs: 15000, attemptTimeoutMs: 30000, retryBaseDelayMs: 50 },
};

const browser = await launchBrowser({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE_PATH });

async function scrape(id, { chaosPlan = [], dataTimeoutMs } = {}) {
  store.resetHits();
  const saved = [];
  const logs = [];
  const sink = { saveObservation: async (_p, obs) => saved.push(obs), logAttempt: async (e) => logs.push(e) };
  const product = { id: `p${id}`, store_product_id: String(id), name: `product ${id}` };
  const outcome = await scrapeProduct({
    browser, product, sink, config: dataTimeoutMs ? { ...config, scrape: { ...config.scrape, dataTimeoutMs } } : config, runId: "run", trigger: "manual", chaosPlan,
    logger: verbose ? logger : silentLogger,
  });
  return { outcome, saved, logs };
}

const statuses = (logs) => logs.map((l) => l.status).join(",");
const codes = (logs) => logs.map((l) => l.error_code ?? "-").join(",");

const scenarios = [
  ["decoys, overlay, dropped click, late + changing stock -> correct price/stock", async () => {
    const { outcome, saved, logs } = await scrape(1);
    assert.equal(outcome.ok, true);
    assert.deepEqual(saved, [{ price: 1499, currency: "INR", stockStatus: "low_stock", stockQuantity: 3 }]);
    assert.equal(statuses(logs), "success");
  }],
  ["out of stock is read as out_of_stock / 0", async () => {
    const { saved } = await scrape(2);
    assert.deepEqual(saved, [{ price: 799, currency: "INR", stockStatus: "out_of_stock", stockQuantity: 0 }]);
  }],
  ["reveal gate never opens -> 3 honest failures, NOTHING saved", async () => {
    const { outcome, saved, logs } = await scrape(3, { dataTimeoutMs: 7000 });
    assert.equal(outcome.ok, false);
    assert.equal(saved.length, 0);
    assert.equal(statuses(logs), "retried,retried,failed");
    assert.equal(codes(logs), "reveal_failed,reveal_failed,reveal_failed");
  }],
  ["503 twice then healthy -> retried, retried, success", async () => {
    const { outcome, saved, logs } = await scrape(4);
    assert.equal(outcome.ok, true);
    assert.equal(statuses(logs), "retried,retried,success");
    assert.equal(codes(logs), "http_error,http_error,-");
    assert.deepEqual(saved, [{ price: 2199, currency: "INR", stockStatus: "in_stock", stockQuantity: 12 }]);
  }],
  ["slow first response exceeds timeout -> retried, then success", async () => {
    const { outcome, logs } = await scrape(5);
    assert.equal(outcome.ok, true);
    assert.equal(statuses(logs), "retried,success");
    assert.equal(logs[0].error_code, "timeout");
  }],
  ["404 is not retried and saves nothing", async () => {
    const { outcome, saved, logs } = await scrape(6);
    assert.equal(outcome.ok, false);
    assert.equal(saved.length, 0);
    assert.equal(statuses(logs), "failed");
    assert.equal(codes(logs), "product_not_found");
  }],
  ["demo plan: injected slow -> injected network failure -> real recovery", async () => {
    const { outcome, saved, logs } = await scrape(1, { chaosPlan: DEMO_PLAN });
    assert.equal(outcome.ok, true);
    assert.equal(statuses(logs), "retried,retried,success");
    assert.equal(codes(logs), "timeout,network_error,-");
    assert.equal(saved.length, 1);
    assert.equal(saved[0].price, 1499);
  }],
];

let failed = 0;
for (const [name, fn] of scenarios) {
  const t0 = Date.now();
  try {
    await fn();
    console.log(`  ok   ${name}  (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  } catch (err) {
    failed++;
    console.log(`  FAIL ${name}\n       ${String(err.message).split("\n").slice(0, 6).join("\n       ")}`);
  }
}

await browser.close();
store.close();
console.log(failed ? `\n${failed} scenario(s) failed` : "\nAll e2e scenarios passed");
process.exit(failed ? 1 : 0);
