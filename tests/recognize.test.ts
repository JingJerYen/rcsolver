import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { recognizeCube } from "../src/llm/recognize.js";
import { loadConfig } from "../src/config.js";
import { AppError } from "../src/errors.js";
import { FACES } from "../src/cube.js";

/** A stand-in for the API that answers every message request with the given model output. */
async function withFakeApi(outputs: unknown[], run: (baseUrl: string, calls: () => number) => Promise<void>) {
  let calls = 0;
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const out = outputs[Math.min(calls, outputs.length - 1)];
      calls++;
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          id: "msg_test",
          type: "message",
          role: "assistant",
          model: "claude-test",
          content: [{ type: "text", text: JSON.stringify(out) }],
          stop_reason: "end_turn",
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 5 },
        }),
      );
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  try {
    await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, () => calls);
  } finally {
    server.close();
  }
}

const face = (rows: string[]) => ({ found: true, rows, confidence: rows.map((r) => "9".repeat(r.length)) });
const body = () => ({ faces: Object.fromEntries(FACES.map((f) => [f, { mediaType: "image/jpeg" as const, data: "/9j/4AAQ" }])) as never });

test("a photo without a cube is reported as NO_CUBE even when its grid is empty", async () => {
  const out = { size: 3, notes: [], ...Object.fromEntries(FACES.map((f) => [f, face(["WWW", "WWW", "WWW"])])) } as Record<string, unknown>;
  out.D = { found: false, rows: [], confidence: [] };
  out.L = { found: false, rows: [], confidence: [] };
  await withFakeApi([out], async (baseUrl, calls) => {
    const config = loadConfig({ RCSOLVER_ANTHROPIC_KEY: "sk-test", RCSOLVER_API_BASE_URL: baseUrl });
    await assert.rejects(recognizeCube(config, body()), (err: unknown) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.code, "NO_CUBE");
      assert.deepEqual((err.details as { faces: string[] }).faces, ["D", "L"]);
      return true;
    });
    assert.equal(calls(), 1, "no retry for a clear no-cube answer");
  });
});

test("a malformed grid is retried once and then fails as MODEL_OUTPUT_INVALID", async () => {
  const bad = { size: 3, notes: [], ...Object.fromEntries(FACES.map((f) => [f, face(["WW", "WW"])])) };
  await withFakeApi([bad], async (baseUrl, calls) => {
    const config = loadConfig({ RCSOLVER_ANTHROPIC_KEY: "sk-test", RCSOLVER_API_BASE_URL: baseUrl });
    await assert.rejects(recognizeCube(config, body()), (err: unknown) => err instanceof AppError && err.code === "MODEL_OUTPUT_INVALID");
    assert.equal(calls(), 2);
  });
});

test("a good grid comes back with its size", async () => {
  const good = { size: 2, notes: [], ...Object.fromEntries(FACES.map((f) => [f, face(["WW", "WW"])])) };
  await withFakeApi([good], async (baseUrl) => {
    const config = loadConfig({ RCSOLVER_ANTHROPIC_KEY: "sk-test", RCSOLVER_API_BASE_URL: baseUrl });
    const r = await recognizeCube(config, body());
    assert.equal(r.size, 2);
    assert.equal(r.recognition.faces.U.join(""), "WWWW");
  });
});
