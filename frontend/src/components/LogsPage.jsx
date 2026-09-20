import { useCallback, useEffect, useState } from "react";
import { api } from "../api.js";
import LogTable from "./LogTable.jsx";

// The complete scrape log: every attempt for every product, newest first.
export default function LogsPage() {
  const [status, setStatus] = useState("");
  const [state, setState] = useState({ logs: [], loading: true, error: null });

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true }));
    try {
      setState({ logs: await api.allLogs(status), loading: false, error: null });
    } catch (err) {
      setState({ logs: [], loading: false, error: err.message });
    }
  }, [status]);

  useEffect(() => { load(); }, [load]);

  return (
    <section>
      <h2>Complete scrape log</h2>
      <p className="hint">Every attempt is recorded, including failures and retries. Newest first, up to 500 rows.</p>
      <div className="toolbar">
        <label htmlFor="status" className="muted small">Show</label>
        <select id="status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All attempts</option>
          <option value="success">Success only</option>
          <option value="retried">Retried only</option>
          <option value="failed">Failed only</option>
        </select>
        <button className="btn" onClick={load} disabled={state.loading}>{state.loading ? "Loading…" : "Refresh"}</button>
      </div>
      {state.error && <div className="banner error">{state.error}</div>}
      <LogTable logs={state.logs} showProduct />
    </section>
  );
}
