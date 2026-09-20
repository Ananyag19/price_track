import test from "node:test";
import assert from "node:assert/strict";
import { parsePrice, parseStock, cleanText } from "../src/scraper/parse.js";

test("parsePrice reads common rupee/dollar formats", () => {
  assert.deepEqual(parsePrice("₹1,299"), { value: 1299, currency: "INR" });
  assert.deepEqual(parsePrice("₹ 12,34,567.50"), { value: 1234567.5, currency: "INR" });
  assert.deepEqual(parsePrice("Rs. 999"), { value: 999, currency: "INR" });
  assert.deepEqual(parsePrice("INR 450.00"), { value: 450, currency: "INR" });
  assert.deepEqual(parsePrice("$19.99"), { value: 19.99, currency: "USD" });
  assert.deepEqual(parsePrice("Price: ₹2499"), { value: 2499, currency: "INR" });
});

test("parsePrice strips zero-width and non-breaking characters the store may inject", () => {
  assert.deepEqual(parsePrice("₹\u200B1,\u200B299"), { value: 1299, currency: "INR" });
  assert.deepEqual(parsePrice("₹\u00A0899"), { value: 899, currency: "INR" });
  assert.equal(cleanText("  a\u200B  b\u00A0c "), "a b c");
});

test("parsePrice returns null rather than guessing", () => {
  assert.equal(parsePrice(""), null);
  assert.equal(parsePrice("Reveal price"), null);
  assert.equal(parsePrice("₹•••"), null);
  assert.equal(parsePrice("Doors 5"), null, "letters ending in rs must not count as a currency");
});

test("parseStock understands the common phrasings", () => {
  assert.deepEqual(parseStock("In stock"), { status: "in_stock", quantity: null });
  assert.deepEqual(parseStock("12 in stock"), { status: "in_stock", quantity: 12 });
  assert.deepEqual(parseStock("Stock: 40"), { status: "in_stock", quantity: 40 });
  assert.deepEqual(parseStock("Only 3 left"), { status: "low_stock", quantity: 3 });
  assert.deepEqual(parseStock("Low stock"), { status: "low_stock", quantity: null });
  assert.deepEqual(parseStock("Out of stock"), { status: "out_of_stock", quantity: 0 });
  assert.deepEqual(parseStock("Sold out"), { status: "out_of_stock", quantity: 0 });
  assert.deepEqual(parseStock("Currently unavailable"), { status: "out_of_stock", quantity: 0 });
  assert.deepEqual(parseStock("Only 0 left"), { status: "out_of_stock", quantity: 0 });
});

test("parseStock: negations win over the words they contain", () => {
  assert.equal(parseStock("Not in stock").status, "out_of_stock");
  assert.equal(parseStock("Not available").status, "out_of_stock");
});

test("parseStock returns null for unrelated text", () => {
  assert.equal(parseStock("Available in 3 colours"), null);
  assert.equal(parseStock("Free delivery"), null);
  assert.equal(parseStock(""), null);
});
