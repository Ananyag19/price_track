import { ScrapeError, toScrapeError } from "./errors.js";
import { PRICE_LINE_SOURCE, STOCK_HINT_SOURCE } from "./parse.js";
import { pickPrice, pickStock } from "./extract.js";
import { applyChaos } from "./chaos.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const rand = (min, max) => min + Math.random() * (max - min);

const POLL_MS = 350;          // how often we look at the page while waiting for late content
const STABLE_MS = 800;        // a reading must stay identical this long before it is trusted
const CLICK_RETRY_MS = 3000;  // if "Reveal price" is still there this long after a click, the click was dropped
const MAX_REVEAL_CLICKS = 4;
const MAX_STORE_RETRIES = 3;

const DESKTOP_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const REVEAL_RE = /(reveal|show|view|get|see)\s+price/i;
const STORE_RETRY_RE = /^(retry|try again)$/i;
const OVERLAY_RE = /^(accept( all)?( cookies)?|i agree|agree|got it|ok(ay)?|allow( all)?|dismiss|close|no thanks)$/i;

/**
 * One scrape attempt: fresh context -> open product page -> get past the reveal gate ->
 * wait for a stable price + stock reading. Returns raw picks (validated later) or throws ScrapeError.
 */
export async function scrapeOnce({ browser, url, config, chaos, logger, headless }) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    locale: "en-IN",
    ...(headless ? { userAgent: DESKTOP_UA } : {}),
  });

  // Hard ceiling for the whole attempt. Closing the context aborts anything still in flight.
  let timedOut = false;
  const killer = setTimeout(() => {
    timedOut = true;
    context.close().catch(() => {});
  }, config.scrape.attemptTimeoutMs);

  try {
    const page = await context.newPage();
    await applyChaos(page, chaos, config.scrape);
    await navigate(page, url, config.scrape.navTimeoutMs, logger);
    return await acquireData(page, config.scrape.dataTimeoutMs, logger);
  } catch (err) {
    throw toScrapeError(err, { timedOut });
  } finally {
    clearTimeout(killer);
    await context.close().catch(() => {});
  }
}

async function navigate(page, url, timeout, logger) {
  logger.step(`Opening ${url} (timeout ${timeout / 1000}s)`);
  const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout });
  const status = response?.status();
  if (status === 404) {
    throw new ScrapeError("product_not_found", `Store returned 404 for ${url}`, { retryable: false });
  }
  if (status && status >= 400) {
    const retryable = status >= 500 || status === 408 || status === 429;
    throw new ScrapeError("http_error", `Store returned HTTP ${status}`, { retryable });
  }
}

/**
 * The heart of it: a single polling loop. On each tick it
 *   1. closes cookie/consent overlays,
 *   2. if a "Reveal price" gate is showing, hovers + clicks it (re-clicking if the click was dropped),
 *   3. otherwise reads the page, and accepts the data only once two readings ~1s apart agree.
 * Late-loaded content therefore just means "a few more ticks", not a special case.
 */
async function acquireData(page, timeoutMs, logger) {
  const deadline = Date.now() + timeoutMs;
  let clicks = 0;
  let storeRetries = 0;
  let lastClickAt = 0;
  let gateSeen = false;
  let lastError = null;
  let previous = null;
  let previousAt = 0;
  let warmedUp = false;

  while (Date.now() < deadline) {
    await dismissOverlay(page, logger);

    if (!warmedUp) {
      await wanderMouse(page); // the store expects some pointer activity before it trusts the visitor
      warmedUp = true;
    }

    const gate = await findVisible(page, "button, [role=\"button\"], a", REVEAL_RE);
    if (gate) {
      gateSeen = true;
      previous = null; // never trust numbers shown while the gate is still up
      if (clicks < MAX_REVEAL_CLICKS && Date.now() - lastClickAt > CLICK_RETRY_MS) {
        clicks++;
        lastClickAt = Date.now();
        logger.step(clicks === 1 ? "Found \"Reveal price\" - hovering, then clicking" : `Click #${clicks - 1} did not register - clicking again`);
        await humanClick(page, gate);
      }
      await sleep(POLL_MS);
      continue;
    }

    const retryBtn = await findVisible(page, "button, [role=\"button\"]", STORE_RETRY_RE);
    if (retryBtn && storeRetries < MAX_STORE_RETRIES) {
      storeRetries++;
      logger.step(`Store showed an error state - pressing its Retry button (${storeRetries}/${MAX_STORE_RETRIES})`);
      await retryBtn.click({ timeout: 2000 }).catch(() => {});
      previous = null;
      await sleep(POLL_MS);
      continue;
    }

    try {
      const snapshot = await readSnapshot(page);
      const price = pickPrice(snapshot.prices);
      const stock = pickStock(snapshot.stocks, price);
      const reading = { price, stock };
      lastError = null;

      if (previous && sameReading(previous, reading)) {
        if (Date.now() - previousAt >= STABLE_MS) {
          logger.step(`Stable reading: ${price.currency} ${price.value}, stock "${stock.text}"`);
          return reading;
        }
      } else {
        previous = reading;
        previousAt = Date.now();
      }
    } catch (err) {
      if (!(err instanceof ScrapeError)) throw err; // a real bug or a closed page, not "content not there yet"
      lastError = err;
      previous = null;
    }
    await sleep(POLL_MS);
  }

  if (gateSeen && (!lastError || lastError.code === "price_not_found")) {
    throw new ScrapeError("reveal_failed", `Clicked "Reveal price" ${clicks} time(s) but no price appeared within ${timeoutMs / 1000}s`);
  }
  throw lastError ?? new ScrapeError("price_not_found", `No price appeared within ${timeoutMs / 1000}s`);
}

