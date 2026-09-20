import { config } from "./config.js";
import { logger } from "./logger.js";
import { createApp } from "./app.js";
import { createSupabase } from "./db/supabase.js";
import { createRepo } from "./db/repo.js";
import { createCatalog } from "./scraper/catalogClient.js";
import { createRunner } from "./scraper/runner.js";

const repo = createRepo(createSupabase(config));
const catalog = createCatalog({ config, logger });
const runner = createRunner({ repo, config, logger });

const app = createApp({ config, logger, repo, catalog, runner });

app.listen(config.port, () => {
  logger.info(`API listening on :${config.port}  (store: ${config.storeBaseUrl})`);
  if (!config.cronSecret) logger.warn("CRON_SECRET is not set - POST /api/scrape will refuse all requests");
});
