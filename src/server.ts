import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { getConnInfo } from "@hono/node-server/conninfo";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { log } from "./logger.js";
import { headerIp } from "./middleware/rateLimit.js";
import { MemoryQuota } from "./quota.js";

export function createNodeApp(env: NodeJS.ProcessEnv = process.env) {
  const config = loadConfig(env);
  const app = createApp({
    config,
    quota: new MemoryQuota(),
    getIp: headerIp(config.trustProxy, (c) => getConnInfo(c).remote.address ?? "unknown"),
  });
  // index.html is always revalidated; app.js / styles.css carry a ?v=<build> query and can be cached.
  app.use(
    "/*",
    serveStatic({
      root: "./public",
      onFound: (path, c) => {
        c.header("Cache-Control", path.endsWith(".html") ? "no-cache" : "public, max-age=31536000, immutable");
      },
    }),
  );
  return { app, config };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const { app, config } = createNodeApp();
  serve({ fetch: app.fetch, port: config.port }, () => {
    log.info("server started", {
      port: config.port,
      mode: config.mockMode ? "MOCK" : "LIVE",
      mockReason: config.mockReason,
      model: config.model,
      effort: config.effort,
      dailyLimit: config.dailyLimit,
    });
  });
}
