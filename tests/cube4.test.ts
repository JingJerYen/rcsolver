import { test } from "node:test";
import assert from "node:assert/strict";
import { applyAlgorithm, fromNet, isSolved, parseAlgorithm, toNet } from "../web/src/cubeState.js";
import { solve4 } from "../web/src/solvers/cube4.js";
import type { Face } from "../web/src/api.js";

const COLORS: Record<Face, string> = { U: "W", R: "R", F: "G", D: "Y", L: "O", B: "B" };
const solvedNet = Object.fromEntries((Object.keys(COLORS) as Face[]).map((f) => [f, Array.from({ length: 4 }, () => COLORS[f].repeat(4))])) as Record<Face, string[]>;

function rng(seed: number) {
  let s = seed;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
}
const TOKENS = ["U", "U'", "U2", "R", "R'", "R2", "F", "F'", "F2", "D", "D'", "L", "L'", "B", "B'", "2U", "2U'", "2R", "2R'", "2F", "2F'", "2D", "2D'", "2L", "2L'", "2B", "2B'", "Rw", "Rw'", "Uw", "Fw", "Lw'", "Dw2"];

test("4×4: random scrambles are solved and the model agrees", () => {
  const rand = rng(99);
  const lengths: number[] = [];
  const t0 = Date.now();
  for (let i = 0; i < 12; i++) {
    const scramble = Array.from({ length: 45 }, () => TOKENS[Math.floor(rand() * TOKENS.length)]!).join(" ");
    const scrambled = applyAlgorithm(fromNet(4, solvedNet), parseAlgorithm(scramble, 4));
    const r = solve4(toNet(4, scrambled));
    assert.ok(r.ok, `failed on ${scramble}: ${JSON.stringify(r)}`);
    assert.ok(isSolved(applyAlgorithm(scrambled, parseAlgorithm(r.moves.join(" "), 4))), `not solved: ${scramble}`);
    lengths.push(r.moves.length);
    if (i === 0) console.log("stages", r.stages);
  }
  console.log("4x4 lengths", lengths.join(" "), "avg", (lengths.reduce((a, b) => a + b, 0) / lengths.length).toFixed(0), "ms", Date.now() - t0);
});

test("4×4: a solved cube and a single-move cube solve in few moves", () => {
  const r = solve4(solvedNet);
  assert.ok(r.ok && r.moves.length === 0, JSON.stringify(r));
  const one = toNet(4, applyAlgorithm(fromNet(4, solvedNet), parseAlgorithm("R", 4)));
  const r1 = solve4(one);
  assert.ok(r1.ok && r1.moves.length <= 3, JSON.stringify(r1));
});

test("4×4: impossible corner and impossible wing are reported with cells", () => {
  const net = JSON.parse(JSON.stringify(solvedNet)) as Record<Face, string[]>;
  net.R = ["WRRR", "RRRR", "RRRR", "RRRR"]; // URF corner with two whites
  const r = solve4(net);
  assert.ok(!r.ok && r.reason === "corner" && r.badCells.length === 3, JSON.stringify(r));
  const net2 = JSON.parse(JSON.stringify(solvedNet)) as Record<Face, string[]>;
  net2.F = ["GYGG", "GGGG", "GGGG", "GGGG"]; // wing with white (from U) and yellow: opposite colours
  const r2 = solve4(net2);
  assert.ok(!r2.ok && r2.reason === "wing" && r2.badCells.length >= 2, JSON.stringify(r2));
});
