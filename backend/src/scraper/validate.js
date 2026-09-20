import { ScrapeError } from "./errors.js";

const MAX_PRICE = 100_000_000;
const STOCK_STATUSES = new Set(["in_stock", "low_stock", "out_of_stock"]);

/**
 * Last gate before anything is written to the database.
 * Throws a ScrapeError (so the attempt is logged as a failure) instead of returning bad data.
 */
export function validateObservation(raw) {
  const value = raw?.price?.value;
  const currency = raw?.price?.currency;
  const status = raw?.stock?.status;
  const quantity = raw?.stock?.quantity ?? null;

  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > MAX_PRICE) {
    throw new ScrapeError("invalid_price", `Extracted price ${JSON.stringify(value)} failed validation`);
  }
  if (typeof currency !== "string" || !/^[A-Z]{3}$/.test(currency)) {
    throw new ScrapeError("invalid_price", `Could not determine the currency (got ${JSON.stringify(currency)})`);
  }
  if (!STOCK_STATUSES.has(status)) {
    throw new ScrapeError("invalid_stock", `Extracted stock status ${JSON.stringify(status)} failed validation`);
  }
  if (quantity !== null && (!Number.isInteger(quantity) || quantity < 0)) {
    throw new ScrapeError("invalid_stock", `Extracted stock quantity ${JSON.stringify(quantity)} failed validation`);
  }
  if (status === "out_of_stock" && quantity !== null && quantity !== 0) {
    throw new ScrapeError("invalid_stock", "Stock says out of stock but a positive quantity was extracted");
  }
  if (status !== "out_of_stock" && quantity === 0) {
    throw new ScrapeError("invalid_stock", "Stock says available but the quantity is zero");
  }

  return {
    price: Math.round(value * 100) / 100,
    currency,
    stockStatus: status,
    stockQuantity: status === "out_of_stock" ? 0 : quantity,
  };
}
