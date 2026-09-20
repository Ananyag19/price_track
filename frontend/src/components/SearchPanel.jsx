import { useEffect, useState } from "react";
import { api } from "../api.js";

export default function SearchPanel({ onTrack }) {
  const [query, setQuery] = useState("");
  const [state, setState] = useState({ loading: false, error: null, results: null });
  const [busyId, setBusyId] = useState(null);

  // Debounced search: wait for a pause in typing, and ignore answers that arrive out of order.
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setState({ loading: false, error: null, results: null });
      return;
    }
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));
    const timer = setTimeout(async () => {
      try {
        const data = await api.search(q);
        if (!cancelled) setState({ loading: false, error: null, results: data.results });
      } catch (err) {
        if (!cancelled) setState({ loading: false, error: err.message, results: null });
      }
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [query]);

  async function track(product) {
    setBusyId(product.id);
    try {
      await onTrack(product.id);
      setState((s) => ({ ...s, results: s.results?.map((r) => (r.id === product.id ? { ...r, tracked: true } : r)) }));
    } catch (err) {
      setState((s) => ({ ...s, error: err.message }));
    } finally {
      setBusyId(null);
    }
  }

  const { loading, error, results } = state;

  return (
    <section>
      <h2>Search the INE store</h2>
      <p className="hint">Type part or all of a product name. Brand, SKU and category also match.</p>
      <label htmlFor="q" className="muted small">Product name</label><br />
      <input id="q" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="e.g. headphones" autoComplete="off" />

      <div style={{ marginTop: 12 }}>
        {error && <div className="banner error">{error}</div>}
        {loading && <p className="muted">Searching…</p>}
        {!loading && results && results.length === 0 && <p className="muted">No products match “{query.trim()}”. Try a shorter word.</p>}
        {results && results.length > 0 && (
          <div className="scroll">
            <table>
              <thead><tr><th>Name</th><th>Brand</th><th>SKU</th><th>Category</th><th /></tr></thead>
              <tbody>
                {results.map((p) => (
                  <tr key={p.id}>
                    <td>{p.name}</td>
                    <td>{p.brand ?? "—"}</td>
                    <td>{p.sku ?? "—"}</td>
                    <td>{p.category ?? "—"}</td>
                    <td className="num">
                      {p.tracked ? (
                        <span className="muted">Tracking</span>
                      ) : (
                        <button className="btn primary" disabled={busyId === p.id} onClick={() => track(p)}>
                          {busyId === p.id ? "Adding…" : "Track"}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
