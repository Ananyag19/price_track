// Visible-browser scraper for demos and debugging.
//
//   npm run scrape:headed -- --product 705            one real scrape, browser visible
//   npm run scrape:demo   -- --product 705            + injected slow request, then a failed request, then recovery
//   ... --save                                        also write results/logs to Supabase (product gets tracked)
//   ... --slowmo 500 | --headless | --attempts 5
//
// Without --save nothing touches the database, so it works with no setup at all.
import { randomUUID } from "node:crypto";
import { config as baseConfig } from "../config.js";
import { logger, color } from "../logger.js";
import { launchBrowser } from "../scraper/browser.js";
import { createCatalog } from "../scraper/catalogClient.js";
import { scrapeProduct } from "../scraper/scrapeProduct.js";
import { DEMO_PLAN } from "../scraper/chaos.js";

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const demo = flag("demo");
const save = flag("save");
const headless = flag("headless");

// Demo timings are shortened so the whole story fits comfortably in a 2-4 minute recording.
const config = {
  ...baseConfig,
  headless,
  scrape: {
    ...baseConfig.scrape,
    maxAttempts: Number(value("attempts")) || (demo ? 4 : baseConfig.scrape.maxAttempts),
    navTimeoutMs: demo ? 8000 : baseConfig.scrape.navTimeoutMs,
    retryBaseDelayMs: demo ? 2000 : baseConfig.scrape.retryBaseDelayMs,
  },
};

async function resolveProduct() {
  const catalog = createCatalog({ config, logger });
  let id = value("product");
  try {
    const items = await catalog.load();
    if (!id) id = items[0]?.id;
    const item = items.find((p) => p.id === String(id));
    if (item) return { store_product_id: item.id, name: item.name, brand: item.brand, sku: item.sku, category: item.category, image_url: item.image };
  } catch (err) {
    logger.warn(`Catalogue lookup failed (${err.message}); continuing with the id you gave`);
  }
  if (!id) throw new Error("Pass --product <id> (the number in the store URL /product/<id>)");
  return { store_product_id: String(id), name: `Product ${id}` };
}

async function main() {
  const item = await resolveProduct();
  const runId = randomUUID();
  const attemptsLog = [];

  let product = { id: "local-demo", ...item };
  let sink;

  if (save) {
    const { createSupabase } = await import("../db/supabase.js");
    const { createRepo } = await import("../db/repo.js");
    const repo = createRepo(createSupabase(config));
    product = await repo.trackProduct({ ...item, product_url: `${config.storeBaseUrl}/product/${item.store_product_id}` });
    sink = {
      saveObservation: (p, obs) => repo.insertHistory(p.id, obs),
      logAttempt: (entry) => repo.insertLog(entry),
    };
  } else {
    sink = {
      saveObservation: async (p, obs) => logger.info(color.dim(`(dry run) would save: ${JSON.stringify(obs)}`)),
      logAttempt: async () => {},
    };
  }
  const recordingSink = { ...sink, logAttempt: async (e) => { attemptsLog.push(e); return sink.logAttempt(e); } };

  console.log(color.bold(`\nINE price tracker - ${demo ? "DEMO" : "headed"} scrape`));
  console.log(`Product : ${product.name} (store id ${product.store_product_id})`);
  console.log(`Mode    : ${headless ? "headless" : "visible browser"}${save ? ", saving to Supabase" : ", dry run (no database)"}`);
  if (demo) {
    console.log(`Plan    : attempt 1 = request hangs past the ${config.scrape.navTimeoutMs / 1000}s timeout (slow)`);
    console.log("          attempt 2 = request fails at network level");
    console.log("          attempt 3 = untouched, real request -> recovery\n");
  }

  const browser = await launchBrowser({
    headless,
    slowMo: Number(value("slowmo")) || (headless ? 0 : demo ? 300 : 200),
    executablePath: config.chromiumExecutablePath,
  });

  let outcome;
  try {
    outcome = await scrapeProduct({
      browser, product, sink: recordingSink, config, runId, trigger: "headed", logger, headless,
      chaosPlan: demo ? DEMO_PLAN : [],
    });
    if (!headless) await new Promise((r) => setTimeout(r, 3000)); // let the viewer see the final page state
  } finally {
    await browser.close().catch(() => {});
  }

  console.log(color.bold("\nAttempt log"));
  for (const e of attemptsLog) {
    const label = e.status.padEnd(8);
    const tag = e.status === "success" ? color.green(label) : e.status === "retried" ? color.yellow(label) : color.red(label);
    const detail = e.status === "success" ? `${e.currency} ${e.price}, stock ${e.stock_status}${e.stock_quantity != null ? ` (${e.stock_quantity})` : ""}` : `${e.error_code}: ${e.error_message}`;
    console.log(`  attempt ${e.attempt_number}  ${tag}  ${(e.duration_ms / 1000).toFixed(1)}s  ${detail}`);
  }
  console.log(outcome.ok ? color.green("\nResult: SUCCESS\n") : color.red("\nResult: FAILED - nothing was saved\n"));
  process.exit(outcome.ok ? 0 : 1);
}

main().catch((err) => {
  logger.error(err.message);
  process.exit(1);
});
