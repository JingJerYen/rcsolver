import { test } from "node:test";
import assert from "node:assert/strict";
import { applyAlgorithm, fromNet, isSolved, parseAlgorithm, toNet } from "../web/src/cubeState.js";
import { solveTeach3, lastTeachFailure } from "../web/src/solvers/lbl3.js";
import { solveNet } from "../web/src/solveAny.js";
import { decodeShare, encodeShare } from "../web/src/share.js";
import type { Face } from "../web/src/api.js";

const COLORS: Record<Face, string> = { U: "W", R: "R", F: "G", D: "Y", L: "O", B: "B" };
const solvedNet = () => Object.fromEntries((Object.keys(COLORS) as Face[]).map((f) => [f, Array.from({ length: 3 }, () => COLORS[f].repeat(3))])) as Record<Face, string[]>;
function rng(seed: number) {
  let s = seed;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
}
const TOKENS = ["U", "U'", "U2", "R", "R'", "R2", "F", "F'", "F2", "D", "D'", "L", "L'", "B", "B'", "B2"];

test("teaching solve: random scrambles in any orientation are solved, stage by stage", () => {
  const rand = rng(2024);
  const lengths: number[] = [];
  for (let i = 0; i < 25; i++) {
    const scramble = Array.from({ length: 30 }, () => TOKENS[Math.floor(rand() * TOKENS.length)]!).join(" ");
    const orient = ["", "x", "y", "z", "x2", "x y", "z' y2"][i % 7]!;
    const cube = applyAlgorithm(fromNet(3, solvedNet()), parseAlgorithm(`${scramble} ${orient}`, 3));
    const r = solveTeach3(toNet(3, cube));
    assert.ok(r, `gave up at ${lastTeachFailure} on ${scramble} ${orient}`);
    assert.ok(isSolved(applyAlgorithm(cube, parseAlgorithm(r.moves.join(" "), 3))), `not solved: ${scramble}`);
    let at = 0;
    for (const seg of r.segments) {
      assert.equal(seg.from, at);
      assert.ok(seg.to > seg.from && seg.stage >= 0 && seg.stage <= 7 && seg.title && seg.body);
      at = seg.to;
    }
    assert.equal(at, r.moves.length);
    const stages = r.segments.map((s) => s.stage);
    assert.deepEqual([...stages].sort((a, b) => a - b), stages, "stages come in order");
    // a stage is skipped only when the cube happens to have it done already
    assert.ok(stages.includes(2) && stages.includes(3), "the first two layers always need work on a real scramble");
    lengths.push(r.moves.length);
  }
  console.log("teach lengths", lengths.join(" "), "avg", (lengths.reduce((a, b) => a + b, 0) / lengths.length).toFixed(0));
});

test("teaching solve: a solved cube needs nothing and solveNet routes the mode", () => {
  const r = solveTeach3(solvedNet());
  assert.ok(r && r.moves.length === 0);
  const scrambled = toNet(3, applyAlgorithm(fromNet(3, solvedNet()), parseAlgorithm("R U F' L D2 B", 3)));
  const fast = solveNet(3, scrambled, "fast");
  const teach = solveNet(3, scrambled, "teach");
  assert.ok(fast.ok && teach.ok);
  assert.ok(teach.moves.length > fast.moves.length);
  assert.ok(teach.segments.every((s) => s.kind === "lbl"));
  assert.ok(fast.segments.every((s) => s.kind === "cube3"));
});

test("share token v2 carries the teaching flag and whole-cube rotations; v1 tokens still open", () => {
  const faces = solvedNet();
  const t = encodeShare({ size: 3, faces, index: 4, teach: true, moves: ["x'", "y2", "R", "U'"] });
  const d = decodeShare(t);
  assert.ok(d && d.teach && d.index === 4);
  assert.deepEqual(d.moves, ["x'", "y2", "R", "U'"]);
  const plain = decodeShare(encodeShare({ size: 3, faces, index: 0 }));
  assert.ok(plain && !plain.teach && !plain.moves);
  // a version-1 token (no flags byte), built by hand
  const v2 = Uint8Array.from(atob(t.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (t.length % 4)) % 4)), (c) => c.charCodeAt(0));
  const v1 = Uint8Array.from([1, ...v2.slice(1, 2), ...v2.slice(3)]);
  const token1 = btoa(String.fromCharCode(...v1)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const d1 = decodeShare(token1);
  assert.ok(d1 && !d1.teach && d1.index === 4 && d1.moves?.length === 4);
});
