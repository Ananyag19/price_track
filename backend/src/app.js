import express from "express";
import cors from "cors";
import { createApiRouter } from "./routes/api.js";

export function createApp(deps) {
  const { config, logger } = deps;
  const app = express();

  const origins = config.corsOrigin === "*" ? "*" : config.corsOrigin.split(",").map((s) => s.trim()).filter(Boolean);
  app.use(cors({ origin: origins }));
  app.use(express.json({ limit: "50kb" }));

  app.use("/api", createApiRouter(deps));

  app.use((req, res) => res.status(404).json({ error: "Not found" }));

  // Central error handler: clear message for the client, details only in the server log.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.name === "CatalogError") return res.status(502).json({ error: err.message });
    if (err.name === "DbError") {
      logger.error(`Database error: ${err.message}`);
      return res.status(500).json({ error: "Database error" });
    }
    if (err.type === "entity.parse.failed") return res.status(400).json({ error: "Invalid JSON body" });
    logger.error(err.stack || err.message);
    res.status(500).json({ error: "Internal server error" });
  });

  return app;
}
