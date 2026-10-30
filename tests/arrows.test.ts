import { test } from "node:test";
import assert from "node:assert/strict";
import { applyAlgorithm, centreTurns, fromNet, isSolved, parseAlgorithm, pointCentres } from "../web/src/cubeState.js";
import { fixArrows, simplify, solveArrows } from "../web/src/solvers/arrows.js";
import type { Face } from "../web/src/api.js";

const COLORS: Record<Face, string> = { U: "W", R: "R", F: "G", D: "Y", L: "O", B: "B" };
const solved = pointCentres(3, fromNet(3, Object.fromEntries((Object.keys(COLORS) as Face[]).map((f) => [f, Array.from({ length: 3 }, () => COLORS[f].repeat(3))])) as Record<Face, string[]>));

/** A small seeded generator, so a failure repeats. */
function rng(seed: number) {
  return () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 2 ** 32);
}

/** Solve as Go does; the cube in the end, and how many moves it took. */
function solveBoth(cube: ReturnType<typeof applyAlgorithm>) {
  const moves = solveArrows(cube);
  assert.ok(moves);
  return { end: applyAlgorithm(cube, parseAlgorithm(moves.join(" "), 3)), moves };
}

test("the arrows' macros turn only centres", () => {
  assert.deepEqual(fixArrows(solved), []);
  // one centre a half turn, and two a quarter each, keep the colours solved
  for (const alg of ["U R L U2 R' L' U R L U2 R' L'", "R L' F2 B2 R L' U R L' F2 B2 R L' D'"]) assert.ok(isSolved(applyAlgorithm(solved, parseAlgorithm(alg, 3))));
});

test("scrambled cubes come back with every arrow up", () => {
  const rand = rng(7);
  const faces = "URFDLB";
  let longest = 0;
  let total = 0;
  for (let k = 0; k < 40; k++) {
    const scramble = Array.from({ length: 25 }, () => faces[Math.floor(rand() * 6)]! + ["", "'", "2"][Math.floor(rand() * 3)]).join(" ");
    const { end, moves } = solveBoth(applyAlgorithm(solved, parseAlgorithm(scramble, 3)));
    assert.ok(isSolved(end), scramble);
    assert.deepEqual(centreTurns(3, end), [0, 0, 0, 0, 0, 0], scramble);
    total += moves.length;
    longest = Math.max(longest, moves.length);
  }
  console.log(`arrows: ${(total / 40).toFixed(1)} moves on average, ${longest} at most`);
  assert.ok(longest <= 80, `took ${longest} moves`);
});

test("turns of a face in a row merge, across the opposite face too", () => {
  assert.deepEqual(simplify(["R", "U", "U'", "R'"]), []);
  assert.deepEqual(simplify(["U", "D", "U", "R2", "R"]), ["U2", "D", "R'"]);
});

test("a cube held another way up is solved in that orientation", () => {
  const turned = applyAlgorithm(solved, parseAlgorithm("x y'", 3));
  const { end } = solveBoth(applyAlgorithm(turned, parseAlgorithm("R U F' L2 D B' U' F2", 3)));
  assert.ok(isSolved(end));
  assert.deepEqual(centreTurns(3, end), centreTurns(3, turned));
});
