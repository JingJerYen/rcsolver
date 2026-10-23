import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { applyAlgorithm, fromNet, parseAlgorithm, toNet } from "../web/src/cubeState.js";
import { installTable, tableHash, tableSpecs } from "../web/src/solvers/centres.js";
import { solveNet } from "../web/src/solveAny.js";
import type { Face } from "../web/src/api.js";

const COLORS: Record<Face, string> = { U: "W", R: "R", F: "G", D: "Y", L: "O", B: "B" };
const solvedNet = (n: number) => Object.fromEntries((Object.keys(COLORS) as Face[]).map((f) => [f, Array.from({ length: n }, () => COLORS[f].repeat(n))])) as Record<Face, string[]>;
const PHASE2 = new Set(["U", "U'", "U2", "D", "D'", "D2", "R2", "L2", "F2", "B2"]);

function rng(seed: number) {
  let s = seed;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
}
function scramble(n: number, seed: number) {
  const rand = rng(seed);
  const tokens = ["U", "U'", "R", "R'", "F", "F2", "D", "L'", "B"];
  for (let d = 2; d <= Math.floor(n / 2) + (n % 2); d++) for (const f of ["U", "R", "F", "L"]) tokens.push(`${d}${f}`, `${d}${f}'`);
  const alg = Array.from({ length: 40 }, () => tokens[Math.floor(rand() * tokens.length)]!).join(" ");
  return toNet(n, applyAlgorithm(fromNet(n, solvedNet(n)), parseAlgorithm(alg, n)));
}

for (const n of [5, 6, 7]) for (const s of tableSpecs(n)) installTable(s.key, gunzipSync(readFileSync(`web/tables/${tableHash(s.key)}.bin.gz`)));

for (const n of [2, 3, 4, 5, 6, 7]) {
  test(`${n}×${n}: segments tile the solution in order and name the right stages`, () => {
    const r = solveNet(n, scramble(n, 7 + n));
    assert.ok(r.ok);
    let at = 0;
    for (const seg of r.segments) {
      assert.equal(seg.from, at, `gap before ${JSON.stringify(seg)}`);
      assert.ok(seg.to > seg.from);
      at = seg.to;
    }
    assert.equal(at, r.moves.length, "segments must cover every move");
    const kinds = r.segments.map((s) => s.kind);
    if (n === 2) assert.deepEqual(kinds, ["optimal"]);
    if (n === 3) assert.ok(kinds.every((k) => k === "cube3"));
    if (n >= 4) {
      assert.equal(kinds[0], "centres");
      assert.ok(kinds.includes("edges") && kinds.includes("cube3"));
      const order = ["centres", "edges", "parity", "cube3"];
      for (let i = 1; i < kinds.length; i++) assert.ok(order.indexOf(kinds[i]!) >= order.indexOf(kinds[i - 1]!), `out of order: ${kinds.join(",")}`);
    }
    // phase 2 of the 3×3 only ever uses U, D and half turns
    for (const seg of r.segments) {
      if (seg.kind === "cube3" && seg.phase === 2) assert.ok(r.moves.slice(seg.from, seg.to).every((t) => PHASE2.has(t)), `phase 2 has a quarter side turn`);
    }
    if (n >= 5) {
      const orbits = new Set(r.segments.filter((s) => s.kind === "centres").map((s) => (s as { orbit: number }).orbit));
      assert.ok(orbits.size >= 2, "a big cube solves several centre orbits");
    }
  });
}

test("3×3: a cube already in the half-turn subgroup only gets phase 2", () => {
  const net = toNet(3, applyAlgorithm(fromNet(3, solvedNet(3)), parseAlgorithm("R2 U F2 D' L2 U2", 3)));
  const r = solveNet(3, net);
  assert.ok(r.ok);
  assert.ok(r.segments.length >= 1 && r.segments.every((s) => s.kind === "cube3" && s.phase === 2), JSON.stringify(r.segments));
});
