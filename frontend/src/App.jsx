import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api.js";
import SearchPanel from "./components/SearchPanel.jsx";
import TrackedList from "./components/TrackedList.jsx";
import ProductDetail from "./components/ProductDetail.jsx";
import LogsPage from "./components/LogsPage.jsx";

const TABS = [
  ["tracked", "Tracked products"],
  ["search", "Search store"],
  ["logs", "Scrape log"],
];

export default function App() {
  const [tab, setTab] = useState("tracked");
  const [backend, setBackend] = useState("connecting"); // connecting | ok | error
  const [tracked, setTracked] = useState([]);
  const [loadError, setLoadError] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [scrapingIds, setScrapingIds] = useState(() => new Set());
  const burst = useRef(null);

  const loadTracked = useCallback(async () => {
    try {
      setTracked(await api.tracked());
      setLoadError(null);
      setBackend("ok");
    } catch (err) {
      setLoadError(err.message);
    }
  }, []);

  // Free-tier servers sleep; the first request can take about a minute. Tell the user instead of showing a blank page.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        await api.health();
        if (alive) setBackend("ok");
      } catch {
        if (alive) setBackend("error");
      }
    })();
    loadTracked();
    const timer = setInterval(loadTracked, 15000);
    return () => { alive = false; clearInterval(timer); };
  }, [loadTracked]);

  // After starting a scrape, refresh every 3s for up to ~2.5 minutes so the result appears without a manual reload.
  function watchForResults(ids) {
    setScrapingIds((s) => new Set([...s, ...ids]));
    clearInterval(burst.current);
    let ticks = 0;
    burst.current = setInterval(async () => {
      ticks++;
      const rows = await api.tracked().catch(() => null);
      if (rows) setTracked(rows);
      const done = rows && ids.every((id) => {
        const row = rows.find((r) => r.id === id);
        return row && row.last_attempt_status && row.last_attempt_status !== "retried";
      });
      if (ticks > 50 || done) {
        clearInterval(burst.current);
        setScrapingIds((s) => { const n = new Set(s); ids.forEach((id) => n.delete(id)); return n; });
      }
    }, 3000);
  }
  useEffect(() => () => clearInterval(burst.current), []);

  async function track(storeProductId) {
    const { product } = await api.track(storeProductId);
    await loadTracked();
    setSelectedId(product.id);
    watchForResults([product.id]);
  }

  async function scrapeNow(id) {
    try {
      await api.scrapeNow(id);
      watchForResults([id]);
    } catch (err) {
      setLoadError(err.message);
    }
  }

  async function untrack(id) {
    if (!window.confirm("Stop tracking this product? Its history and logs are kept.")) return;
    await api.untrack(id);
    setSelectedId(null);
    loadTracked();
  }

  const selected = tracked.find((p) => p.id === selectedId) ?? null;

  return (
    <>
      <header className="top">
        <div className="wrap">
          <div>
            <h1>INE Price Tracker</h1>
            <nav className="tabs" aria-label="Sections">
              {TABS.map(([id, label]) => (
                <button key={id} aria-current={tab === id ? "page" : undefined} onClick={() => setTab(id)}>{label}</button>
              ))}
            </nav>
          </div>
          <span className="muted small">
            {backend === "ok" ? "Backend connected" : backend === "connecting" ? "Connecting…" : "Backend unreachable"}
          </span>
        </div>
      </header>

      <main className="wrap">
        {backend === "connecting" && (
          <div className="banner">Connecting to the backend. On free hosting it can take up to a minute to wake up.</div>
        )}
        {loadError && <div className="banner error">{loadError}</div>}

        {tab === "tracked" && (
          <section>
            <h2>Tracked products</h2>
            <p className="hint">Select a product to see its price and stock history and its scrape log. Prices are refreshed every 2 hours.</p>
            <TrackedList products={tracked} selectedId={selectedId} onSelect={setSelectedId} />
            {selected && (
              <ProductDetail
                key={selected.id}
                product={selected}
                scraping={scrapingIds.has(selected.id)}
                onScrape={() => scrapeNow(selected.id)}
                onUntrack={() => untrack(selected.id)}
              />
            )}
          </section>
        )}

        {tab === "search" && (
          <SearchPanel
            onTrack={async (id) => {
              await track(id);
              setTab("tracked");
            }}
          />
        )}

        {tab === "logs" && <LogsPage />}
      </main>
    </>
  );
}
