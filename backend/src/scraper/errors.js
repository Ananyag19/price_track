// Every failure the scraper can report is a ScrapeError with a stable `code`.
// The code is what ends up in scrape_logs.error_code, so keep the names meaningful.
export class ScrapeError extends Error {
  constructor(code, message, { retryable = true, cause } = {}) {
    super(message);
    this.name = "ScrapeError";
    this.code = code;
    this.retryable = retryable;
    if (cause) this.cause = cause;
  }
}

// Playwright error messages carry multi-line "call log" noise; keep the useful first line.
const firstLine = (msg) => String(msg).split("\n")[0].slice(0, 300);

/** Turn anything thrown into a ScrapeError so the retry loop and the logs see one shape. */
export function toScrapeError(err, { timedOut = false } = {}) {
  if (err instanceof ScrapeError) return err;
  const msg = String(err?.message ?? err);

  if (timedOut) {
    return new ScrapeError("attempt_timeout", "Attempt exceeded its overall time limit and was aborted", { cause: err });
  }
  if (err?.name === "DbError") {
    return new ScrapeError("db_error", firstLine(msg), { cause: err });
  }
  if (/Executable doesn.t exist|Failed to launch|browserType\.launch/i.test(msg)) {
    // Retrying will not install a browser.
    return new ScrapeError("browser_launch_failed", firstLine(msg), { retryable: false, cause: err });
  }
  if (err?.name === "TimeoutError" || /timeout .*exceeded|timed out/i.test(msg)) {
    return new ScrapeError("timeout", firstLine(msg), { cause: err });
  }
  if (/net::ERR_|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|socket hang up|fetch failed/i.test(msg)) {
    return new ScrapeError("network_error", firstLine(msg), { cause: err });
  }
  if (/(Target|Browser|Context).*(closed)|has been closed/i.test(msg)) {
    return new ScrapeError("browser_closed", firstLine(msg), { cause: err });
  }
  return new ScrapeError("unexpected_error", firstLine(msg), { cause: err });
}
