# INE Product Price Tracker

A small full-stack app that tracks the **price and stock** of products in the INE mock store, keeps a history, and records **every scrape attempt, including the ones that fail**.

Built for the INE Software Engineer Intern assignment.

| | |
|---|---|
| **Live app** | https://price-track-flax.vercel.app |
| **Backend API** | https://price-track-7wg0.onrender.com/api/health |
| **Demo video** | _add your link here_ |
| **Target store** | https://demo.inelabteamdev.com/ (the only site the scraper visits) |

> The backend runs on Render's free plan, which sleeps when idle. The first request after a quiet period can take up to a minute.

---

## What it does

- **Search** the store by part or all of a product name (brand, SKU and category also match).
- **Track** a product. It is saved in the database and scraped straight away.
- See each tracked product's **current price and stock**.
- See the **price and stock history** as a table and a chart.
- See the **scrape log** for one product, or the complete log for all products, with success, retry and failure details.
- Prices refresh **automatically every 2 hours** through an external scheduler.

## Tech stack

| Part | Technology | Hosted on |
|---|---|---|
| Frontend | React 18 + Vite, plain CSS | Vercel |
| Backend | Node.js + Express | Render (Docker) |
| Database | PostgreSQL | Supabase |
| Scraping | `fetch` for the product list, Playwright (Chromium) for price and stock | inside the backend |
| Scheduler | cron-job.org, every 2 hours | cron-job.org |

No n8n and no AI browser agent: the scraper is ordinary, readable code.

## How it works

```
cron-job.org ──POST /api/scrape (every 2h, secret token)──► Express backend (Render)
                                                                 │ replies 202 at once
React app (Vercel) ──REST──► Express ──► queue (1 job at a time) ──► Scraper
                                                                 │
                              INE store ◄── Playwright ──────────┤  price + stock
                              INE store ◄── fetch ───────────────┘  product list (search)
                                                                 │
                                                        validate ─► Supabase
                                          (history only if valid, log always)
```

- **Search** uses the store's product list, fetched over plain HTTP. The list is paginated (hundreds of products over many pages), so the backend reads every page once, keeps it in memory for 5 minutes and searches that copy.
- **Price and stock** are not in that list. They appear only after the page runs its own JavaScript and you press "Reveal price", so this part needs a real browser (Playwright).
- **Scheduling is external** because free servers sleep. A timer inside the server would silently stop. cron-job.org wakes the server and triggers the scrape.
- Scrape requests return **202 immediately** and work in the background, because cron services give up after about 30 seconds.

## How the scraper stays reliable

| Problem | What the code does |
|---|---|
| Content loads late | Checks the page every ~0.35s. A reading is trusted only after it stays identical for about 0.8s, so spinners and placeholders are never saved. |
| Slow responses | Page-load timeout (20s), data timeout (25s) and a hard per-attempt limit (60s) that closes the browser. |
| Failed requests | Server errors, rate limits, network errors and timeouts are retried. A 404 is not retried. |
| Temporary problems | Up to **4 attempts**, waiting longer each time. Each attempt uses a **fresh browser session**, because the store's sessions are short-lived. |
| "Reveal price" check | Moves the mouse like a person, hovers on the button for about a second with small movements, then clicks. If the click is dropped, it clicks again. |
| Cookie banners | Clicked automatically on every attempt. Accepts first, declines if there is no accept button. |
| Decoy prices | Only prices a person could see count. Hidden, off-screen, transparent and crossed-out prices are ignored, as are "MRP" labels and "Save ₹200" badges. |
| Unclear page | If two different prices tie for the real one, or stock messages contradict each other, the attempt **fails** instead of guessing. |
| Page redesigns | No fixed CSS selectors. Elements are found by what they look like (price-shaped text, size, position). |
| Bad data | Checked before saving (price above zero, valid currency, consistent stock). The database enforces the same rules with `CHECK` constraints. |
| Honest failures | A failed scrape writes only to the log, never to the history. Every attempt is logged. |

**Log statuses:** `success` (this attempt worked), `retried` (this attempt failed, another follows), `failed` (out of attempts).

**Error codes you may see:** `timeout`, `network_error`, `http_error`, `product_not_found`, `reveal_failed`, `price_not_found`, `price_ambiguous`, `stock_not_found`, `stock_ambiguous`, `invalid_price`, `invalid_stock`, `attempt_timeout`, `browser_launch_failed`, `db_error`.

## Project layout

```
supabase/schema.sql          database tables, rules and indexes
render.yaml                  Render blueprint
backend/
  Dockerfile                 Playwright base image (Chromium included)
  src/
    server.js  app.js  config.js  logger.js
    routes/api.js            all endpoints
    db/repo.js  supabase.js  every database query
    scraper/
      catalogClient.js       product list + search (all pages, cache, retries)
      pageScraper.js         browser: open page, banners, reveal, read the page
      parse.js               text -> price / stock (pure functions)
      extract.js             which candidate is the real price / stock
      validate.js            last check before saving
      retry.js               retries with waiting, reports every attempt
      scrapeProduct.js       one product: scrape, validate, save, log
      runner.js              queue: one job at a time, browser lifecycle
      chaos.js               fault injection for the demo only
    scripts/scrapeHeaded.js  visible-browser run and demo
    scripts/probe.js         checks the store's product list
  test/                      unit and API tests (no browser needed)
  e2e/                       mock store + end-to-end scraper run
frontend/
  src/App.jsx  api.js
  src/components/            search, tracked list, details, chart, logs
```

