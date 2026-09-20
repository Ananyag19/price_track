import { dateTime, money, stockLabel } from "../format.js";

export default function TrackedList({ products, selectedId, onSelect }) {
  if (products.length === 0) {
    return <p className="hint">Nothing is being tracked yet. Use “Search store” to find a product and press Track.</p>;
  }
  return (
    <div className="scroll">
      <table>
        <thead>
          <tr>
            <th>Product</th>
            <th className="num">Price</th>
            <th>Stock</th>
            <th>Last successful reading</th>
            <th>Latest attempt</th>
          </tr>
        </thead>
        <tbody>
          {products.map((p) => (
            <tr
              key={p.id}
              className={`selectable ${p.id === selectedId ? "selected" : ""}`}
              tabIndex={0}
              aria-selected={p.id === selectedId}
              onClick={() => onSelect(p.id)}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onSelect(p.id))}
            >
              <td>{p.name}</td>
              <td className="num">{p.price !== null ? money(p.price, p.currency) : <span className="muted">—</span>}</td>
              <td>{p.stock_status ? stockLabel(p.stock_status, p.stock_quantity) : <span className="muted">—</span>}</td>
              <td>{p.last_success_at ? dateTime(p.last_success_at) : <span className="muted">none yet</span>}</td>
              <td>
                {p.last_attempt_status ? (
                  <span className={`status-${p.last_attempt_status}`}>{p.last_attempt_status}</span>
                ) : (
                  <span className="muted">waiting for first scrape</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