const sameReading = (a, b) =>
  a.price.value === b.price.value &&
  a.price.currency === b.price.currency &&
  a.stock.status === b.stock.status &&
  a.stock.quantity === b.stock.quantity;

async function findVisible(page, selector, textRe) {
  const matches = page.locator(selector).filter({ hasText: textRe });
  const count = await matches.count().catch(() => 0);
  for (let i = 0; i < count; i++) {
    const item = matches.nth(i);
    if (await item.isVisible().catch(() => false)) return item;
  }
  return null;
}

async function dismissOverlay(page, logger) {
  const button = await findVisible(page, "button, [role=\"button\"]", OVERLAY_RE);
  if (button) {
    logger.step("Dismissing overlay");
    await button.click({ timeout: 2000 }).catch(() => {});
  }
}

async function wanderMouse(page) {
  for (let i = 0; i < 3; i++) {
    await page.mouse.move(rand(100, 1100), rand(100, 650), { steps: 15 });
    await sleep(rand(60, 140));
  }
}

/** Approach the button, dwell on it (the store wants a hover of more than ~600ms), then press. */
async function humanClick(page, locator) {
  await locator.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {});
  const box = await locator.boundingBox();
  if (!box) return;
  const x = box.x + box.width * rand(0.35, 0.65);
  const y = box.y + box.height * rand(0.35, 0.65);
  await page.mouse.move(x - rand(80, 200), y + rand(40, 100), { steps: 10 });
  await page.mouse.move(x, y, { steps: 25 });
  await sleep(rand(700, 950));
  await page.mouse.down();
  await sleep(rand(60, 120));
  await page.mouse.up();
}

/** Runs inside the page. Returns only elements a human could actually see, with the facts needed to rank them. */
function collectInPage({ priceSrc, stockSrc }) {
  const priceRe = new RegExp(priceSrc, "i");
  const stockRe = new RegExp(stockSrc, "i");
  const clean = (s) => (s || "").replace(/[\u200B-\u200D\uFEFF\u2060]/g, "").replace(/[\u00A0\u202F\s]+/g, " ").trim();

  const isVisible = (el) => {
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const s = getComputedStyle(n);
      if (s.display === "none" || s.visibility === "hidden" || s.visibility === "collapse") return false;
      if (parseFloat(s.opacity) === 0) return false;
      if (n.hidden || n.getAttribute("aria-hidden") === "true") return false;
      if (s.overflow === "hidden" || s.overflowX === "hidden" || s.overflowY === "hidden") {
        const b = n.getBoundingClientRect();
        if (b.width < 1 || b.height < 1) return false; // clipped to nothing
      }
    }
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    if (r.width < 1 || r.height < 1) return false;
    if (parseFloat(s.fontSize) < 4) return false;
    if (r.right + scrollX <= 0 || r.bottom + scrollY <= 0) return false; // parked off-screen
    if (s.color === "transparent" || /rgba\(\s*\d+,\s*\d+,\s*\d+,\s*0\s*\)/.test(s.color)) return false;
    return true;
  };

  const isStruck = (el) => {
    for (let n = el, i = 0; n && i < 5; n = n.parentElement, i++) {
      if (["S", "DEL", "STRIKE"].includes(n.tagName)) return true;
      if ((getComputedStyle(n).textDecorationLine || "").includes("line-through")) return true;
    }
    return false;
  };

  // "Leaf-most": if a child also matches, the child is the real element and this is just a wrapper.
  const childAlsoMatches = (el, re) => [...el.children].some((c) => re.test(clean(c.textContent)));

  const prices = [];
  const stocks = [];
  const skip = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE"]);

  for (const el of document.body.querySelectorAll("*")) {
    if (skip.has(el.tagName)) continue;
    const text = clean(el.textContent);
    if (!text || text.length > 60) continue;

    const isPrice = priceRe.test(text) && !childAlsoMatches(el, priceRe);
    const isStock = stockRe.test(text) && !childAlsoMatches(el, stockRe);
    if (!isPrice && !isStock) continue;
    if (!isVisible(el)) continue;

    const r = el.getBoundingClientRect();
    const base = { text, x: r.left + r.width / 2 + scrollX, y: r.top + r.height / 2 + scrollY };
    if (isPrice) prices.push({ ...base, struck: isStruck(el), fontSize: parseFloat(getComputedStyle(el).fontSize) || 0 });
    if (isStock) stocks.push(base);
  }
  return { prices, stocks };
}

async function readSnapshot(page) {
  return page.evaluate(collectInPage, { priceSrc: PRICE_LINE_SOURCE, stockSrc: STOCK_HINT_SOURCE });
}
