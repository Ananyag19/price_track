import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app.js";
import { silentLogger } from "../src/logger.js";

const UUID = "11111111-1111-4111-8111-111111111111";
const catalogItems = [
  { id: "705", name: "Wireless Headphones", brand: "Sonic", sku: "S1", category: "Audio", image: null },
  { id: "9", name: "Phone Case", brand: "Shell", sku: "P1", category: "Acc", image: null },
];

function build({ tracked = [], enqueueResult } = {}) {
  const calls = { enqueue: [], tracked: [] };
  const repo = {
    listTracked: async () => tracked,
    listActiveTracked: async () => tracked,
    listActiveStoreIds: async () => new Set(["9"]),
    getTracked: async (id) => tracked.find((t) => t.id === id) ?? null,
    trackProduct: async (p) => { calls.tracked.push(p); return { id: UUID, ...p }; },
    untrack: async (id) => (id === UUID ? { id } : null),
    listHistory: async () => [{ price: 1 }],
    listLogs: async (o) => { calls.logs = o; return []; },
  };
  const catalog = {
    search: async (q) => catalogItems.filter((i) => i.name.toLowerCase().includes(q.toLowerCase())),
    getById: async (id) => catalogItems.find((i) => i.id === id) ?? null,
  };
  const runner = { enqueue: (products, trigger) => { calls.enqueue.push({ products, trigger }); return enqueueResult ?? { runId: "run-1", queued: products.length }; } };
  const config = { corsOrigin: "*", cronSecret: "s3cret", storeBaseUrl: "https://store.test" };
  return { app: createApp({ config, logger: silentLogger, repo, catalog, runner }), calls };
}

async function withServer(app, fn) {
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  try { await fn(base); } finally { server.close(); }
}

test("search returns matches flagged with tracked state; empty query returns []", async () => {
  const { app } = build();
  await withServer(app, async (base) => {
    const r = await (await fetch(`${base}/api/products/search?q=phone`)).json();
    assert.equal(r.results.length, 2);
    assert.equal(r.results.find((p) => p.id === "9").tracked, true);
    assert.equal(r.results.find((p) => p.id === "705").tracked, false);
    assert.deepEqual((await (await fetch(`${base}/api/products/search?q=`)).json()).results, []);
  });
});

test("tracking takes product details from the catalogue, not the request body, and queues a first scrape", async () => {
  const { app, calls } = build();
  await withServer(app, async (base) => {
    const res = await fetch(`${base}/api/tracked`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ storeProductId: "705", name: "HACKED", product_url: "https://evil.example" }),
    });
    assert.equal(res.status, 201);
    assert.equal(calls.tracked[0].name, "Wireless Headphones");
    assert.equal(calls.tracked[0].product_url, "https://store.test/product/705");
    assert.equal(calls.enqueue[0].trigger, "track");
  });
});

test("tracking rejects bad ids and products that are not in the store", async () => {
  const { app } = build();
  await withServer(app, async (base) => {
    const post = (body) => fetch(`${base}/api/tracked`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    assert.equal((await post({})).status, 400);
    assert.equal((await post({ storeProductId: "../etc/passwd" })).status, 400);
    assert.equal((await post({ storeProductId: "99999" })).status, 404);
    const bad = await fetch(`${base}/api/tracked`, { method: "POST", headers: { "content-type": "application/json" }, body: "{oops" });
    assert.equal(bad.status, 400);
  });
});

test("POST /api/scrape requires the cron secret", async () => {
  const { app, calls } = build({ tracked: [{ id: UUID, name: "A", is_active: true }] });
  await withServer(app, async (base) => {
    assert.equal((await fetch(`${base}/api/scrape`, { method: "POST" })).status, 401);
    assert.equal((await fetch(`${base}/api/scrape`, { method: "POST", headers: { authorization: "Bearer nope" } })).status, 401);
    assert.equal(calls.enqueue.length, 0);

    const ok = await fetch(`${base}/api/scrape`, { method: "POST", headers: { authorization: "Bearer s3cret" } });
    assert.equal(ok.status, 202, "returns immediately; scraping continues in the background");
    assert.deepEqual(await ok.json(), { runId: "run-1", queued: 1 });
    assert.equal(calls.enqueue[0].trigger, "cron");

    const alt = await fetch(`${base}/api/scrape`, { method: "POST", headers: { "x-cron-secret": "s3cret" } });
    assert.equal(alt.status, 202);
  });
});

test("POST /api/scrape with nothing tracked is a no-op, and a busy queue answers 409", async () => {
  const empty = build({ tracked: [] });
  await withServer(empty.app, async (base) => {
    const r = await fetch(`${base}/api/scrape`, { method: "POST", headers: { authorization: "Bearer s3cret" } });
    assert.equal(r.status, 200);
    assert.equal((await r.json()).queued, 0);
  });
  const busy = build({ tracked: [{ id: UUID, name: "A", is_active: true }], enqueueResult: { runId: null, queued: 0 } });
  await withServer(busy.app, async (base) => {
    const r = await fetch(`${base}/api/scrape`, { method: "POST", headers: { authorization: "Bearer s3cret" } });
    assert.equal(r.status, 409);
  });
});

test("manual scrape: 202 for an active product, 404 for unknown, 400 for malformed id", async () => {
  const { app, calls } = build({ tracked: [{ id: UUID, name: "A", is_active: true }] });
  await withServer(app, async (base) => {
    const ok = await fetch(`${base}/api/tracked/${UUID}/scrape`, { method: "POST" });
    assert.equal(ok.status, 202);
    assert.equal(calls.enqueue[0].trigger, "manual");
    assert.equal((await fetch(`${base}/api/tracked/22222222-2222-4222-8222-222222222222/scrape`, { method: "POST" })).status, 404);
    assert.equal((await fetch(`${base}/api/tracked/not-a-uuid/scrape`, { method: "POST" })).status, 400);
  });
});

test("logs endpoints: per-product and complete, with status filter validated", async () => {
  const { app, calls } = build();
  await withServer(app, async (base) => {
    await fetch(`${base}/api/tracked/${UUID}/logs`);
    assert.equal(calls.logs.trackedProductId, UUID);
    await fetch(`${base}/api/logs?status=failed`);
    assert.equal(calls.logs.status, "failed");
    assert.equal(calls.logs.trackedProductId, undefined);
    await fetch(`${base}/api/logs?status=DROP TABLE`);
    assert.equal(calls.logs.status, undefined);
  });
});

test("unknown routes are JSON 404s and health works", async () => {
  const { app } = build();
  await withServer(app, async (base) => {
    assert.equal((await fetch(`${base}/api/nope`)).status, 404);
    assert.equal((await (await fetch(`${base}/api/health`)).json()).ok, true);
  });
});
