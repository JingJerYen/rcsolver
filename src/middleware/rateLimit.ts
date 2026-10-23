import type { Context, MiddlewareHandler } from "hono";
import { AppError } from "../errors.js";

export type IpResolver = (c: Context) => string;

/**
 * Fixed-window per-IP limiter kept in memory. On Workers each isolate counts separately, so
 * treat it as a brake on accidental loops, not a hard guarantee; the daily quota is the real cap.
 */
export function rateLimit(limitPerMin: number, getIp: IpResolver): MiddlewareHandler {
  const windows = new Map<string, { start: number; count: number }>();
  return async (c, next) => {
    const now = Date.now();
    const ip = getIp(c);
    let w = windows.get(ip);
    if (!w || now - w.start >= 60_000) {
      w = { start: now, count: 0 };
      windows.set(ip, w);
    }
    w.count++;
    if (windows.size > 10_000) {
      for (const [k, v] of windows) if (now - v.start >= 60_000) windows.delete(k);
    }
    c.header("RateLimit-Limit", String(limitPerMin));
    c.header("RateLimit-Remaining", String(Math.max(0, limitPerMin - w.count)));
    if (w.count > limitPerMin) throw new AppError("RATE_LIMITED", "請求太頻繁，請稍後再試。", 429);
    await next();
  };
}

/** Client IP from proxy headers; `fallback` supplies the socket address where the runtime exposes one. */
export function headerIp(trustProxy: boolean, fallback?: IpResolver): IpResolver {
  return (c) => {
    const cf = c.req.header("cf-connecting-ip");
    if (cf) return cf;
    if (trustProxy) {
      const xff = c.req.header("x-forwarded-for");
      if (xff) return xff.split(",")[0]!.trim();
    }
    return fallback?.(c) ?? "unknown";
  };
}
