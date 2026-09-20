import { Router } from "express";
import { createHash, timingSafeEqual } from "node:crypto";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STORE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const LOG_STATUSES = new Set(["success", "retried", "failed"]);

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const sha = (s) => createHash("sha256").update(String(s)).digest();
const safeEqual = (a, b) => timingSafeEqual(sha(a), sha(b)); // constant-time compare of fixed-length digests

export function createApiRouter({ repo, catalog, runner, config }) {
  const router = Router();

  // The scheduler (cron-job.org) proves itself with a shared secret.
  function requireCron(req, res, next) {
    if (!config.cronSecret) return res.status(503).json({ error: "CRON_SECRET is not configured on the server" });
    const header = req.get("authorization") || "";
    const supplied = header.startsWith("Bearer ") ? header.slice(7) : req.get("x-cron-secret") || "";
    if (!supplied || !safeEqual(supplied, config.cronSecret)) return res.status(401).json({ error: "Unauthorized" });
    next();
  }

  function idParam(req, res, next) {
    if (!UUID.test(req.params.id)) return res.status(400).json({ error: "Invalid product id" });
    next();
  }

  router.get("/health", (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

  // --- search the store (partial or full name) ---
  router.get("/products/search", wrap(async (req, res) => {
    const q = String(req.query.q ?? "").trim().slice(0, 100);
    if (!q) return res.json({ query: q, results: [] });
    const [results, trackedIds] = await Promise.all([catalog.search(q, 25), repo.listActiveStoreIds()]);
    res.json({ query: q, results: results.map((p) => ({ ...p, tracked: trackedIds.has(p.id) })) });
  }));

  // --- tracked products ---
  router.get("/tracked", wrap(async (req, res) => res.json(await repo.listTracked())));

  router.post("/tracked", wrap(async (req, res) => {
    const storeProductId = String(req.body?.storeProductId ?? "");
    if (!STORE_ID.test(storeProductId)) return res.status(400).json({ error: "storeProductId is required" });

    // Details come from the store catalogue, never from the request body.
    const item = await catalog.getById(storeProductId);
    if (!item) return res.status(404).json({ error: "That product is not in the store catalogue" });

    const product = await repo.trackProduct({
      store_product_id: item.id, name: item.name, brand: item.brand, sku: item.sku, category: item.category,
      image_url: item.image, product_url: `${config.storeBaseUrl}/product/${encodeURIComponent(item.id)}`,
    });
    const { runId } = runner.enqueue([product], "track"); // first price/stock reading happens in the background
    res.status(201).json({ product, runId });
  }));

  router.get("/tracked/:id", idParam, wrap(async (req, res) => {
    const product = await repo.getTracked(req.params.id);
    if (!product) return res.status(404).json({ error: "Tracked product not found" });
    res.json(product);
  }));

  router.delete("/tracked/:id", idParam, wrap(async (req, res) => {
    const product = await repo.untrack(req.params.id);
    if (!product) return res.status(404).json({ error: "Tracked product not found" });
    res.json({ ok: true }); // history and logs are kept
  }));

  router.get("/tracked/:id/history", idParam, wrap(async (req, res) => {
    res.json(await repo.listHistory(req.params.id, req.query.limit));
  }));

  router.get("/tracked/:id/logs", idParam, wrap(async (req, res) => {
    res.json(await repo.listLogs({ trackedProductId: req.params.id, limit: req.query.limit }));
  }));

  // --- complete scrape log (all products, including untracked ones) ---
  router.get("/logs", wrap(async (req, res) => {
    const status = LOG_STATUSES.has(req.query.status) ? req.query.status : undefined;
    res.json(await repo.listLogs({ status, limit: req.query.limit }));
  }));

  // --- scraping ---
  // Manual scrape of one product. Returns immediately (202); the result shows up in history/logs.
  router.post("/tracked/:id/scrape", idParam, wrap(async (req, res) => {
    const product = await repo.getTracked(req.params.id);
    if (!product || !product.is_active) return res.status(404).json({ error: "Tracked product not found" });
    const { runId, queued } = runner.enqueue([product], "manual");
    if (!queued) return res.status(409).json({ error: "A scrape for this product is already queued or running" });
    res.status(202).json({ runId });
  }));

  // Called by cron-job.org every 2 hours. Also returns immediately: cron services give up after ~30s.
  router.post("/scrape", requireCron, wrap(async (req, res) => {
    const products = await repo.listActiveTracked();
    if (products.length === 0) return res.json({ runId: null, queued: 0, message: "No tracked products" });
    const { runId, queued } = runner.enqueue(products, "cron");
    if (!queued) return res.status(409).json({ error: "A scrape is already queued or running for all tracked products" });
    res.status(202).json({ runId, queued });
  }));

  return router;
}
