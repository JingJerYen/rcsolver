import { test } from "node:test";
import assert from "node:assert/strict";
import { applyAlgorithm, isSolved } from "../web/src/cubeState.js";
import { PYRA_HOLDS, parsePyraMove, pyraColours, pyraFromColours, pyraPiece, pyraScrambleTokens, pyraSolved, solvePyra } from "../web/src/pyraminx.js";

const solved = pyraSolved();
const run = (alg: string, from = solved) => applyAlgorithm(from, alg.split(" ").filter(Boolean).map((t) => parsePyraMove(t)!));

function rng(seed: number) {
  return () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 2 ** 32);
}

test("the solved Pyraminx: 36 stickers, nine of each colour, pieces as on the real one", () => {
  assert.equal(solved.length, 36);
  for (const c of "GBRY") assert.equal(solved.filter((s) => s.c === c).length, 9);
  const pieces = new Map<string, number>();
  for (const s of solved) pieces.set(pyraPiece(s.p), (pieces.get(pyraPiece(s.p)) ?? 0) + 1);
  // 4 tips and 4 centre pieces of three stickers, 6 edges of two
  assert.equal(pieces.size, 14);
  assert.equal([...pieces.values()].filter((n) => n === 3).length, 8);
  assert.equal([...pieces.values()].filter((n) => n === 2).length, 6);
  assert.ok(isSolved(solved));
});

test("three turns of a corner, or a turn and its inverse, change nothing", () => {
  for (const c of ["U", "L", "R", "B", "u", "l", "r", "b"]) {
    assert.equal(pyraColours(run(`${c} ${c} ${c}`)), pyraColours(solved), `${c}×3`);
    assert.equal(pyraColours(run(`${c} ${c}'`)), pyraColours(solved), `${c} ${c}'`);
    assert.ok(!isSolved(run(c)), c);
  }
  // a tip turn moves three stickers, a layer turn the tip, its centre piece and three edges: 3 + 3 + 6
  const moved = (alg: string) => pyraColours(run(alg)).split("").filter((c, i) => c !== pyraColours(solved)[i]).length;
  assert.equal(moved("u"), 3);
  assert.equal(moved("U"), 12);
});

test("a save's colours bring the same Pyraminx back", () => {
  const cube = run("R U' L B u r'");
  assert.equal(pyraColours(pyraFromColours(pyraColours(cube))), pyraColours(cube));
});

test("scrambled Pyraminxes are solved in at most 4 tip turns and 11 layer turns", () => {
  const rand = rng(3);
  for (let k = 0; k < 30; k++) {
    const scramble = pyraScrambleTokens(rand).join(" ");
    const cube = run(scramble);
    const moves = solvePyra(cube);
    assert.ok(moves, scramble);
    assert.ok(isSolved(run(moves.join(" "), cube)), scramble);
    assert.ok(moves.filter((t) => t === t.toLowerCase()).length <= 4);
    assert.ok(moves.filter((t) => t !== t.toLowerCase()).length <= 11, `${moves.length}: ${scramble}`);
  }
  assert.deepEqual(solvePyra(solved), []);
});

test("a Pyraminx held another way is solved as held, with no whole-puzzle turns", () => {
  const rand = rng(9);
  for (const hold of PYRA_HOLDS.slice(1, 13)) {
    const cube = run([...hold, ...pyraScrambleTokens(rand)].join(" "));
    const moves = solvePyra(cube);
    assert.ok(moves, hold.join(" "));
    assert.ok(moves.every((t) => !t.startsWith("[")));
    assert.ok(isSolved(run(moves.join(" "), cube)), hold.join(" "));
  }
  // [U] three times is the puzzle as it was
  assert.equal(pyraColours(run("[U] [U] [U]")), pyraColours(solved));
  assert.ok(isSolved(run("[R] [B]'")));
});

test("Pyraminx turns typed twice merge in thirds, whole turns too", async () => {
  const { pushMove, setPyraStudy } = await import("../web/src/study.js");
  setPyraStudy(true);
  assert.deepEqual(pushMove(["R"], "R"), ["R'"]);
  assert.deepEqual(pushMove(["R"], "R'"), []);
  assert.deepEqual(pushMove(["[U]"], "[U]"), ["[U]'"]);
  assert.deepEqual(pushMove(["[U]"], "U"), ["[U]", "U"]);
  setPyraStudy(false);
});
