/** Environment values come from process.env (Node) or the Workers env binding; both are plain string maps. */
export type EnvMap = Record<string, string | undefined>;

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

function intEnv(env: EnvMap, name: string, fallback: number, min: number, max: number): number {
  const raw = env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function effortEnv(env: EnvMap, name: string, fallback: Effort): Effort {
  const raw = (env[name] ?? "").trim().toLowerCase();
  return raw === "low" || raw === "medium" || raw === "high" || raw === "xhigh" || raw === "max" ? raw : fallback;
}

export interface Config {
  port: number;
  apiKey: string | undefined;
  /** Where the SDK sends requests; only tests point this at a fake server. */
  apiBaseUrl: string | undefined;
  mockMode: boolean;
  mockReason: string | null;
  trustProxy: boolean;
  model: string;
  effort: Effort;
  maxTokens: number;
  /** Per-IP requests per minute on the model endpoint. */
  rateLimitPerMin: number;
  /** Site-wide model calls per UTC day; 0 disables the cap. */
  dailyLimit: number;
  /** Upper bound on one face image, in bytes of decoded JPEG/PNG/WebP. */
  maxImageBytes: number;
}

export function loadConfig(env: EnvMap): Config {
  const apiKey = env.RCSOLVER_ANTHROPIC_KEY?.trim() || undefined;
  const forcedMock = env.MOCK_MODE === "1";
  return {
    port: intEnv(env, "PORT", 3000, 1, 65535),
    apiKey,
    apiBaseUrl: env.RCSOLVER_API_BASE_URL?.trim() || undefined,
    mockMode: forcedMock || !apiKey,
    mockReason: forcedMock ? "MOCK_MODE=1" : apiKey ? null : "RCSOLVER_ANTHROPIC_KEY not set",
    trustProxy: env.TRUST_PROXY === "1",
    model: env.RECOGNIZE_MODEL?.trim() || "claude-opus-5-5",
    effort: effortEnv(env, "RECOGNIZE_EFFORT", "medium"),
    maxTokens: intEnv(env, "RECOGNIZE_MAX_TOKENS", 16000, 1000, 64000),
    rateLimitPerMin: intEnv(env, "RATE_LIMIT_PER_MIN", 6, 1, 1000),
    dailyLimit: intEnv(env, "DAILY_LIMIT", 100, 0, 1_000_000),
    maxImageBytes: intEnv(env, "MAX_IMAGE_BYTES", 400_000, 10_000, 5_000_000),
  };
}