## Database

Run `supabase/schema.sql` once in the Supabase SQL Editor.

| Table | Purpose |
|---|---|
| `tracked_products` | Products being tracked. "Stop tracking" only hides them; history and logs are kept. |
| `price_stock_history` | One row per successful, validated reading: price, currency, stock status, quantity, time. |
| `scrape_logs` | One row per attempt: time, product, run id, trigger, attempt number, status, error code and message, duration. |
| `tracked_products_overview` (view) | Each product with its latest reading and latest attempt. |

Row-level security is on with no public policies, so the public key can read nothing. Only the backend, using the service-role key, touches the tables.

## API

| Method | Path | Notes |
|---|---|---|
| GET | `/api/health` | Liveness and wake-up check |
| GET | `/api/products/search?q=` | Search the store |
| GET | `/api/tracked` | Tracked products with current price and stock |
| POST | `/api/tracked` | Body `{ "storeProductId": "705" }`. Details come from the store, not the request. Starts a first scrape. |
| DELETE | `/api/tracked/:id` | Stop tracking (history kept) |
| GET | `/api/tracked/:id/history` | Price and stock history |
| GET | `/api/tracked/:id/logs` | Scrape log for one product |
| GET | `/api/logs?status=&trigger=` | Complete scrape log. `trigger` is `cron`, `manual`, `track` or `headed`. |
| GET | `/api/status` | When the scheduler last fired |
| POST | `/api/tracked/:id/scrape` | Manual scrape, returns 202 |
| POST | `/api/scrape` | **Scheduler endpoint.** Needs `Authorization: Bearer <CRON_SECRET>`. Returns 202. |

## Run it locally

You need Node.js 18.18 or newer (22 recommended) and a free Supabase project.

**1. Database**
1. In Supabase, open **SQL Editor**, paste all of `supabase/schema.sql` and run it.
2. Open **Project Settings → API** and copy the Project URL and the `service_role` key.

**2. Backend**
```bash
cd backend
npm install
npx playwright install chromium
cp .env.example .env        # then fill it in
npm run probe               # checks the store's product list
npm run dev                 # http://localhost:3001
```

**3. Frontend** (a second terminal)
```bash
cd frontend
npm install
npm run dev                 # http://localhost:5173
```

Open the app, go to **Search store**, type part of a product name and press **Track**.

### Environment variables

Backend (`backend/.env`):

| Variable | Required | Default | Meaning |
|---|---|---|---|
| `SUPABASE_URL` | yes | | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | | Server-side key. Never expose it. |
| `CRON_SECRET` | yes | | Secret the scheduler sends as a Bearer token |
| `CORS_ORIGIN` | production | `*` | Allowed frontend addresses, comma separated |
| `PORT` | no | `3001` | Render sets this itself |
| `STORE_BASE_URL` | no | `https://demo.inelabteamdev.com` | The only site the scraper visits |
| `CATALOG_PATH` | no | `/api/catalog` | Product list path |
| `CATALOG_PAGE_SIZE` | no | `100` | Items requested per page |
| `PRODUCT_PATH` | no | `/api/product` | Single-product lookup, used as a fallback |
| `HEADLESS` | no | `true` | `false` shows the browser (local runs) |
| `SCRAPE_MAX_ATTEMPTS` | no | `4` | Attempts per product |
| `SCRAPE_NAV_TIMEOUT_MS` | no | `20000` | Page-load timeout |
| `SCRAPE_DATA_TIMEOUT_MS` | no | `25000` | Time allowed for the price to appear |
| `SCRAPE_ATTEMPT_TIMEOUT_MS` | no | `60000` | Hard limit per attempt |
| `SCRAPE_RETRY_BASE_DELAY_MS` | no | `1500` | Base wait between retries |
| `DEBUG_SCREENSHOT_DIR` | no | | e.g. `debug`: saves a screenshot when an attempt fails |
| `CHROMIUM_EXECUTABLE_PATH` | no | | Use an existing Chrome or Chromium |

Frontend (`frontend/.env` or Vercel settings):

| Variable | Meaning |
|---|---|
| `VITE_API_BASE_URL` | Backend address ending in `/api`, e.g. `https://price-track-7wg0.onrender.com/api`. Leave empty locally. |

## Running the scraper

Run these from `backend/`.

