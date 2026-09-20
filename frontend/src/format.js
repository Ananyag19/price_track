export function money(price, currency) {
  if (price === null || price === undefined) return "—";
  try {
    return new Intl.NumberFormat("en-IN", { style: "currency", currency: currency || "INR" }).format(price);
  } catch {
    return `${currency ?? ""} ${price}`;
  }
}

export function dateTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function stockLabel(status, quantity) {
  if (!status) return "—";
  const label = { in_stock: "In stock", low_stock: "Low stock", out_of_stock: "Out of stock" }[status] ?? status;
  return quantity !== null && quantity !== undefined && status !== "out_of_stock" ? `${label} (${quantity})` : label;
}
