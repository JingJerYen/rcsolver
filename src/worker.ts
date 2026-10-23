/**
 * Cloudflare Workers entry. Static files are served by the platform from ./public
 * (see wrangler.toml); only /api/* reaches this code.
 */
import { createApp } from "./app.js";
import { loadConfig, type EnvMap } from "./config.js";
import { headerIp } from "./middleware/rateLimit.js";
import { KvQuota, MemoryQuota, type KvLike, type QuotaStore } from "./quota.js";

type WorkerEnv = EnvMap & { QUOTA?: KvLike };

let cached: { env: WorkerEnv; app: ReturnType<typeof createApp> } | null = null;

function appFor(env: WorkerEnv) {
  if (cached && cached.env === env) return cached.app;
  const config = loadConfig(env);
  const quota: QuotaStore = env.QUOTA ? new KvQuota(env.QUOTA) : new MemoryQuota();
  const app = createApp({ config, quota, getIp: headerIp(true) });
  cached = { env, app };
  return app;
}

export default {
  fetch(request: Request, env: WorkerEnv, ctx: unknown): Promise<Response> | Response {
    return appFor(env).fetch(request, env, ctx as never);
  },
};
