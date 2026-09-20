// All SQL-ish access lives here so routes and the scraper never touch Supabase directly.

export class DbError extends Error {
  constructor(message) {
    super(message);
    this.name = "DbError";
  }
}

const clampLimit = (n, fallback = 100) => Math.min(Math.max(Number.parseInt(n, 10) || fallback, 1), 1000);

export function createRepo(client) {
  const run = async (query) => {
    const { data, error } = await query;
    if (error) throw new DbError(error.message);
    return data;
  };

  return {
    async listTracked() {
      return run(client.from("tracked_products_overview").select("*").eq("is_active", true).order("created_at", { ascending: false }));
    },

    async getTracked(id) {
      const rows = await run(client.from("tracked_products_overview").select("*").eq("id", id).limit(1));
      return rows[0] ?? null;
    },

    async listActiveTracked() {
      return run(client.from("tracked_products").select("*").eq("is_active", true).order("created_at"));
    },

    async listActiveStoreIds() {
      const rows = await run(client.from("tracked_products").select("store_product_id").eq("is_active", true));
      return new Set(rows.map((r) => r.store_product_id));
    },

    /** Track a product; re-tracking an untracked one simply reactivates it (its history is kept). */
    async trackProduct(p) {
      const rows = await run(
        client
          .from("tracked_products")
          .upsert(
            {
              store_product_id: p.store_product_id, name: p.name, brand: p.brand, sku: p.sku,
              category: p.category, image_url: p.image_url, product_url: p.product_url, is_active: true,
            },
            { onConflict: "store_product_id" },
          )
          .select(),
      );
      return rows[0];
    },

    async untrack(id) {
      const rows = await run(client.from("tracked_products").update({ is_active: false }).eq("id", id).select());
      return rows[0] ?? null;
    },

    /** Only ever called with validated data (the DB also enforces price > 0). */
    async insertHistory(trackedProductId, obs) {
      await run(
        client.from("price_stock_history").insert({
          tracked_product_id: trackedProductId,
          price: obs.price,
          currency: obs.currency,
          stock_status: obs.stockStatus,
          stock_quantity: obs.stockQuantity,
        }),
      );
    },

    async insertLog(entry) {
      await run(client.from("scrape_logs").insert(entry));
    },

    async listHistory(trackedProductId, limit = 200) {
      return run(
        client.from("price_stock_history").select("*").eq("tracked_product_id", trackedProductId)
          .order("scraped_at", { ascending: false }).limit(clampLimit(limit, 200)),
      );
    },

    /** Per-product logs when trackedProductId is given, otherwise the complete log across all products. */
    async listLogs({ trackedProductId, status, limit = 200 } = {}) {
      let q = client
        .from("scrape_logs")
        .select("*, tracked_products(name, store_product_id)")
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(clampLimit(limit, 200));
      if (trackedProductId) q = q.eq("tracked_product_id", trackedProductId);
      if (status) q = q.eq("status", status);
      return run(q);
    },
  };
}
