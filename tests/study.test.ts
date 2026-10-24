import { test } from "node:test";
import assert from "node:assert/strict";
import { keyToken, readMoves, studyMove, tokenize, withModifier } from "../web/src/study.js";
import { applyAlgorithm, fromNet, isSolved } from "../web/src/cubeState.js";
import type { Face } from "../web/src/api.js";

const COLORS: Record<Face, string> = { U: "W", R: "R", F: "G", D: "Y", L: "O", B: "B" };
const solved = (n: number) => fromNet(n, Object.fromEntries((Object.keys(COLORS) as Face[]).map((f) => [f, Array.from({ length: n }, () => COLORS[f].repeat(n))])) as Record<Face, string[]>);

test("study: typed moves are read per token, skipping what is not a move", () => {
  assert.deepEqual(tokenize("  R U’ F2 "), ["R", "U'", "F2"]);
  const { moves, bad } = readMoves(tokenize("R U Q R' 9R"), 3);
  assert.deepEqual(moves.map((m) => m.token), ["R", "U", "R'"]);
  assert.equal(bad, true);
  assert.equal(readMoves(["2R", "3Rw", "x", "r'"], 5).bad, false);
  assert.equal(studyMove("5R", 4), null, "a 4×4 has no fifth layer from R");
  assert.notEqual(studyMove("4R", 4), null, "the fourth layer from R is the L layer");
});

test("study: keypad tokens and the ' / 2 keys", () => {
  assert.equal(keyToken("R", 1, false), "R");
  assert.equal(keyToken("R", 1, true), "R", "wide on the outer layer is just the face");
  assert.equal(keyToken("R", 2, false), "2R");
  assert.equal(keyToken("R", 2, true), "Rw");
  assert.equal(keyToken("U", 3, true), "3Uw");
  assert.deepEqual(withModifier(["R", "U"], "'"), ["R", "U'"]);
  assert.deepEqual(withModifier(["R", "U'"], "'"), ["R", "U"]);
  assert.deepEqual(withModifier(["R", "U'"], "2"), ["R", "U2"]);
  assert.deepEqual(withModifier(["2Rw2"], "2"), ["2Rw"]);
  assert.deepEqual(withModifier([], "2"), []);
});

test("study: a sequence and its reverse bring the cube back, on every size", () => {
  for (let n = 2; n <= 7; n++) {
    const tokens = n >= 4 ? ["R", "2U", "Fw'", "x", "L2", "3Rw"] : ["R", "U'", "F2", "y", "L"];
    const { moves, bad } = readMoves(tokens.filter((t) => n >= 4 || !/^\d/.test(t)), n);
    assert.equal(bad, false, `${n}×${n}`);
    const back = moves.slice().reverse().map((m) => ({ ...m, angle: -m.angle, q: -m.q }));
    assert.ok(isSolved(applyAlgorithm(applyAlgorithm(solved(n), moves), back)), `${n}×${n}`);
  }
});
