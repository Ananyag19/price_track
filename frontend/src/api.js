// Thin wrapper over fetch. Every backend call goes through here.
const BASE = (import.meta.env.VITE_API_BASE_URL || "/api").replace(/\/$/, "");

async function request(path, { method = "GET", body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    // Only send a content-type when there is a body; it avoids needless CORS preflights on GETs.
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* empty or non-JSON body */
  }
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
  return data;
}

export const api = {
  health: () => request("/health"),
  search: (q) => request(`/products/search?q=${encodeURIComponent(q)}`),
  tracked: () => request("/tracked"),
  track: (storeProductId) => request("/tracked", { method: "POST", body: { storeProductId } }),
  untrack: (id) => request(`/tracked/${id}`, { method: "DELETE" }),
  scrapeNow: (id) => request(`/tracked/${id}/scrape`, { method: "POST" }),
  history: (id) => request(`/tracked/${id}/history?limit=200`),
  logs: (id) => request(`/tracked/${id}/logs?limit=200`),
  allLogs: (status) => request(`/logs?limit=500${status ? `&status=${status}` : ""}`),
};
