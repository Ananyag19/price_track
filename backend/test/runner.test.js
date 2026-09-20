import test from "node:test";
import assert from "node:assert/strict";
import { createRunner } from "../src/scraper/runner.js";
import { silentLogger } from "../src/logger.js";

const tick = () => new Promise((r) => setTimeout(r, 20));

test("runner executes one job at a time and de-duplicates queued products", async () => {
  const order = [];
  let release;
  const gate = new Promise((r) => (release = r));
  const runner = createRunner({
    repo: { insertLog: async () => {}, insertHistory: async () => {} },
    config: { headless: true },
    logger: silentLogger,
    launch: async () => ({ close: async () => order.push("close") }),
    scrape: async ({ product }) => { order.push(`start ${product.id}`); await gate; order.push(`end ${product.id}`); },
  });

  const a = runner.enqueue([{ id: "A" }], "manual");
  const dup = runner.enqueue([{ id: "A" }], "manual");
  const b = runner.enqueue([{ id: "B" }], "manual");
  assert.equal(a.queued, 1);
  assert.equal(dup.queued, 0, "A is already queued/running");
  assert.equal(b.queued, 1);

  await tick();
  assert.deepEqual(order, ["start A"], "B must wait for A - only one Chromium at a time");
  release();
  await tick(); await tick();
  assert.deepEqual(order, ["start A", "end A", "close", "start B", "end B", "close"]);
  assert.equal(runner.isBusy(), false);
});

test("if the browser cannot launch, a failed log is written for every product (no silent skip)", async () => {
  const logs = [];
  const runner = createRunner({
    repo: { insertLog: async (e) => logs.push(e) },
    config: { headless: true },
    logger: silentLogger,
    launch: async () => { throw new Error("Executable doesn\x27t exist at /x"); },
    scrape: async () => assert.fail("should not scrape"),
  });
  runner.enqueue([{ id: "A" }, { id: "B" }], "cron");
  await tick();
  assert.equal(logs.length, 2);
  assert.ok(logs.every((l) => l.status === "failed" && l.error_code === "browser_launch_failed" && l.trigger === "cron"));
});

test("one product crashing does not stop the rest of the run", async () => {
  const done = [];
  const runner = createRunner({
    repo: {}, config: { headless: true }, logger: silentLogger,
    launch: async () => ({ close: async () => {} }),
    scrape: async ({ product }) => { if (product.id === "A") throw new Error("boom"); done.push(product.id); },
  });
  runner.enqueue([{ id: "A" }, { id: "B" }], "cron");
  await tick();
  assert.deepEqual(done, ["B"]);
});
