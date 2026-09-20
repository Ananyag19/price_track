// Product search uses plain HTTP: the catalogue is JSON, no browser needed.
// (Price and stock are NOT in the catalogue - those need Playwright, see pageScraper.js.)

const CACHE_TTL_MS = 5 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 10_000;
const ATTEMPTS = 3;
const MAX_PAGES = 100; // safety stop; the store has ~17 pages of ~60 items

export class CatalogError extends Error {
  constructor(message) {
    super(message);
    this.name = "CatalogError";
  }
}

const pick = (obj, keys) => {
  for (const k of keys) if (obj?.[k] !== undefined && obj[k] !== null && obj[k] !== "") return obj[k];
  return null;
};

/** Accepts [..] or { products|items|data|catalog|results: [..] } and maps each row to one shape. */
export function normalizeCatalog(payload) {
  let rows = Array.isArray(payload) ? payload : null;
  if (!rows && payload && typeof payload === "object") {
    for (const key of ["products", "items", "data", "catalog", "results"]) {
      if (Array.isArray(payload[key])) { rows = payload[key]; break; }
    }
    if (!rows) rows = Object.values(payload).find(Array.isArray) ?? null;
  }
  if (!rows) throw new CatalogError("Catalogue response did not contain a list of products");

  return rows
    .map((r) => {
      const id = pick(r, ["id", "product_id", "productId", "_id", "sku"]);
      const name = pick(r, ["name", "title", "productName", "product_name"]);
      if (id === null || !name) return null;
      return {
        id: String(id),
        name: String(name),
        brand: pick(r, ["brand", "manufacturer"]),
        sku: pick(r, ["sku", "SKU", "code"]),
        category: pick(r, ["category", "type"]),
        image: pick(r, ["image", "imageUrl", "image_url", "thumbnail"]),
      };
    })
    .filter(Boolean);
}

const norm = (s) =>
  String(s ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** Every word the user typed must appear somewhere (name, brand, sku, category); better matches rank first. */
export function searchProducts(items, query, limit = 25) {
  const q = norm(query);
  const tokens = q.split(" ").filter(Boolean);
  if (tokens.length === 0) return [];

  const scored = [];
  for (const p of items) {
    const name = norm(p.name);
    const haystack = norm([p.name, p.brand, p.sku, p.category].filter(Boolean).join(" "));
    if (!tokens.every((t) => haystack.includes(t))) continue;

    let score = 10;
    if (name === q) score = 100;
    else if (name.startsWith(q)) score = 80;
    else if (name.includes(q)) score = 60;
    else if (tokens.every((t) => name.split(" ").some((w) => w.startsWith(t)))) score = 40;
    scored.push({ p, score });
  }
  scored.sort((a, b) => b.score - a.score || a.p.name.localeCompare(b.p.name));
  return scored.slice(0, limit).map((s) => s.p);
}

/** Reads "how many pages" from the usual places a paginated JSON API puts it. */
export function totalPagesOf(payload) {
  if (!payload || Array.isArray(payload)) return null;
  const candidates = [
    payload.totalPages, payload.total_pages, payload.pageCount, payload.pages,
    payload.meta?.totalPages, payload.pagination?.totalPages, payload.pagination?.pages,
  ];
  return candidates.map(Number).find((n) => Number.isInteger(n) && n > 0) ?? null;
}

export function createCatalog({ config, fetchImpl = fetch, logger, now = Date.now, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  let cache = { at: 0, items: null };
  let inflight = null; // several searches at once share ONE catalogue download
  const pageSize = config.catalogPageSize ?? 100;

  const pageUrl = (page) => {
    const base = `${config.storeBaseUrl}${config.catalogPath}`;
    return `${base}${base.includes("?") ? "&" : "?"}page=${page}&pageSize=${pageSize}`;
  };

  async function fetchPageOnce(page) {
    const res = await fetchImpl(pageUrl(page), {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) {
      const err = new CatalogError(`Catalogue request failed with HTTP ${res.status}`);
      err.status = res.status;
      err.retryable = res.status >= 500 || res.status === 429;
      throw err;
    }
    const payload = await res.json();
    return { items: normalizeCatalog(payload), totalPages: totalPagesOf(payload) };
  }

  async function fetchPage(page) {
    let lastErr;
    for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
      try {
        return await fetchPageOnce(page);
      } catch (err) {
        lastErr = err;
        if (err.retryable === false) break; // 4xx: asking again will not help
        if (attempt < ATTEMPTS) await sleep(400 * 2 ** (attempt - 1));
      }
    }
    throw lastErr instanceof CatalogError ? lastErr : new CatalogError(`Could not reach the store catalogue: ${lastErr?.message}`);
  }

  /** Walks page 1, 2, 3 ... until the store says there are no more (or stops giving new products). */
  async function fetchAllPages() {
    const byId = new Map();
    let totalPages = null;

    for (let page = 1; page <= MAX_PAGES; page++) {
      if (totalPages && page > totalPages) break;

      let result;
      try {
        result = await fetchPage(page);
      } catch (err) {
        // Asking for a page past the end may be answered with 400/404: that just means "done".
        if (page > 1 && (err.status === 400 || err.status === 404)) break;
        throw err;
      }
      if (page === 1) totalPages = result.totalPages;

      const before = byId.size;
      for (const item of result.items) if (!byId.has(item.id)) byId.set(item.id, item);
      // Empty page, or a page of products we already have (server ignoring ?page=): stop.
      if (result.items.length === 0 || byId.size === before) break;
    }
    return [...byId.values()];
  }

  async function load({ force = false } = {}) {
    if (!force && cache.items && now() - cache.at < CACHE_TTL_MS) return cache.items;
    if (inflight) return inflight;

    inflight = (async () => {
      try {
        const items = await fetchAllPages();
        cache = { at: now(), items };
        logger?.info(`Catalogue loaded: ${items.length} products`);
        return items;
      } catch (err) {
        if (cache.items) {
          logger?.warn(`Catalogue refresh failed (${err.message}); serving cached copy`);
          return cache.items; // stale beats broken for a search box
        }
        throw err instanceof CatalogError ? err : new CatalogError(`Could not reach the store catalogue: ${err?.message}`);
      } finally {
        inflight = null;
      }
    })();
    return inflight;
  }

  return {
    load,
    async search(query, limit) { return searchProducts(await load(), query, limit); },
    async getById(id) { return (await load()).find((p) => p.id === String(id)) ?? null; },
  };
}
