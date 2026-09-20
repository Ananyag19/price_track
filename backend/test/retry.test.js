import test from "node:test";
import assert from "node:assert/strict";
import { runWithRetries } from "../src/scraper/retry.js";
import { ScrapeError } from "../src/scraper/errors.js";

const noSleep = async () => {};
const opts = (events, extra = {}) => ({
  maxAttempts: 3, baseDelayMs: 1, sleep: noSleep, onAttempt: async (e) => events.push(e), ...extra,
});

test("succeeds first time: one attempt, logged as success", async () => {
  const events = [];
  const r = await runWithRetries(async () => "ok", opts(events));
  assert.equal(r.ok, true);
  assert.deepEqual(events.map((e) => [e.attempt, e.ok, e.willRetry]), [[1, true, false]]);
});

test("fails twice then recovers: attempts 1-2 are willRetry, attempt 3 succeeds", async () => {
  const events = [];
  let n = 0;
  const r = await runWithRetries(async () => {
    if (++n < 3) throw new ScrapeError("timeout", "slow");
    return "price";
  }, opts(events));
  assert.equal(r.ok, true);
  assert.equal(r.attempts, 3);
  assert.deepEqual(events.map((e) => [e.ok, e.willRetry]), [[false, true], [false, true], [true, false]]);
});

test("exhausting all attempts reports failure, last attempt has willRetry=false", async () => {
  const events = [];
  const r = await runWithRetries(async () => { throw new ScrapeError("network_error", "down"); }, opts(events));
  assert.equal(r.ok, false);
  assert.equal(r.attempts, 3);
  assert.equal(r.error.code, "network_error");
  assert.deepEqual(events.map((e) => e.willRetry), [true, true, false]);
});

test("non-retryable errors stop immediately", async () => {
  const events = [];
  const r = await runWithRetries(async () => { throw new ScrapeError("product_not_found", "404", { retryable: false }); }, opts(events));
  assert.equal(r.attempts, 1);
  assert.equal(events.length, 1);
  assert.equal(events[0].willRetry, false);
});

test("plain (non-ScrapeError) exceptions are classified, not lost", async () => {
  const events = [];
  await runWithRetries(async () => { throw new Error("page.goto: net::ERR_CONNECTION_RESET at https://x"); }, opts(events, { maxAttempts: 1 }));
  assert.equal(events[0].error.code, "network_error");
});

test("waits between attempts (backoff grows)", async () => {
  const waits = [];
  await runWithRetries(async () => { throw new ScrapeError("timeout", "x"); }, {
    maxAttempts: 3, baseDelayMs: 100, onAttempt: async () => {}, sleep: async (ms) => waits.push(ms),
  });
  assert.equal(waits.length, 2);
  assert.ok(waits[0] >= 100 && waits[0] < 140);
  assert.ok(waits[1] >= 200 && waits[1] < 240);
});
