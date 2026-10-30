import { test } from "node:test";
import assert from "node:assert/strict";
import { applyAlgorithm, fromNet, isSolved, parseMove, parseWheelMove, withWheels, type Move } from "../web/src/cubeState.js";
import { solveWheel } from "../web/src/solvers/wheel.js";
import type { Face } from "../web/src/api.js";

const COLORS: Record<Face, string> = { U: "W", R: "R", F: "G", D: "Y", L: "O", B: "B" };
const solvedCorners = fromNet(2, Object.fromEntries((Object.keys(COLORS) as Face[]).map((f) => [f, [COLORS[f].repeat(2), COLORS[f].repeat(2)]])) as Record<Face, string[]>);

function rng(seed: number) {
  return () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 2 ** 32);
}

const move = (t: string, wedges: number): Move => (/^[udrlfb]/.test(t) ? parseWheelMove(t, 2, wedges)! : parseMove(t, 2));

test("a solved Magic Wheel needs no moves", () => {
  assert.deepEqual(solveWheel(withWheels(2, solvedCorners, 4), 4), []);
});

for (const [wedges, count, bound] of [[4, 20, 70], [8, 6, 100]] as const)
test(`scrambled ${wedges}-wedge Magic Wheels come back solved`, () => {
  const rand = rng(11);
  const tokens = ["U", "R", "F", "D", "L", "B", "u", "r", "f", "d", "l", "b"].flatMap((t) => [t, `${t}'`, `${t}2`]);
  if (wedges === 8) tokens.push("u3", "r4", "f3'", "d4", "l3", "b3'");
  let total = 0;
  let longest = 0;
  for (let k = 0; k < count; k++) {
    const scramble = Array.from({ length: 30 }, () => tokens[Math.floor(rand() * tokens.length)]!);
    // held another way up now and then, too
    const cube = applyAlgorithm(withWheels(2, solvedCorners, wedges), [...(k % 4 === 0 ? ["x", "y'"] : []), ...scramble].map((t) => move(t, wedges)));
    const moves = solveWheel(cube, wedges);
    assert.ok(moves, scramble.join(" "));
    assert.ok(isSolved(applyAlgorithm(cube, moves.map((t) => move(t, wedges)))), scramble.join(" "));
    total += moves.length;
    longest = Math.max(longest, moves.length);
  }
  console.log(`magic wheel ${wedges}: ${(total / count).toFixed(1)} moves on average, ${longest} at most`);
  assert.ok(longest <= bound, `took ${longest} moves`);
});
