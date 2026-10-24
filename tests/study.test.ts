import { test } from "node:test";
import assert from "node:assert/strict";
import { deltaTurn, keyToken, readMoves, studyMove, tokenize, withModifier } from "../web/src/study.js";
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

test("study: changing the last move turns by the difference", () => {
  const turn = (a: string, b: string) => {
    const d = deltaTurn(a, b, 3);
    return d ? `${d.move.token}${d.dir === -1 ? " back" : ""}` : null;
  };
  assert.equal(turn("R", "R2"), "R", "R → R2 continues a quarter turn");
  assert.equal(turn("R'", "R2"), "R'", "R' → R2 continues the other way");
  assert.equal(turn("R2", "R"), "R'", "R2 → R comes back a quarter");
  assert.equal(turn("R", "R'"), "R2 back", "R → R' goes back half a turn");
  assert.equal(turn("R'", "R"), "R2");
  assert.equal(turn("R", "U"), null, "another face is not a change of the last move");
  assert.equal(turn("R", "R"), null);
  for (const [a, b] of [["R", "R2"], ["R'", "R2"], ["R2", "R"], ["R", "R'"], ["R'", "R"], ["2Rw", "2Rw'"]] as const) {
    const n = 4;
    const d = deltaTurn(a, b, n)!;
    const viaDelta = applyAlgorithm(applyAlgorithm(solved(n), [studyMove(a, n)!]), [d.dir === 1 ? d.move : { ...d.move, angle: -d.move.angle, q: -d.move.q }]);
    const direct = applyAlgorithm(solved(n), [studyMove(b, n)!]);
    assert.equal(JSON.stringify(viaDelta.map((s) => s.c)), JSON.stringify(direct.map((s) => s.c)), `${a} → ${b}`);
  }
});
