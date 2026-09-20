-- INE Product Price Tracker - Supabase (PostgreSQL) schema
-- Run once in: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run
-- Safe to re-run: everything uses "if not exists" / "or replace".

-- 1. Products the user chose to track (persisted, so they survive restarts and redeploys)
create table if not exists tracked_products (
  id               uuid primary key default gen_random_uuid(),
  store_product_id text        not null unique,          -- the id in the store URL /product/<id>
  name             text        not null,
  brand            text,
  sku              text,
  category         text,
  image_url        text,
  product_url      text        not null,
  is_active        boolean     not null default true,    -- "stop tracking" sets false; history is kept
  created_at       timestamptz not null default now()
);

-- 2. Price + stock history. One row = one successful, validated observation.
--    Failed scrapes never appear here (they only appear in scrape_logs).
--    The CHECK constraints are a second line of defence: even a backend bug cannot store junk.
create table if not exists price_stock_history (
  id                 bigint generated always as identity primary key,
  tracked_product_id uuid          not null references tracked_products(id) on delete cascade,
  price              numeric(12,2) not null check (price > 0),
  currency           text          not null check (currency ~ '^[A-Z]{3}$'),
  stock_status       text          not null check (stock_status in ('in_stock', 'low_stock', 'out_of_stock')),
  stock_quantity     integer       check (stock_quantity is null or stock_quantity >= 0),
  scraped_at         timestamptz   not null default now(),
  constraint stock_qty_consistent check (
    (stock_status = 'out_of_stock' and coalesce(stock_quantity, 0) = 0)
    or (stock_status <> 'out_of_stock' and coalesce(stock_quantity, 1) > 0)
  )
);
create index if not exists price_stock_history_product_time
  on price_stock_history (tracked_product_id, scraped_at desc);

-- 3. Every scrape ATTEMPT, successful or not. This is the honest audit trail.
create table if not exists scrape_logs (
  id                 bigint generated always as identity primary key,
  run_id             uuid        not null,               -- groups the attempts of one scheduled/manual run
  tracked_product_id uuid        not null references tracked_products(id) on delete cascade,
  trigger            text        not null check (trigger in ('cron', 'manual', 'track', 'headed')),
  attempt_number     integer     not null check (attempt_number >= 1),
  status             text        not null check (status in ('success', 'retried', 'failed')),
  --   success = this attempt produced valid data
  --   retried = this attempt failed, another attempt follows
  --   failed  = this attempt failed and no more attempts will be made
  error_code         text,
  error_message      text,
  price              numeric(12,2),
  currency           text,
  stock_status       text,
  stock_quantity     integer,
  duration_ms        integer,
  created_at         timestamptz not null default now(),
  constraint log_shape check (
    (status = 'success' and price is not null and stock_status is not null)
    or (status <> 'success' and error_code is not null)
  )
);
create index if not exists scrape_logs_product_time on scrape_logs (tracked_product_id, created_at desc);
create index if not exists scrape_logs_time         on scrape_logs (created_at desc);
create index if not exists scrape_logs_run          on scrape_logs (run_id);

-- 4. Convenience view for the dashboard list: each tracked product with its latest good reading
--    and the outcome of its most recent attempt.
create or replace view tracked_products_overview as
select
  tp.*,
  h.price          as price,
  h.currency       as currency,
  h.stock_status   as stock_status,
  h.stock_quantity as stock_quantity,
  h.scraped_at     as last_success_at,
  l.status         as last_attempt_status,
  l.created_at     as last_attempt_at,
  l.error_code     as last_error_code,
  l.error_message  as last_error_message
from tracked_products tp
left join lateral (
  select * from price_stock_history where tracked_product_id = tp.id order by scraped_at desc limit 1
) h on true
left join lateral (
  select * from scrape_logs where tracked_product_id = tp.id order by created_at desc, id desc limit 1
) l on true;

alter view tracked_products_overview set (security_invoker = true);

-- 5. Lock the tables down. Only the backend (service_role key) touches them; it bypasses RLS.
--    With RLS on and no policies, the public anon key cannot read or write anything.
alter table tracked_products    enable row level security;
alter table price_stock_history enable row level security;
alter table scrape_logs         enable row level security;
revoke all on tracked_products, price_stock_history, scrape_logs, tracked_products_overview from anon, authenticated;
