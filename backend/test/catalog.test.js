import test from "node:test";
import assert from "node:assert/strict";
import { normalizeCatalog, searchProducts, createCatalog, CatalogError } from "../src/scraper/catalogClient.js";

const items = normalizeCatalog({
  products: [
    { id: 705, name: "Wireless Noise Cancelling Headphones", brand: "Sonic", sku: "SN-100", category: "Audio" },
    { id: 12, name: "Wired Headphones", brand: "Sonic", sku: "SN-101", category: "Audio" },
    { id: 3, title: "Phone Case", brand: "Shell", sku: "SH-1" },
    { name: "no id, dropped" },
  ],
});

test("normalizeCatalog handles wrappers, alternate field names, and drops unusable rows", () => {
  assert.equal(items.length, 3);
  assert.deepEqual(items.map((i) => i.id), ["705", "12", "3"]);
  assert.equal(items[2].name, "Phone Case");
  assert.equal(normalizeCatalog([{ id: 1, name: "A" }]).length, 1);
  assert.throws(() => normalizeCatalog({ nope: 1 }), CatalogError);
});

test("search: partial name", () => assert.equal(searchProducts(items, "head").length, 2));
test("search: full name", () => assert.equal(searchProducts(items, "wired headphones")[0].id, "12"));
test("search: case-insensitive, extra spaces", () => assert.equal(searchProducts(items, "  PHONE   case ")[0].id, "3"));
test("search: words in any order, across name and brand", () => assert.equal(searchProducts(items, "sonic wireless")[0].id, "705"));
test("search: by sku", () => assert.equal(searchProducts(items, "sn-101")[0].id, "12"));
test("search: no match and empty query", () => {
  assert.deepEqual(searchProducts(items, "zzz"), []);
  assert.deepEqual(searchProducts(items, "   "), []);
});
test("search: exact/prefix matches rank first", () => {
  const r = searchProducts(items, "phone");
  assert.equal(r[0].id, "3"); // "Phone Case" starts with it; the headphones only contain it
});

test("catalog client: retries transient failures, then caches", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    if (calls < 3) return { ok: false, status: 503 };
    return { ok: true, status: 200, json: async () => [{ id: 1, name: "A" }] };
  };
  const cat = createCatalog({ config: { storeBaseUrl: "http://x", catalogPath: "/api/catalog" }, fetchImpl, sleep: async () => {} });
  assert.equal((await cat.load()).length, 1);
  assert.equal(calls, 3);
  await cat.load();
  assert.equal(calls, 3, "second load is served from cache");
});

test("catalog client: does not retry a 4xx, and serves a stale cache if the store goes down", async () => {
  let mode = "ok";
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    if (mode === "ok") return { ok: true, json: async () => [{ id: 1, name: "A" }] };
    return { ok: false, status: 404 };
  };
  let t = 0;
  const cat = createCatalog({ config: { storeBaseUrl: "http://x", catalogPath: "/c" }, fetchImpl, sleep: async () => {}, now: () => t });
  await cat.load();
  mode = "down";
  t = 10 * 60 * 1000; // cache expired
  const before = calls;
  assert.equal((await cat.load()).length, 1, "stale cache served");
  assert.equal(calls - before, 1, "4xx not retried");

  const fresh = createCatalog({ config: { storeBaseUrl: "http://x", catalogPath: "/c" }, fetchImpl, sleep: async () => {} });
  await assert.rejects(() => fresh.load(), CatalogError);
});
