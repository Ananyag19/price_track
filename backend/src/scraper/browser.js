import { chromium } from "playwright";

/**
 * One browser per scrape run (not per attempt): launching is the slow part, and each attempt still
 * gets a brand-new context (fresh cookies/session), which matters because the store issues
 * short-lived challenge tokens.
 */
export async function launchBrowser({ headless = true, slowMo = 0, executablePath } = {}) {
  return chromium.launch({
    headless,
    slowMo,
    executablePath,
    // Needed inside Docker/Render containers. Harmless for a visible local browser, so only used headless.
    args: headless ? ["--no-sandbox", "--disable-dev-shm-usage"] : ["--window-size=1280,900"],
  });
}
