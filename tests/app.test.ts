import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp, bodyLimitBytes } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { MemoryQuota, KvQuota, type KvLike } from "../src/quota.js";
import { FACES } from "../src/cube.js";

const b64 = "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBD";
const body = (size?: number) => ({ size, faces: Object.fromEntries(FACES.map((f) => [f, { mediaType: "image/jpeg", data: b64 }])) });

function mockApp(env: Record<string, string> = {}, quota = new MemoryQuota()) {
  const config = loadConfig({ MOCK_MODE: "1", ...env });
  return { app: createApp({ config, quota, getIp: () => "1.2.3.4" }), config };
}

async function post(app: ReturnType<typeof mockApp>["app"], payload: unknown) {
  return app.request("/api/recognize", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
}

test("health reports mock mode and quota", async () => {
  const { app } = mockApp();
  const res = await app.request("/api/health");
  const j = await res.json();
  assert.equal(j.ok, true);
  assert.equal(j.mock, true);
  assert.equal(j.dailyUsed, 0);
});

test("recognize in mock mode returns a full grid for the requested size", async () => {
  const { app } = mockApp();
  const res = await post(app, body(4));
  assert.equal(res.status, 200);
  const j = await res.json();
  assert.equal(j.ok, true);
  assert.equal(j.mock, true);
  assert.equal(j.size, 4);
  assert.equal(j.sizeMismatch, null);
  assert.equal(j.recognition.faces.U.length, 4);
  assert.equal(j.recognition.faces.U[0].length, 4);
  assert.deepEqual(j.warnings, []);
});

test("recognize without a size hint still answers (mock defaults to 3)", async () => {
  const { app } = mockApp();
  const res = await post(app, body());
  assert.equal(res.status, 200);
  assert.equal((await res.json()).size, 3);
});

test("bad bodies are rejected with BAD_REQUEST", async () => {
  const { app } = mockApp();
  assert.equal((await post(app, { size: 3 })).status, 400);
  const res = await app.request("/api/recognize", { method: "POST", headers: { "content-type": "application/json" }, body: "{" });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error.code, "BAD_REQUEST");
});

test("an oversized face image is refused before any model call", async () => {
  const { app } = mockApp({ MAX_IMAGE_BYTES: "10000" });
  const big = body();
  big.faces.U = { mediaType: "image/jpeg", data: "A".repeat(20_000) };
  const res = await post(app, big);
  assert.equal(res.status, 413);
  assert.match((await res.json()).error.message, /U 面/);
});

test("per-IP rate limit kicks in after the configured count", async () => {
  const { app } = mockApp({ RATE_LIMIT_PER_MIN: "2" });
  assert.equal((await post(app, body())).status, 200);
  assert.equal((await post(app, body())).status, 200);
  const res = await post(app, body());
  assert.equal(res.status, 429);
  assert.equal((await res.json()).error.code, "RATE_LIMITED");
});

test("daily quota blocks live calls but not mock ones", async () => {
  const quota = new MemoryQuota();
  assert.deepEqual(await quota.take(2), { allowed: true, used: 1 });
  assert.deepEqual(await quota.take(2), { allowed: true, used: 2 });
  assert.deepEqual(await quota.take(2), { allowed: false, used: 2 });
  assert.deepEqual(await quota.take(0), { allowed: true, used: 3 });
  const { app } = mockApp({ DAILY_LIMIT: "1" }, quota);
  assert.equal((await post(app, body())).status, 200, "mock calls never count");
});

test("KV-backed quota counts and expires per day", async () => {
  const store = new Map<string, string>();
  const kv: KvLike = {
    async get(k) {
      return store.get(k) ?? null;
    },
    async put(k, v, o) {
      assert.ok(o?.expirationTtl);
      store.set(k, v);
    },
  };
  const q = new KvQuota(kv);
  assert.deepEqual(await q.take(1), { allowed: true, used: 1 });
  assert.deepEqual(await q.take(1), { allowed: false, used: 1 });
  assert.equal(await q.used(), 1);
});

test("body limit scales with the image cap", () => {
  const { config } = mockApp({ MAX_IMAGE_BYTES: "300000" });
  assert.ok(bodyLimitBytes(config) > 6 * 300000);
});
