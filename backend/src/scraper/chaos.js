// Fault injection for the recorded demo. It is NEVER active in scheduled/production runs:
// only scripts/scrapeHeaded.js --demo passes a plan.
//
//   slow -> the product page request hangs longer than the navigation timeout  (=> "timeout")
//   fail -> the product page request is aborted at network level               (=> "network_error")
//   null -> no interference: the real store is contacted normally               (=> recovery)

export const DEMO_PLAN = ["slow", "fail", null];

export async function applyChaos(page, mode, { navTimeoutMs }) {
  if (!mode) return;
  const isProductPage = (url) => url.pathname.startsWith("/product/");

  await page.route(isProductPage, async (route) => {
    if (route.request().resourceType() !== "document") return route.continue().catch(() => {});

    if (mode === "slow") {
      // Hold the response past the navigation timeout. By then the attempt has failed and the
      // context is closed, so the late continue() is expected to throw; ignore it.
      await new Promise((resolve) => setTimeout(resolve, navTimeoutMs + 3000));
      return route.continue().catch(() => {});
    }
    if (mode === "fail") return route.abort("connectionfailed").catch(() => {});
    return route.continue().catch(() => {});
  });
}
