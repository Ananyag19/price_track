// Pure text -> value helpers. No browser, no network: easy to unit test.

const INVISIBLE = /[\u200B-\u200D\uFEFF\u2060]/g; // zero-width chars the store may inject to break naive parsing
const SPACES = /[\u00A0\u202F\s]+/g;

export function cleanText(input) {
  return String(input ?? "").replace(INVISIBLE, "").replace(SPACES, " ").trim();
}

const CURRENCY_CODES = {
  "₹": "INR", rs: "INR", inr: "INR",
  $: "USD", usd: "USD",
  "€": "EUR", eur: "EUR",
  "£": "GBP", gbp: "GBP",
};

// Anchored "this element IS a price" pattern. Used inside the page to find candidate elements.
// Allows a short label before the amount ("Price: ₹999", "MRP ₹1,299") - the label is classified later.
export const PRICE_LINE_SOURCE =
  "^(?:[A-Za-z.: ]{0,20})?(?:₹|Rs\\.?|INR|USD|EUR|GBP|\\$|€|£)\\s*\\d[\\d,]*(?:\\.\\d{1,2})?\\s*(?:/-|only)?$";

// Unanchored pattern used to extract the amount from a candidate.
const PRICE_RE = /(?<![A-Za-z])(₹|Rs\.?|INR|USD|EUR|GBP|\$|€|£)\s*(\d[\d,]*(?:\.\d{1,2})?)/i;

/** "₹ 1,299.50" -> { value: 1299.5, currency: "INR" }, or null when there is no price. */
export function parsePrice(text) {
  const m = PRICE_RE.exec(cleanText(text));
  if (!m) return null;
  const value = Number(m[2].replace(/,/g, ""));
  if (!Number.isFinite(value)) return null;
  const currency = CURRENCY_CODES[m[1].toLowerCase().replace(/\.$/, "")];
  return { value, currency };
}

// Cheap, broad filter used inside the page to shortlist stock-looking elements.
// parseStock() below is the strict judge.
export const STOCK_HINT_SOURCE =
  "in stock|out of stock|sold out|unavailable|not available|low stock|\\d+\\s*(?:units?|items?|pieces?|pcs)?\\s*(?:left|remaining|available)|stock\\s*[:\\-]?\\s*\\d+|^(?:currently |now )?available(?: now)?$";

const qtyResult = (n, status) => {
  const quantity = Number(n);
  return quantity === 0 ? { status: "out_of_stock", quantity: 0 } : { status, quantity };
};

/**
 * "Only 3 left" -> low_stock/3, "12 in stock" -> in_stock/12, "Out of stock" -> out_of_stock/0,
 * "In stock" -> in_stock/null. Anything it does not clearly understand -> null (never guess).
 */
export function parseStock(text) {
  const t = cleanText(text).toLowerCase();
  if (!t || t.length > 80) return null;

  if (/\b(out of stock|sold out|unavailable|not available|not in stock|no stock)\b/.test(t)) {
    return { status: "out_of_stock", quantity: 0 };
  }

  const unit = "(?:units?\\s+|items?\\s+|pieces?\\s+|pcs\\s+)?";
  let m = new RegExp(`\\bonly\\s+(\\d+)\\s+${unit}(?:left|remaining|available|in stock)\\b`).exec(t);
  if (m) return qtyResult(m[1], "low_stock");

  m =
    new RegExp(`\\b(\\d+)\\s+${unit}(?:left|remaining|available|in stock)\\b`).exec(t) ||
    /\bstock\s*(?:level|count|quantity|qty)?\s*[:\-]?\s*(\d+)\b/.exec(t);
  if (m) return qtyResult(m[1], "in_stock");

  if (/\b(low stock|few left|almost gone)\b/.test(t)) return { status: "low_stock", quantity: null };
  if (/\bin stock\b/.test(t) || /^(currently |now )?available( now)?$/.test(t)) {
    return { status: "in_stock", quantity: null };
  }
  return null;
}
