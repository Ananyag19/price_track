// Sanity-check the catalogue endpoint against the real store BEFORE relying on it:
//   npm run probe
// Shows the raw shape of page 1, then loads EVERY page the way the app does and reports the total.
import { config } from "../config.js";
import { logger } from "../logger.js";
import { createCatalog, normalizeCatalog, totalPagesOf } from "../scraper/catalogClient.js";

const url = `${config.storeBaseUrl}${config.catalogPath}?page=1&pageSize=${config.catalogPageSize}`;
console.log(`GET ${url}`);

const res = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(15000) });
console.log(`HTTP ${res.status}  content-type: ${res.headers.get("content-type")}`);
if (!res.ok) {
  console.log((await res.text()).slice(0, 300));
  console.log("\nCatalogue did not return 200. Adjust CATALOG_PATH in .env (open the store, DevTools -> Network, look for the JSON request).");
  process.exit(1);
}

const payload = await res.json();
console.log("Top-level:", Array.isArray(payload) ? `array(${payload.length})` : `object with keys [${Object.keys(payload).join(", ")}]`);
console.log("Pages reported by the store:", totalPagesOf(payload) ?? "not stated (will read until an empty page)");

const firstRow = Array.isArray(payload) ? payload[0] : Object.values(payload).find(Array.isArray)?.[0];
console.log("First raw row:", JSON.stringify(firstRow, null, 2));

const firstPage = normalizeCatalog(payload);
console.log(`\nPage 1 normalised to ${firstPage.length} product(s). First 3:`);
console.table(firstPage.slice(0, 3));
if (firstPage.length === 0) {
  console.log("Nothing normalised - id/name fields were not recognised; see pick() key lists in scraper/catalogClient.js");
  process.exit(1);
}

console.log("\nLoading ALL pages the way the app does...");
const all = await createCatalog({ config, logger }).load();
console.log(`Total products available to search: ${all.length}`);
