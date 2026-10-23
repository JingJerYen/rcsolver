import { test } from "node:test";
import assert from "node:assert/strict";
import { ModelOutputSchema, RecognizeBodySchema, shapeProblems } from "../src/schemas.js";
import { countWarnings, colorCounts, FACES } from "../src/cube.js";
import { mockRecognition } from "../src/llm/mock.js";

const b64 = "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBD";

test("request body: six faces with base64 and a size from 2 to 7", () => {
  const faces = Object.fromEntries(FACES.map((f) => [f, { mediaType: "image/jpeg", data: b64 }]));
  assert.ok(RecognizeBodySchema.safeParse({ size: 3, faces }).success);
  assert.ok(RecognizeBodySchema.safeParse({ faces }).success, "size is optional");
  assert.ok(!RecognizeBodySchema.safeParse({ size: 8, faces }).success);
  assert.ok(!RecognizeBodySchema.safeParse({ size: 3, faces: { ...faces, U: undefined } }).success);
  assert.ok(!RecognizeBodySchema.safeParse({ size: 3, faces: { ...faces, U: { mediaType: "image/gif", data: b64 } } }).success);
  assert.ok(!RecognizeBodySchema.safeParse({ size: 3, faces: { ...faces, U: { mediaType: "image/jpeg", data: "data:image/jpeg;base64,xx" } } }).success);
});

test("mock recognition has every colour exactly N² times and passes the shape check", () => {
  for (const size of [2, 3, 4, 5, 6, 7]) {
    const m = mockRecognition(size);
    assert.deepEqual(countWarnings(m.faces, size), []);
    const counts = colorCounts(m.faces);
    for (const n of Object.values(counts)) assert.equal(n, size * size);
    const out = ModelOutputSchema.parse({
      size,
      ...Object.fromEntries(FACES.map((f) => [f, { found: true, rows: m.faces[f], confidence: m.confidence[f] }])),
      notes: [],
    });
    assert.deepEqual(shapeProblems(out), []);
    assert.ok(shapeProblems(out, size + 1).length > 0, "a different size is reported");
  }
});

test("shape check reports wrong row counts, lengths, letters and digits", () => {
  const m = mockRecognition(3);
  const good = Object.fromEntries(FACES.map((f) => [f, { found: true, rows: m.faces[f], confidence: m.confidence[f] }]));
  const bad = ModelOutputSchema.parse({
    size: 3,
    ...good,
    U: { found: true, rows: ["WWW", "WW", "WWX"], confidence: ["999", "999"] },
    notes: [],
  });
  const problems = shapeProblems(bad);
  assert.ok(problems.some((p) => p.startsWith("U row 1")));
  assert.ok(problems.some((p) => p.includes("bad letters")));
  assert.ok(problems.some((p) => p.includes("confidence rows")));
});

test("a face without a cube must be flagged in the model output", () => {
  const m = mockRecognition(2);
  const faces = Object.fromEntries(FACES.map((f) => [f, { found: f !== "B", rows: m.faces[f], confidence: m.confidence[f] }]));
  const out = ModelOutputSchema.parse({ size: 2, ...faces, notes: [] });
  assert.deepEqual(FACES.filter((f) => !out[f].found), ["B"]);
  assert.ok(!ModelOutputSchema.safeParse({ size: 2, ...faces, U: { rows: ["WW", "WW"], confidence: ["99", "99"] }, notes: [] }).success, "found is required");
});

test("count warnings name the colours that are off", () => {
  const m = mockRecognition(2);
  const faces = { ...m.faces, U: m.faces.U.map((r) => r.replace(/./g, "W")) };
  const w = countWarnings(faces, 2);
  assert.ok(w.some((x) => x.startsWith("W 有")));
});
