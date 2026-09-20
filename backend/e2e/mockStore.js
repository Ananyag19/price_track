// A local imitation of the INE store's awkward behaviours, so the scraper can be exercised
// (and demoed) offline and deterministically. It is NOT the real store - it reproduces the
// traps that were observed/documented: JS-rendered page, cookie overlay, a "Reveal price" gate
// that needs pointer movement + a hover dwell, dropped clicks, late-arriving price and stock,
// hidden/off-screen decoy prices, a struck-through MRP, zero-width characters, related products.
import http from "node:http";

export const PRODUCTS = [
  { id: 1, name: "Aurora Wireless Headphones", brand: "Sonic", sku: "SN-100", category: "Audio", price: 1499, mrp: 1999, stock: "Only 3 left", dropFirstClick: true },
  { id: 2, name: "Nimbus Travel Backpack", brand: "Trail", sku: "TR-220", category: "Bags", price: 799, mrp: 999, stock: "Out of stock" },
  { id: 3, name: "Stubborn Desk Lamp", brand: "Lumen", sku: "LM-030", category: "Home", price: 649, mrp: 799, stock: "In stock", neverReveal: true },
  { id: 4, name: "Flaky Electric Kettle", brand: "Brew", sku: "BR-777", category: "Kitchen", price: 2199, mrp: 2599, stock: "12 in stock", failFirst: 2 },
  { id: 5, name: "Sleepy Bluetooth Speaker", brand: "Sonic", sku: "SN-500", category: "Audio", price: 3299, mrp: 3999, stock: "In stock", slowFirstMs: 6000 },
  { id: 6, name: "Ghost Item (page 404s)", brand: "None", sku: "GH-000", category: "Misc", price: 1, mrp: 2, stock: "In stock", missing: true },
];

const page = (p) => `<!doctype html><html><head><title>INE Store</title><style>
body{font-family:sans-serif;margin:24px;max-width:900px}
#overlay{position:fixed;inset:0;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;z-index:9}
#overlay .box{background:#fff;padding:24px;border-radius:6px}
.price{font-size:32px;font-weight:700}.mrp{font-size:18px;text-decoration:line-through;color:#888;margin-right:8px}
.badge{font-size:14px;color:green;margin-left:8px}.stock{font-size:16px;margin-top:8px}
.related{margin-top:900px}.related .price{font-size:14px}.spinner{color:#666}
button.reveal{font-size:18px;padding:12px 20px}
</style></head><body><div id="app">Loading…</div><script>
const P = ${JSON.stringify(p)};
const fmt = (n) => n.toLocaleString("en-IN");
let moves = 0, hoverStart = 0, clicks = 0;
document.addEventListener("mousemove", () => moves++);

setTimeout(() => {                                   // late-rendered shell
  document.getElementById("app").innerHTML =
    "<h1>" + P.name + "</h1><p>" + P.brand + " · " + P.sku + "</p><div id=info><button class=reveal id=reveal>Reveal price</button></div>";
  const btn = document.getElementById("reveal");
  btn.addEventListener("mouseenter", () => (hoverStart = Date.now()));
  btn.addEventListener("mouseleave", () => (hoverStart = 0));
  btn.addEventListener("click", () => {
    clicks++;
    const dwell = hoverStart ? Date.now() - hoverStart : 0;
    if (P.neverReveal || moves < 3 || dwell < 600 || (P.dropFirstClick && clicks === 1)) return; // silently dropped
    btn.remove();
    const info = document.getElementById("info");
    info.innerHTML = "<span class=spinner>Fetching price…</span>";
    setTimeout(() => showPrice(info), 1500);
  });
}, 1200);

setTimeout(() => {                                   // cookie overlay appears after the page looks ready
  const o = document.createElement("div");
  o.id = "overlay";
  o.innerHTML = "<div class=box>We use cookies. <button id=accept>Accept</button></div>";
  document.body.appendChild(o);
  document.getElementById("accept").onclick = () => o.remove();
}, 500);

function showPrice(info) {
  const shown = fmt(P.price).replace(",", ",\\u200B");          // zero-width char inside the number
  info.innerHTML =
    "<span class=mrp>₹" + fmt(P.mrp) + "</span>" +
    "<span class=price>₹" + shown + "</span>" +
    "<span class=badge>Save ₹" + fmt(P.mrp - P.price) + "</span>" +
    "<span style=\\"display:none;font-size:48px\\">₹1,111</span>" +                   // hidden decoy (bigger than the real price)
    "<span style=\\"visibility:hidden;font-size:48px\\">₹2,222</span>" +              // invisible decoy
    "<span style=\\"position:absolute;left:-9999px;font-size:48px\\">₹3,333</span>" + // off-screen decoy
    "<span style=\\"opacity:0;font-size:48px\\">₹4,444</span>";                       // transparent decoy
  setTimeout(() => {                                             // stock arrives late, first as a placeholder
    const s = document.createElement("div");
    s.className = "stock";
    s.textContent = P.stock === "Out of stock" ? "Out of stock" : "In stock";
    info.appendChild(s);
    setTimeout(() => (s.textContent = P.stock), 900);            // then settles on the real value
  }, 300);
  document.getElementById("app").insertAdjacentHTML("beforeend",
    "<div class=related><h3>You may also like</h3><div>Mini Widget <span class=price>₹299</span> <span>Out of stock</span></div></div>");
}
</script></body></html>`;

export function startMockStore(port = 0) {
  const hits = new Map();
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    if (url.pathname === "/api/catalog") {
      res.setHeader("content-type", "application/json; charset=utf-8");
      return res.end(JSON.stringify({ products: PRODUCTS.map(({ id, name, brand, sku, category }) => ({ id, name, brand, sku, category })) }));
    }
    const m = /^\/product\/(\d+)$/.exec(url.pathname);
    const p = m && PRODUCTS.find((x) => x.id === Number(m[1]));
    if (!p || p.missing) {
      res.statusCode = 404;
      return res.end("Not found");
    }

    const n = (hits.get(p.id) ?? 0) + 1;
    hits.set(p.id, n);
    if (p.failFirst && n <= p.failFirst) {
      res.statusCode = 503;
      return res.end("Service unavailable");
    }
    const send = () => {
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.end(page(p));
    };
    if (p.slowFirstMs && n === 1) return setTimeout(send, p.slowFirstMs);
    send();
  });
  return new Promise((resolve) =>
    server.listen(port, "127.0.0.1", () =>
      resolve({
        server,
        url: `http://127.0.0.1:${server.address().port}`,
        resetHits: () => hits.clear(),
        close: () => server.close(),
      }),
    ),
  );
}

// `node e2e/mockStore.js` runs it standalone so you can point STORE_BASE_URL at it and rehearse the demo offline.
if (import.meta.url === `file://${process.argv[1]}`) {
  const { url } = await startMockStore(Number(process.env.PORT) || 4000);
  console.log(`Mock INE store on ${url}  (try ${url}/product/1)`);
}
