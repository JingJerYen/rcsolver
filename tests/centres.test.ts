import { test } from "node:test";
import assert from "node:assert/strict";
import { applyAlgorithm, centreTurns, fromNet, parseAlgorithm, pointCentres, withCentreTurns } from "../web/src/cubeState.js";
import type { Face } from "../web/src/api.js";

const COLORS: Record<Face, string> = { U: "W", R: "R", F: "G", D: "Y", L: "O", B: "B" };
const solved = pointCentres(3, fromNet(3, Object.fromEntries((Object.keys(COLORS) as Face[]).map((f) => [f, Array.from({ length: 3 }, () => COLORS[f].repeat(3))])) as Record<Face, string[]>));
const turn = (moves: string) => applyAlgorithm(solved, parseAlgorithm(moves, 3));

test("a solved cube's arrows all point up their faces", () => {
  assert.deepEqual(centreTurns(3, solved), [0, 0, 0, 0, 0, 0]);
  assert.equal(solved.filter((s) => s.d).length, 6);
});

test("a face turn turns its centre's arrow; the others stay", () => {
  // U, R, F, D, L, B: a clockwise turn is three quarters by the right-hand rule about the outward normal
  assert.deepEqual(centreTurns(3, turn("U")), [3, 0, 0, 0, 0, 0]);
  assert.deepEqual(centreTurns(3, turn("U U U U")), [0, 0, 0, 0, 0, 0]);
  assert.deepEqual(centreTurns(3, turn("R2")), [0, 2, 0, 0, 0, 0]);
});

test("the arrows come back from a save as they were", () => {
  const cube = turn("R U F' L2 D B' 2R U' F2 x y'");
  const turns = centreTurns(3, cube);
  const plain = cube.map(({ d: _d, ...s }) => s);
  // -0 and 0 are the same place
  const norm = (st: typeof cube) => JSON.stringify(st.map((s) => ({ ...s, p: s.p.map((v) => v + 0), n: s.n.map((v) => v + 0), d: s.d?.map((v) => v + 0) })));
  assert.equal(norm(withCentreTurns(3, plain, turns)), norm(cube));
});
