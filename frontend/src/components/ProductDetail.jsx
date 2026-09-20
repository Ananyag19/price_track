import { useEffect, useState } from "react";
import { api } from "../api.js";
import { dateTime, money, stockLabel } from "../format.js";
import PriceChart from "./PriceChart.jsx";
import LogTable from "./LogTable.jsx";

export default function ProductDetail({ product, scraping, onScrape, onUntrack }) {
  const [view, setView] = useState("history");
  const [data, setData] = useState({ history: [], logs: [], error: null, loading: true });

  // Reload whenever a new attempt or reading lands for this product.
  useEffect(() => {
    let cancelled = false;
    setData((d) => ({ ...d, loading: true }));
    Promise.all([api.history(product.id), api.logs(product.id)])
      .then(([history, logs]) => !cancelled && setData({ history, logs, error: null, loading: false }))
      .catch((err) => !cancelled && setData({ history: [], logs: [], error: err.message, loading: false }));
    return () => { cancelled = true; };
  }, [product.id, product.last_attempt_at, product.last_success_at]);

  const failing = product.last_attempt_status === "failed";

  return (
    <section className="detail" aria-label={`Details for ${product.name}`}>
      <div className="detail-head">
        <div>
          <h2>{product.name}</h2>
          <div className="muted small">
            {[product.brand, product.sku, product.category].filter(Boolean).join(" · ")}
            {" — "}
            <a href={product.product_url} target="_blank" rel="noreferrer">open in store</a>
          </div>
        </div>
        <div className="actions">
          <button className="btn primary" onClick={onScrape} disabled={scraping}>{scraping ? "Scraping…" : "Scrape now"}</button>
          <button className="btn" onClick={onUntrack}>Stop tracking</button>
        </div>
      </div>

      <dl className="facts">
        <div><dt>Current price</dt><dd className="big">{product.price !== null ? money(product.price, product.currency) : "—"}</dd></div>
        <div><dt>Current stock</dt><dd className="big">{product.stock_status ? stockLabel(product.stock_status, product.stock_quantity) : "—"}</dd></div>
        <div><dt>Last successful reading</dt><dd>{dateTime(product.last_success_at)}</dd></div>
        <div>
          <dt>Latest attempt</dt>
          <dd className={product.last_attempt_status ? `status-${product.last_attempt_status}` : "muted"}>
            {product.last_attempt_status ?? "none yet"}
          </dd>
        </div>
      </dl>

      {failing && (
        <div className="banner error">
          The latest scrape failed, so the price and stock above are from the last successful reading.
          <br /><span className="small">{product.last_error_code}: {product.last_error_message}</span>
        </div>
      )}

      <div className="subtabs" role="tablist">
        <button role="tab" aria-current={view === "history"} onClick={() => setView("history")}>Price &amp; stock history ({data.history.length})</button>
        <button role="tab" aria-current={view === "logs"} onClick={() => setView("logs")}>Scrape log ({data.logs.length})</button>
      </div>

      {data.error && <div className="banner error">{data.error}</div>}

      {view === "history" ? (
        data.history.length === 0 ? (
          <p className="hint">No successful readings yet. Failed attempts are listed under “Scrape log”.</p>
        ) : (
          <>
            <PriceChart history={data.history} />
            <div className="scroll">
              <table>
                <thead><tr><th>Time</th><th className="num">Price</th><th>Stock</th></tr></thead>
                <tbody>
                  {data.history.map((h) => (
                    <tr key={h.id}>
                      <td>{dateTime(h.scraped_at)}</td>
                      <td className="num">{money(h.price, h.currency)}</td>
                      <td>{stockLabel(h.stock_status, h.stock_quantity)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )
      ) : (
        <LogTable logs={data.logs} />
      )}
    </section>
  );
}
