# INE Product Price Tracker

Tracks the price and stock of products in the INE mock store (`https://demo.inelabteamdev.com/`), keeps a history, and records every scrape attempt, including the ones that fail.

Built for the INE Software Engineer Intern assignment.

| Piece | Choice | Hosted on |
|---|---|---|
| Frontend | React 18 + Vite (plain CSS, no UI kit) | Vercel |
| Backend | Node.js + Express | Render (Docker) |
| Database | PostgreSQL | Supabase |
| Scraper | `fetch` for the catalogue, Playwright (Chromium) for price and stock | inside the backend |
| Scheduler | cron-job.org, every 2 hours | cron-job.org |

No n8n, no AI browser agent: the scraper is ordinary, readable code.

---

## 1. How it works

```
cron-job.org  ──POST /api/scrape (every 2h, Bearer secret)──►  Express (Render)
                                                                   │  returns 202 immediately
React (Vercel) ──REST──► Express ──► queue (1 job at a time) ──► Scraper
                                                                   │
                                     INE store ◄── Playwright ─────┤  price + stock
                                     INE store ◄── fetch ──────────┘  catalogue (search)
                                                                   │
                                                          validate ─► Supabase
                                                       (history only if valid; log always)
```

- **Search** uses the store's catalogue JSON over plain HTTP. It is cached for 5 minutes, so typing in the search box does not hammer the store. Partial and full names work: every word you type must appear in the name, brand, SKU or category, and better matches rank first.
- **Price and stock** are not in that JSON. They are only shown after the page runs its own JavaScript and you press "Reveal price", so this part needs a real browser (Playwright). This is the "use Playwright when JavaScript rendering is genuinely required" rule from the brief.
- **Tracking** stores the product in Supabase (by the store's product id, never by display name) and queues a first scrape.
- **Scheduling** is external. Free-tier servers sleep, so a `setInterval` inside the server would silently stop. cron-job.org wakes the server and triggers the scrape.

## 2. Repository layout

```
supabase/schema.sql          tables, constraints, indexes, view, row-level security
render.yaml                  Render blueprint
backend/
  Dockerfile                 Playwright base image (Chromium included)
  src/
    server.js  app.js  config.js  logger.js
    routes/api.js            all endpoints
    db/repo.js  supabase.js  every database query lives in repo.js
    scraper/
      catalogClient.js       HTTP catalogue + search (cache, retries, stale-on-error)
      pageScraper.js         Playwright: open page, reveal gate, wait for data, read the DOM
      parse.js               text -> price / stock (pure functions)
      extract.js             which candidate is the REAL price / stock (pure functions)
      validate.js            last gate before the database (pure)
      retry.js               retry + backoff, reports every attempt (pure)
      scrapeProduct.js       ties it together for one product, writes the log
      runner.js              one-job-at-a-time queue, browser lifecycle
      chaos.js               fault injection for the demo only
    scripts/scrapeHeaded.js  visible-browser run / demo
    scripts/probe.js         checks the catalogue endpoint shape
  test/                      unit + API tests (no browser needed)
  e2e/                       mock store + end-to-end scraper run (needs Chromium)
frontend/
  src/App.jsx  api.js        state, polling, API client
  src/components/            SearchPanel, TrackedList, ProductDetail, PriceChart, LogTable, LogsPage
```

## 3. Scraper design (the important part)

**One attempt** (`pageScraper.js`): fresh browser context → open `/product/<id>` → loop until a trustworthy reading exists.

| Requirement | What the code does |
|---|---|
| Late-loaded content | A single polling loop (every 350 ms) re-reads the page until content shows up. "Late" is just "a few more ticks", not a special case. |
| Slow responses / timeouts | Navigation timeout (20 s), data timeout (25 s) and a hard per-attempt ceiling (60 s) that closes the browser context. |
| Request failures | HTTP 5xx/429/408, network errors and timeouts are retryable. A 404 is not retried (the product does not exist). |
| Retries | Up to 3 attempts, exponential backoff with jitter. **Each attempt uses a new browser context** (fresh session), because the store's tokens are short-lived. |
| Reveal gate | Finds the "Reveal price" button, moves the mouse in steps, dwells about 0.7 s on it, then clicks. If the button is still there 3 s later the click was dropped, so it clicks again (max 4). |
| Cookie/consent overlays | Dismissed automatically if they appear. |
| Decoy prices | Only elements a human can see count: `display:none`, `visibility:hidden`, `opacity:0`, zero size, off-screen and transparent text are ignored. Struck-through prices (`<s>`, `<del>`, `line-through`) and "MRP / was / original" labels are treated as the list price. "Save ₹200" style text is ignored. |
| Two similar prices | The selling price is the largest visible one. If several *different* values tie, the scrape **fails as `price_ambiguous`** rather than guessing. |
| Stock | The stock text closest to the chosen price wins, so a related product's "Out of stock" badge lower down cannot leak in. Contradictory messages fail as `stock_ambiguous`. |
| Transitional values | A reading is trusted only after it stays identical for about 0.8 s, so placeholders and spinners are not saved. The reveal gate must also be gone. |
| Text cleaning | Zero-width characters, non-breaking spaces, `₹`, `Rs.`, `INR`, commas are handled. |
| Page structure changes | No brittle CSS selectors or DOM positions. It finds things by what they *are* (visible text shaped like a price, near a stock message) and by what they look like (size, strikethrough). |
| Validation | Price must be a finite number > 0 with a 3-letter currency; stock must be `in_stock`, `low_stock` or `out_of_stock` with a consistent quantity. The database has matching `CHECK` constraints as a second line of defence. |
| Never save junk | Only validated data reaches `price_stock_history`. A failed scrape writes **only** to `scrape_logs`. |
| Honest logs | Every attempt is logged: `success`, `retried` (failed, another attempt follows) or `failed` (out of attempts), with an error code and message. If Chromium cannot even start, that is logged per product too. |

Error codes you will see: `timeout`, `network_error`, `http_error`, `product_not_found`, `reveal_failed`, `price_not_found`, `price_ambiguous`, `stock_not_found`, `stock_ambiguous`, `invalid_price`, `invalid_stock`, `attempt_timeout`, `browser_launch_failed`, `db_error`.

**Memory:** Chromium is heavy and free hosting has about 512 MB, so the runner executes **one job at a time** with one browser, and closes each context after each attempt.

## 4. Database (Supabase / PostgreSQL)

Run `supabase/schema.sql` once (see setup). It creates:

| Table | Purpose |
|---|---|
| `tracked_products` | Products being tracked (persisted). "Stop tracking" sets `is_active = false`, so history and logs are kept. |
| `price_stock_history` | One row per successful, validated reading: price, currency, stock status, stock quantity, timestamp. |
| `scrape_logs` | One row per attempt: timestamp, product, run id, trigger (`cron`/`manual`/`track`/`headed`), attempt number, status, error code/message, duration. |
| `tracked_products_overview` (view) | Each product with its latest reading and latest attempt, used by the dashboard list. |

Row-level security is on with no policies, so the public anon key can read nothing. Only the backend, using the service-role key, touches the tables.

## 5. API

| Method | Path | Notes |
|---|---|---|
| GET | `/api/health` | Liveness / wake-up ping |
| GET | `/api/products/search?q=` | Search the store (partial or full name) |
| GET | `/api/tracked` | Tracked products with current price/stock |
| POST | `/api/tracked` | Body `{ "storeProductId": "705" }`. Details come from the catalogue, not the request. Queues a first scrape. |
| DELETE | `/api/tracked/:id` | Stop tracking (history kept) |
| GET | `/api/tracked/:id/history` | Price/stock history |
| GET | `/api/tracked/:id/logs` | Per-product scrape log |
| GET | `/api/logs?status=` | Complete scrape log (all products) |
| POST | `/api/tracked/:id/scrape` | Manual scrape, returns `202` |
| POST | `/api/scrape` | **Scheduler endpoint.** Requires `Authorization: Bearer <CRON_SECRET>`. Returns `202` at once. |

Scrape endpoints return immediately and work in the background, because cron services give up after roughly 30 seconds while a scrape with retries can take minutes.

## 6. Local setup

Requirements: Node 18.18+ (22 recommended), a free Supabase project.

**Database**
1. Supabase → your project → **SQL Editor** → New query → paste `supabase/schema.sql` → Run.
2. **Project Settings → API**: copy the Project URL and the `service_role` key (keep it secret, never put it in the frontend).

**Backend**
```bash
cd backend
npm install
npx playwright install chromium     # one-time browser download
cp .env.example .env                # then fill in the values
npm run probe                       # checks the store catalogue endpoint (do this first)
npm run dev                         # http://localhost:3001
```

**Frontend**
```bash
cd frontend
npm install
npm run dev                         # http://localhost:5173 (proxies /api to :3001)
```

Then open the app → **Search store** → type part of a product name → **Track**.

## 7. Environment variables

Backend (`backend/.env`):

| Variable | Required | Default | Meaning |
|---|---|---|---|
| `SUPABASE_URL` | yes | | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | | Server-side key. Never expose it. |
| `CRON_SECRET` | yes | | Shared secret the scheduler sends as a Bearer token |
| `CORS_ORIGIN` | prod | `*` | Allowed frontend origin(s), comma separated |
| `PORT` | no | `3001` | Render sets this itself |
| `STORE_BASE_URL` | no | `https://demo.inelabteamdev.com` | The only site the scraper visits |
| `CATALOG_PATH` | no | `/api/catalog` | Catalogue JSON path |
| `HEADLESS` | no | `true` | `false` shows the browser (server runs) |
| `SCRAPE_MAX_ATTEMPTS` | no | `3` | Attempts per product |
| `SCRAPE_NAV_TIMEOUT_MS` | no | `20000` | Page-load timeout |
| `SCRAPE_DATA_TIMEOUT_MS` | no | `25000` | Time allowed for the reveal + data to appear |
| `SCRAPE_ATTEMPT_TIMEOUT_MS` | no | `60000` | Hard ceiling per attempt |
| `SCRAPE_RETRY_BASE_DELAY_MS` | no | `1500` | Backoff base (1.5 s, 3 s, 6 s…) |
| `CHROMIUM_EXECUTABLE_PATH` | no | | Use an existing Chrome/Chromium |

Frontend (`frontend/.env`, or Vercel project settings):

| Variable | Meaning |
|---|---|
| `VITE_API_BASE_URL` | Backend URL including `/api`, e.g. `https://ine-price-tracker-api.onrender.com/api`. Leave empty locally. |

## 8. Running the scraper

| Command (in `backend/`) | What it does |
|---|---|
| `npm run probe` | Calls the catalogue endpoint and prints its shape. Run first to confirm the store's JSON matches what the client expects. |
| `npm run scrape:headed -- --product 705` | One real scrape with a **visible browser**. Dry run: prints results and the attempt log, touches no database. |
| `npm run scrape:demo -- --product 705` | Same, plus injected faults: attempt 1 hangs past the timeout, attempt 2 fails at network level, attempt 3 is a normal request, so you see **slow → failure → retry → recovery**. |
| add `--save` | Also writes to Supabase (tracks the product and stores logs/history), so the same run shows up in the UI. |
| add `--slowmo 500` / `--headless` / `--attempts 5` | Tune the demo. |
| `npm test` | 58 unit and API tests, no browser needed. |
| `npm run e2e` | Runs the real scraper in Chromium against a local mock store (7 scenarios). |
| `npm run mock-store` | Starts that mock store on `:4000` for rehearsing offline (`STORE_BASE_URL=http://127.0.0.1:4000`). |

Replace `705` with any id from the store (`/product/<id>`). Scheduled or API-triggered scrapes: `curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://<backend>/api/scrape`.

### Recording the 2–4 minute demo

1. `cd backend && npm run scrape:demo -- --product <id> --save`, with the terminal and the browser window both visible.
2. Narrate as it goes:
   - Attempt 1: the page request hangs, the 8 s timeout fires → logged `retried: timeout`.
   - Attempt 2: the request fails at network level → logged `retried: network_error`.
   - Attempt 3: real page. Overlay dismissed, mouse hover, "Reveal price" clicked (a dropped click gets re-clicked), spinner, then a stable price and stock.
   - The terminal prints the attempt log and `Result: SUCCESS`.
3. Open the deployed frontend → the product → **Scrape log** to show the same three attempts stored in Supabase, then **History** for the saved reading.
4. Optionally show `npm run e2e` output to prove that failures save nothing.

The whole story takes about 1–2 minutes of run time; the rest is narration and the UI walkthrough.

## 9. Scheduling (every 2 hours, cron-job.org)

1. Create a free account at cron-job.org → **Create cronjob**.
2. **URL:** `https://<your-render-service>.onrender.com/api/scrape`
3. **Schedule:** every 2 hours (at minute 0).
4. **Advanced → Request method:** `POST`. **Headers:** `Authorization: Bearer <your CRON_SECRET>`.
5. Save, then use **Test run**: expect HTTP `202` and a `runId`. New rows appear in the **Scrape log** tab within a minute or two.

Two details worth knowing:
- The endpoint answers `202` immediately and scrapes in the background, so the cron service's short request timeout (about 30 seconds) is not a problem.
- On Render's free plan the service sleeps after about 15 minutes idle, and waking takes up to a minute. To avoid a timed-out first request, add a second cron job: `GET https://<service>.onrender.com/api/health` five minutes before each run (minute 55 of odd hours). It costs nothing and keeps the scheduled run reliable.

## 10. Deployment

1. **Supabase**: create the project and run `supabase/schema.sql` (section 6).
2. **Render (backend)**: push this repo to GitHub → New → **Blueprint** (uses `render.yaml`), or New → Web Service → runtime **Docker**, Dockerfile path `backend/Dockerfile`, context `backend`. Health check path `/api/health`. Set `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, `CORS_ORIGIN` (your Vercel URL, filled in after step 3).
3. **Vercel (frontend)**: New Project → import the repo → **Root Directory `frontend`**, framework Vite (build `npm run build`, output `dist`). Add `VITE_API_BASE_URL=https://<render-service>.onrender.com/api`. Deploy.
4. Go back to Render and set `CORS_ORIGIN` to the Vercel URL. Redeploy.
5. **cron-job.org**: create the jobs from section 9.
6. Check: open the Vercel site → the header shows "Backend connected" → search, track, and the first reading appears.

Live URLs (fill in after deploying):

- Frontend: `https://price-track-flax.vercel.app`
- Backend: `https://price-track-7wg0.onrender.com`
- Repository: `https://github.com/Ananyag19/price_track`

## 11. Notes and limitations

- **Verified against a mock, not the live store.** The scraper was tested end-to-end in real Chromium against a local mock that reproduces the store's documented behaviours (JS-rendered page, cookie overlay, reveal gate needing hover dwell, dropped clicks, late price and stock, hidden/off-screen/transparent decoys, struck-through MRP, zero-width characters). The live site could not be reached from the environment this was built in. **Before recording, run `npm run probe` and `npm run scrape:headed -- --product <id>` against the real store.** If the catalogue path or JSON field names differ, adjust `CATALOG_PATH` in `.env` or the `pick(...)` key lists in `catalogClient.js`; the failure will be a clear message, not bad data.
- **Heuristic extraction is deliberately strict.** If the live page shows two different prices at the same size, or a stock line that contradicts another nearby, the scrape fails with `price_ambiguous` / `stock_ambiguous` instead of guessing. Those codes tell you exactly what to look at in the headed run.
- **Free-tier limits.** About 512 MB RAM on Render's free plan is tight for Chromium; that is why scraping is serialised. If many products are tracked, a scheduled run takes a few minutes.
- **Manual scrape is public.** It is protected only by an "already running" check, which is acceptable for a demo. For real use, add authentication or rate limiting.
- **Logs are append-only and never pruned.** Add a retention job if this ran for months.
