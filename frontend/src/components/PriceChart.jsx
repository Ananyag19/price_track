import { money } from "../format.js";

// Small dependency-free SVG line chart of price over time (oldest -> newest).
export default function PriceChart({ history }) {
  const points = [...history].reverse().map((h) => ({ t: new Date(h.scraped_at).getTime(), price: Number(h.price), currency: h.currency }));
  if (points.length < 2) return <p className="hint">The chart appears once there are at least two readings.</p>;

  const W = 640, H = 170, L = 64, R = 12, T = 12, B = 26;
  const prices = points.map((p) => p.price);
  const lo = Math.min(...prices), hi = Math.max(...prices);
  const pad = lo === hi ? Math.max(lo * 0.05, 1) : (hi - lo) * 0.15;
  const yMin = lo - pad, yMax = hi + pad;
  const t0 = points[0].t, t1 = points[points.length - 1].t;
  const x = (t) => L + (t1 === t0 ? 0.5 : (t - t0) / (t1 - t0)) * (W - L - R);
  const y = (v) => T + (1 - (v - yMin) / (yMax - yMin)) * (H - T - B);
  const currency = points[0].currency;
  const day = (t) => new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });

  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Price history, from ${money(points[0].price, currency)} to ${money(points[points.length - 1].price, currency)}`}>
      <line x1={L} y1={T} x2={L} y2={H - B} stroke="var(--line)" />
      <line x1={L} y1={H - B} x2={W - R} y2={H - B} stroke="var(--line)" />
      <text x={L - 6} y={y(hi) + 4} textAnchor="end" fontSize="11" fill="var(--muted)">{money(hi, currency)}</text>
      {lo !== hi && <text x={L - 6} y={y(lo) + 4} textAnchor="end" fontSize="11" fill="var(--muted)">{money(lo, currency)}</text>}
      <text x={L} y={H - 8} fontSize="11" fill="var(--muted)">{day(t0)}</text>
      <text x={W - R} y={H - 8} textAnchor="end" fontSize="11" fill="var(--muted)">{day(t1)}</text>
      <polyline fill="none" stroke="var(--accent)" strokeWidth="2" points={points.map((p) => `${x(p.t)},${y(p.price)}`).join(" ")} />
      {points.map((p) => (
        <circle key={p.t} cx={x(p.t)} cy={y(p.price)} r="3.5" fill="var(--accent)">
          <title>{`${new Date(p.t).toLocaleString()}: ${money(p.price, p.currency)}`}</title>
        </circle>
      ))}
    </svg>
  );
}
