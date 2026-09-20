import { dateTime, money, stockLabel } from "../format.js";

const STATUS_TEXT = { success: "success", retried: "retried", failed: "failed" };

// One row per scrape attempt. Used for the per-product log and the complete log.
export default function LogTable({ logs, showProduct = false }) {
  if (logs.length === 0) return <p className="hint">No scrape attempts recorded yet.</p>;
  return (
    <div className="scroll">
      <table>
        <thead>
          <tr>
            <th>Time</th>
            {showProduct && <th>Product</th>}
            <th>Trigger</th>
            <th className="num">Attempt</th>
            <th>Result</th>
            <th>Details</th>
            <th className="num">Duration</th>
          </tr>
        </thead>
        <tbody>
          {logs.map((l) => (
            <tr key={l.id}>
              <td>{dateTime(l.created_at)}</td>
              {showProduct && <td>{l.tracked_products?.name ?? "—"}</td>}
              <td>{l.trigger}</td>
              <td className="num">{l.attempt_number}</td>
              <td className={`status-${l.status}`}>{STATUS_TEXT[l.status] ?? l.status}</td>
              <td className="small">
                {l.status === "success" ? (
                  `${money(l.price, l.currency)} · ${stockLabel(l.stock_status, l.stock_quantity)}`
                ) : (
                  <span className="err-text">{l.error_code}: {l.error_message}</span>
                )}
              </td>
              <td className="num">{l.duration_ms != null ? `${(l.duration_ms / 1000).toFixed(1)}s` : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
