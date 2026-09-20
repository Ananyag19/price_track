import "dotenv/config";

const int = (value, fallback) => {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export const config = {
  port: int(process.env.PORT, 3001),
  corsOrigin: process.env.CORS_ORIGIN || "*",

  supabaseUrl: process.env.SUPABASE_URL || "",
  supabaseKey: process.env.SUPABASE_SERVICE_ROLE_KEY || "",
  cronSecret: process.env.CRON_SECRET || "",

  // The scraper only ever builds URLs from this origin. Nothing user-supplied becomes a URL.
  storeBaseUrl: (process.env.STORE_BASE_URL || "https://demo.inelabteamdev.com").replace(/\/+$/, ""),
  catalogPath: process.env.CATALOG_PATH || "/api/catalog",
  catalogPageSize: int(process.env.CATALOG_PAGE_SIZE, 100),

  headless: process.env.HEADLESS !== "false",
  chromiumExecutablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined,

  scrape: {
    maxAttempts: int(process.env.SCRAPE_MAX_ATTEMPTS, 3),
    navTimeoutMs: int(process.env.SCRAPE_NAV_TIMEOUT_MS, 20000),
    dataTimeoutMs: int(process.env.SCRAPE_DATA_TIMEOUT_MS, 25000),
    attemptTimeoutMs: int(process.env.SCRAPE_ATTEMPT_TIMEOUT_MS, 60000),
    retryBaseDelayMs: int(process.env.SCRAPE_RETRY_BASE_DELAY_MS, 1500),
  },
};
