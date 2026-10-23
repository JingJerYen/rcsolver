import { test } from "node:test";
import assert from "node:assert/strict";
import { applyAlgorithm, fromNet, isSolved, parseAlgorithm, toNet } from "../web/src/cubeState.js";
import { solve2 } from "../web/src/solvers/cube2.js";
import { schemeFromCorners } from "../web/src/solvers/scheme.js";
import type { Face } from "../web/src/api.js";

const COLORS: Record<Face, string> = { U: "W", R: "R", F: "G", D: "Y", L: "O", B: "B" };
const solvedNet = (size: number) => Object.fromEntries((Object.keys(COLORS) as Face[]).map((f) => [f, Array.from({ length: size }, () => COLORS[f].repeat(size))])) as Record<Face, string[]>;

function rng(seed: number) {
  let s = seed;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
}

test("scheme is read off the DBL corner and opposite colours", () => {
  const s = schemeFromCorners(solvedNet(2), 2);
  assert.ok(s);
  assert.deepEqual(s.colorOfFace, COLORS);
  const s4 = schemeFromCorners(solvedNet(4), 4);
  assert.deepEqual(s4?.colorOfFace, COLORS);
});

test("2×2: random scrambles are solved in at most 11 moves and the model agrees", () => {
  const rand = rng(7);
  const tokens = ["U", "U'", "U2", "R", "R'", "R2", "F", "F'", "F2", "D", "D'", "L", "L'", "B", "B'"];
  let longest = 0;
  for (let i = 0; i < 40; i++) {
    const scramble = Array.from({ length: 25 }, () => tokens[Math.floor(rand() * tokens.length)]!).join(" ");
    const scrambled = applyAlgorithm(fromNet(2, solvedNet(2)), parseAlgorithm(scramble, 2));
    const net = toNet(2, scrambled);
    const r = solve2(net);
    assert.ok(r.ok, `failed on ${scramble}: ${JSON.stringify(r)}`);
    longest = Math.max(longest, r.moves.length);
    assert.ok(r.moves.length <= 11);
    assert.ok(isSolved(applyAlgorithm(scrambled, parseAlgorithm(r.moves.join(" "), 2))), `not solved after ${r.moves.join(" ")}`);
  }
  assert.ok(longest >= 7, `scrambles too easy? longest ${longest}`);
});

test("2×2: an impossible corner is reported with its cells; a twisted corner as a twist", () => {
  const net = solvedNet(2);
  net.R = ["WR", "RR"]; // URF corner now has two whites
  const r = solve2(net);
  assert.ok(!r.ok && r.reason === "piece" && r.badFacelets.length === 3);
  const twisted = solvedNet(2); // rotate the URF corner's three stickers
  twisted.U = ["WW", "WR"];
  twisted.R = ["GR", "RR"];
  twisted.F = ["GW", "GG"];
  const t = solve2(twisted);
  assert.ok(!t.ok && t.reason === "twist", JSON.stringify(t));
});
