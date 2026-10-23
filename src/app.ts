import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { Config } from "./config.js";
import { AppError } from "./errors.js";
import { log } from "./logger.js";
import { FACES } from "./cube.js";
import { RecognizeBodySchema } from "./schemas.js";
import { recognizeCube } from "./llm/recognize.js";
import { rateLimit, type IpResolver } from "./middleware/rateLimit.js";
import type { QuotaStore } from "./quota.js";

export interface AppDeps {
  config: Config;
  quota: QuotaStore;
  getIp: IpResolver;
}

/** Six faces × max image × base64 overhead, plus JSON slack. */
export function bodyLimitBytes(config: Config): number {
  return Math.ceil((6 * config.maxImageBytes * 4) / 3) + 64 * 1024;
}

export function createApp({ config, quota, getIp }: AppDeps) {
  const app = new Hono();

  app.get("/api/health", async (c) =>
    c.json({
      ok: true,
      mock: config.mockMode,
      mockReason: config.mockReason,
      model: config.model,
      effort: config.effort,
      dailyLimit: config.dailyLimit,
      dailyUsed: await quota.used(),
    }),
  );

  app.post(
    "/api/recognize",
    rateLimit(config.rateLimitPerMin, getIp),
    bodyLimit({
      maxSize: bodyLimitBytes(config),
      onError: () => {
        throw new AppError("BAD_REQUEST", "照片太大，請縮小後再送。", 413);
      },
    }),
    async (c) => {
      let raw: unknown;
      try {
        raw = await c.req.json();
      } catch {
        throw new AppError("BAD_REQUEST", "JSON 格式錯誤。");
      }
      const parsed = RecognizeBodySchema.safeParse(raw);
      if (!parsed.success) throw new AppError("BAD_REQUEST", "請求格式不正確。", 400, parsed.error.issues);
      const body = parsed.data;
      for (const f of FACES) {
        // base64 is 4/3 of the decoded size
        const bytes = Math.floor((body.faces[f].data.length * 3) / 4);
        if (bytes > config.maxImageBytes) {
          throw new AppError("BAD_REQUEST", `${f} 面的照片太大（${Math.round(bytes / 1024)} KB），請縮小後再送。`, 413);
        }
      }

      if (!config.mockMode) {
        const q = await quota.take(config.dailyLimit);
        if (!q.allowed) {
          log.warn("daily quota exceeded", { used: q.used, limit: config.dailyLimit });
          throw new AppError("QUOTA_EXCEEDED", "今天的辨識額度已用完，明天再試。", 503);
        }
      }

      const out = await recognizeCube(config, body);
      return c.json({ ok: true, ...out });
    },
  );

  app.notFound((c) => c.json({ ok: false, error: { code: "NOT_FOUND", message: "找不到這個端點。" } }, 404));

  app.onError((err, c) => {
    if (err instanceof AppError) {
      if (err.status >= 500) log.error("request failed", { code: err.code, message: err.message, details: err.details });
      return c.json({ ok: false, error: { code: err.code, message: err.message } }, err.status as 400);
    }
    log.error("unhandled error", { message: err.message });
    return c.json({ ok: false, error: { code: "INTERNAL", message: "伺服器發生錯誤。" } }, 500);
  });

  return app;
}
