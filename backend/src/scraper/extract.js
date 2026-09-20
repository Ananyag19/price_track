// Decides WHICH of the things found on the page is the real price / stock.
// Pure functions over plain objects, so the tricky rules are unit tested without a browser.
import { ScrapeError } from "./errors.js";
import { parsePrice, parseStock } from "./parse.js";

// The store shows decoys next to the real price: strikethrough MRPs, "Save Rs. 200" badges, hidden fakes.
const REFERENCE_LABEL = /\b(mrp|m\.r\.p|was|original|list price|regular|compare at|rrp|retail)\b/i;
const NOT_A_PRICE_LABEL = /\b(save|saving|savings|off|discount|shipping|delivery|emi|tax|fee|cashback|per month)\b/i;

/**
 * candidates: [{ text, struck, fontSize, x, y }] - already filtered to visible elements by the page.
 * Returns { value, currency, text, x, y } or throws price_not_found / price_ambiguous.
 */
export function pickPrice(candidates) {
  const live = [];
  for (const c of candidates) {
    const parsed = parsePrice(c.text);
    if (!parsed) continue;
    if (NOT_A_PRICE_LABEL.test(c.text)) continue;
    if (c.struck || REFERENCE_LABEL.test(c.text)) continue; // the crossed-out / list price, not the selling price
    live.push({ ...c, ...parsed });
  }

  if (live.length === 0) {
    throw new ScrapeError("price_not_found", "No visible, non-struck-through price was found on the page");
  }

  // The selling price is styled as the biggest price on the page. Several different values at the
  // top size means we cannot tell which one is real - fail honestly instead of guessing.
  const maxFont = Math.max(...live.map((c) => c.fontSize || 0));
  const top = live.filter((c) => (c.fontSize || 0) >= maxFont - 0.5);
  const distinct = [...new Set(top.map((c) => `${c.currency} ${c.value}`))];
  if (distinct.length > 1) {
    throw new ScrapeError("price_ambiguous", `Several different prices share the largest size: ${distinct.join(", ")}`);
  }
  return top[0];
}

/**
 * candidates: [{ text, x, y }]. `anchor` is the chosen price element; the stock line that
 * belongs to the product is the one closest to it (related-product cards sit further away).
 */
export function pickStock(candidates, anchor) {
  const parsed = candidates
    .map((c) => ({ ...c, ...(parseStock(c.text) ?? {}) }))
    .filter((c) => c.status);

  if (parsed.length === 0) {
    throw new ScrapeError("stock_not_found", "No recognisable stock text was found on the page");
  }

  const dist = (c) => (anchor ? Math.hypot(c.x - anchor.x, c.y - anchor.y) : 0);
  parsed.sort((a, b) => dist(a) - dist(b));
  const contenders = parsed.filter((c) => dist(c) - dist(parsed[0]) <= 40);

  const out = contenders.filter((c) => c.status === "out_of_stock");
  const available = contenders.filter((c) => c.status !== "out_of_stock");

  if (out.length && available.length) {
    throw new ScrapeError("stock_ambiguous", "The page shows both an in-stock and an out-of-stock message near the price");
  }
  if (out.length) return { status: "out_of_stock", quantity: 0, text: out[0].text };

  const quantities = [...new Set(available.filter((c) => c.quantity != null).map((c) => c.quantity))];
  if (quantities.length > 1) {
    throw new ScrapeError("stock_ambiguous", `Conflicting stock quantities near the price: ${quantities.join(", ")}`);
  }
  return {
    status: available.some((c) => c.status === "low_stock") ? "low_stock" : "in_stock",
    quantity: quantities.length ? quantities[0] : null,
    text: available[0].text,
  };
}