| Command | What it does |
|---|---|
| `npm run probe` | Checks the store's product list and reports how many products it can read |
| `npm run scrape:headed -- --product <id>` | One real scrape in a **visible browser**. Dry run: prints results, touches no database. |
| `npm run scrape:demo -- --product <id>` | Same, with injected faults: attempt 1 hangs past the timeout, attempt 2 fails at network level, attempt 3 is normal. Shows **slow → failure → retry → recovery**. |
| add `--save` | Also writes to Supabase, so the attempts appear in the web app's scrape log |
| add `--slowmo 500`, `--headless`, `--attempts 5` | Tune the run |
| `npm test` | 70 unit and API tests, no browser needed |
| `npm run e2e` | Runs the real scraper in Chromium against a local mock store (7 scenarios) |
| `npm run mock-store` | Starts the mock store on port 4000 for practice |

`<id>` is the number at the end of a product's store link (`/product/<id>`).

To make the app's own **Track** and **Scrape now** buttons open a visible browser, set `HEADLESS=false` in `backend/.env` and run both parts locally. A hosted server has no screen, so this works only on your own machine.

## Scheduling (every 2 hours)

1. Create a free account at [cron-job.org](https://cron-job.org) and click **Create cronjob**.
2. **URL:** `https://price-track-7wg0.onrender.com/api/scrape`
3. **Schedule:** every 2 hours (minute `0`, hours `0, 2, 4, … 22`).
4. **Advanced:** method `POST`, header `Authorization: Bearer <your CRON_SECRET>`.
5. Press **Test run**. Expect HTTP `202`.
6. Optional but recommended: a second job, `GET https://price-track-7wg0.onrender.com/api/health`, at minute `55` of odd hours. It wakes the free server before each real run.

**Note on timezones:** cron-job.org uses its own timezone (UTC by default), so runs can fall on the half hour in India time. The gap is still 2 hours.

**How to verify it:**
- In cron-job.org, open the job's **History** (`202` means success).
- In the app, open **Scrape log**. The banner shows when the scheduler last fired and turns red if it is overdue. Filter **Started by → Scheduler** to see only scheduled attempts. Rows sharing a **Run** id belong to one run.
- Test runs clicked in cron-job.org also appear as `cron`, so extra entries after setup are normal.

## Deployment

1. **Supabase:** create a project and run `supabase/schema.sql`.
2. **Render (backend):** New → Web Service → connect the GitHub repo.
   - Language **Docker**, Dockerfile path `backend/Dockerfile`, Docker build context `backend`.
   - Instance type **Free**. Health check path `/api/health`.
   - Environment: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, `CORS_ORIGIN`, `STORE_BASE_URL`, `HEADLESS=true`. Do not set `PORT`.
3. **Vercel (frontend):** New Project → import the repo → Root Directory `frontend`. Add `VITE_API_BASE_URL` with the Render address ending in `/api`.
4. Set `CORS_ORIGIN` on Render to your Vercel address(es), comma separated, no trailing slash. Use the short public address, not a per-deployment one.
5. Turn off Vercel's deployment login protection if others should open the site (**Settings → Deployment Protection**).
6. Create the cron-job.org jobs above.

Render and Vercel redeploy automatically on every push to the main branch.

## Troubleshooting

| Symptom | Likely cause and fix |
|---|---|
| Frontend says "Backend unreachable" | `CORS_ORIGIN` on Render does not include the frontend's exact address, or `VITE_API_BASE_URL` is missing or does not end in `/api`. Redeploy Vercel after changing it. |
| Search shows nothing | Run `npm run probe`. Check `CATALOG_PATH` and that the store is reachable. |
| Track says the product is not listed | Search again and pick it from the new results. The store's list can change between loads. |
| `browser_launch_failed` | Run `npx playwright install chromium` (local). |
| `reveal_failed` on some attempts | Common on the real store. Retries usually fix it. Check the `page says:` text in the log line. Set `DEBUG_SCREENSHOT_DIR=debug` for a screenshot. |
| Price never appears on one computer only | The store checks the device (clock, graphics, security software). Check the system clock and graphics acceleration, and try another computer. |
| Chart does not show | It needs at least two successful readings. Press **Scrape now** again. |
| cron History shows 401 | The `Authorization: Bearer …` header is wrong. |
| cron History shows a timeout on the first run | The server was asleep. Add the wake-up job. |
| No scheduled runs in the log | The cron job does not exist or is disabled. |

## Limitations

- **The live store is deliberately awkward.** It hides prices behind a device and pointer check. Some first attempts fail, so each product can take about 45 seconds. The retries make the final result reliable.
- **Strict on purpose.** If the page is unclear, the scraper logs a failure instead of saving a guess. A gap in the history is better than a wrong price.
- **Free-tier limits.** The Render free plan has about 512 MB of memory, so scraping runs one product at a time. It also sleeps when idle.
- **The manual "Scrape now" endpoint has no login.** It is only guarded by an "already running" check, which is fine for a demo but not for real use.
- **Logs are never deleted.** A long-running deployment would need a clean-up job.

## Security notes

- The Supabase **service-role key** lives only on the backend and is never sent to the browser.
- The scheduler endpoint needs a secret token, compared in constant time.
- Product details come from the store, never from the request body, and the scraper only builds URLs from the configured store address and a validated product id.
- Database tables have row-level security on with no public access.
- `.env` files are git-ignored. Never commit them.

## Author

_Your name, and a link to your GitHub or LinkedIn._
