import test from "node:test";
import assert from "node:assert/strict";
import { pickPrice, pickStock } from "../src/scraper/extract.js";

const p = (text, o = {}) => ({ text, struck: false, fontSize: 24, x: 100, y: 100, ...o });

test("ignores the struck-through list price and picks the selling price", () => {
  const r = pickPrice([p("₹1,999", { struck: true }), p("₹1,499")]);
  assert.equal(r.value, 1499);
});

test("ignores MRP-labelled and discount/savings text", () => {
  const r = pickPrice([p("MRP: ₹1,999", { fontSize: 18 }), p("Save ₹500", { fontSize: 16 }), p("₹1,499")]);
  assert.equal(r.value, 1499);
});

test("prefers the largest price when related products show smaller prices", () => {
  const r = pickPrice([p("₹1,499", { fontSize: 32 }), p("₹299", { fontSize: 14 }), p("₹4,999", { fontSize: 14 })]);
  assert.equal(r.value, 1499);
});

test("the same price shown twice is fine", () => {
  assert.equal(pickPrice([p("₹500"), p("₹500")]).value, 500);
});

test("different prices at the same size => ambiguous, never a guess", () => {
  assert.throws(() => pickPrice([p("₹500"), p("₹700")]), (e) => e.code === "price_ambiguous");
});

test("no usable price => price_not_found", () => {
  assert.throws(() => pickPrice([]), (e) => e.code === "price_not_found");
  assert.throws(() => pickPrice([p("₹999", { struck: true })]), (e) => e.code === "price_not_found");
  assert.throws(() => pickPrice([p("Reveal price")]), (e) => e.code === "price_not_found");
});

test("stock: nearest to the price wins over a related-product badge far away", () => {
  const anchor = { x: 100, y: 100 };
  const r = pickStock(
    [{ text: "Only 4 left", x: 110, y: 150 }, { text: "Out of stock", x: 900, y: 1500 }],
    anchor,
  );
  assert.deepEqual([r.status, r.quantity], ["low_stock", 4]);
});

test("stock: in-stock badge plus quantity line agree", () => {
  const r = pickStock([{ text: "In stock", x: 100, y: 140 }, { text: "12 units available", x: 100, y: 160 }], { x: 100, y: 100 });
  assert.deepEqual([r.status, r.quantity], ["in_stock", 12]);
});

test("stock: contradictory messages next to the price => ambiguous", () => {
  assert.throws(
    () => pickStock([{ text: "In stock", x: 100, y: 130 }, { text: "Out of stock", x: 100, y: 150 }], { x: 100, y: 100 }),
    (e) => e.code === "stock_ambiguous",
  );
});

test("stock: nothing recognisable => stock_not_found", () => {
  assert.throws(() => pickStock([{ text: "Free delivery", x: 0, y: 0 }], { x: 0, y: 0 }), (e) => e.code === "stock_not_found");
});
