import test from "node:test";
import assert from "node:assert/strict";
import { validateObservation } from "../src/scraper/validate.js";

const good = { price: { value: 1299, currency: "INR" }, stock: { status: "in_stock", quantity: 5 } };

test("valid data passes and is normalised", () => {
  assert.deepEqual(validateObservation(good), { price: 1299, currency: "INR", stockStatus: "in_stock", stockQuantity: 5 });
  assert.equal(validateObservation({ ...good, price: { value: 10.005, currency: "INR" } }).price, 10.01);
});

test("out of stock always carries quantity 0", () => {
  const r = validateObservation({ ...good, stock: { status: "out_of_stock", quantity: null } });
  assert.equal(r.stockQuantity, 0);
});

for (const [name, raw, code] of [
  ["missing price", { stock: good.stock }, "invalid_price"],
  ["zero price", { ...good, price: { value: 0, currency: "INR" } }, "invalid_price"],
  ["negative price", { ...good, price: { value: -5, currency: "INR" } }, "invalid_price"],
  ["NaN price", { ...good, price: { value: NaN, currency: "INR" } }, "invalid_price"],
  ["absurd price", { ...good, price: { value: 1e12, currency: "INR" } }, "invalid_price"],
  ["missing currency", { ...good, price: { value: 10, currency: undefined } }, "invalid_price"],
  ["missing stock", { price: good.price }, "invalid_stock"],
  ["unknown stock status", { ...good, stock: { status: "maybe", quantity: null } }, "invalid_stock"],
  ["negative quantity", { ...good, stock: { status: "in_stock", quantity: -1 } }, "invalid_stock"],
  ["fractional quantity", { ...good, stock: { status: "in_stock", quantity: 2.5 } }, "invalid_stock"],
  ["in stock with zero quantity", { ...good, stock: { status: "in_stock", quantity: 0 } }, "invalid_stock"],
  ["out of stock with quantity", { ...good, stock: { status: "out_of_stock", quantity: 4 } }, "invalid_stock"],
  ["nothing at all", undefined, "invalid_price"],
]) {
  test(`rejects: ${name}`, () => {
    assert.throws(() => validateObservation(raw), (e) => e.code === code);
  });
}
