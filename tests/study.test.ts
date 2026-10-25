import { test } from "node:test";
import assert from "node:assert/strict";
import { deltaTurn, describeMark, keyToken, pushMove, readMoves, scrambleTokens, studyMove, tokenize, tokensThrough, twistToken } from "../web/src/study.js";
import { applyAlgorithm, applyMove, fromNet, isSolved, layerValues, toNet, type Move } from "../web/src/cubeState.js";
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

test("study: keypad tokens", () => {
  assert.equal(keyToken("R", 1, false), "R");
  assert.equal(keyToken("R", 1, true), "R", "wide on the outer layer is just the face");
  assert.equal(keyToken("R", 2, false), "2R");
  assert.equal(keyToken("R", 2, true), "Rw");
  assert.equal(keyToken("U", 3, true), "3Uw");
});

test("study: pressing the same layer again merges into the last move", () => {
  const press = (...keys: string[]) => keys.reduce<string[]>((t, k) => pushMove(t, k), []).join(" ");
  assert.equal(press("L", "L"), "L2");
  assert.equal(press("L", "L", "L"), "L'");
  assert.equal(press("L", "L", "L", "L"), "", "four quarter turns cancel out");
  assert.equal(press("L", "L'"), "");
  assert.equal(press("L2", "L'"), "L");
  assert.equal(press("L'", "L'"), "L2");
  assert.equal(press("R", "L", "L"), "R L2");
  assert.equal(press("R", "L", "L'"), "R", "a cancelled move leaves the one before it alone");
  assert.equal(press("2R", "R"), "2R R", "another layer is a new move");
  assert.equal(press("Rw", "R"), "Rw R", "another width is a new move");
  assert.equal(press("3Rw", "3Rw'"), "");
  assert.equal(press("y", "y"), "y2");
  // the merged moves leave the cube where the separate presses would
  for (const keys of [["L", "L", "L"], ["2R", "2R'", "U"], ["Fw", "Fw", "Fw", "R"]]) {
    const n = 4;
    const separate = applyAlgorithm(solved(n), readMoves(keys, n).moves);
    const merged = applyAlgorithm(solved(n), readMoves(press(...keys).split(" ").filter(Boolean), n).moves);
    assert.deepEqual(toNet(n, merged), toNet(n, separate), keys.join(" "));
  }
});

test("study: a layer turned by hand gets the move that turns it the same way", () => {
  assert.equal(twistToken(3, 0, 2, -1), "R");
  assert.equal(twistToken(3, 0, -2, 1), "L");
  assert.equal(twistToken(3, 1, 2, 2), "U2");
  assert.equal(twistToken(3, 0, 2, 4), null, "a full turn is no move");
  for (let n = 2; n <= 7; n++) {
    const start = applyAlgorithm(solved(n), readMoves(["R", "U", "F'"], n).moves);
    for (const axis of [0, 1, 2] as const) {
      for (const layer of layerValues(n)) {
        for (const q of [1, -1, 2]) {
          const token = twistToken(n, axis, layer, q);
          assert.ok(token, `${n}×${n} axis ${axis} layer ${layer} q ${q}`);
          const byHand = applyMove(start, { axis, layers: [layer], angle: (q * Math.PI) / 2 } as Move);
          const byToken = applyAlgorithm(start, [studyMove(token!, n)!]);
          assert.deepEqual(toNet(n, byToken), toNet(n, byHand), `${n}×${n} ${token}`);
        }
      }
    }
  }
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
    assert.deepEqual(toNet(n, viaDelta), toNet(n, direct), `${a} → ${b}`);
  }
});


test("scrambleTokens: the right length, all readable, no two turns about one axis in a row", () => {
  let x = 7;
  const rand = () => (x = (x * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  for (const [size, length] of [[2, 11], [3, 20], [4, 40], [7, 100]] as const) {
    const tokens = scrambleTokens(size, rand);
    assert.equal(tokens.length, length);
    assert.equal(readMoves(tokens, size).bad, false);
    const axes = tokens.map((t) => studyMove(t, size)!.axis);
    assert.ok(axes.every((a, i) => i === 0 || a !== axes[i - 1]), `size ${size}: ${tokens.join(" ")}`);
    assert.equal(pushMove(tokens.slice(0, -1), tokens.at(-1)!).length, tokens.length, "the last move does not merge");
  }
  assert.ok(scrambleTokens(5, rand).some((t) => t.includes("w")), "wide turns on big cubes");
});

test("describeMark names the piece and the dotted face; big cubes add row and column", () => {
  const key = (p: number[], n: number[]) => `${p.join(",")}|${n.join(",")}`;
  assert.equal(describeMark(key([2, 2, 2], [0, 0, 1]), 3), "corner UFR (dot on the F face)");
  assert.equal(describeMark(key([0, 2, 2], [0, 1, 0]), 3), "edge UF (dot on the U face)");
  assert.equal(describeMark(key([0, 0, 2], [0, 0, 1]), 3), "centre F (dot on the F face)");
  // 4×4: the U-F edge wing nearer L, seen on F: top row, second column
  assert.equal(describeMark(key([-1, 3, 3], [0, 0, 1]), 4), "edge UF (dot on the F face, row 1, column 2)");
  // on U (B at the top), the sticker next to F and R is the bottom-right one
  assert.equal(describeMark(key([3, 3, 3], [0, 1, 0]), 4), "corner UFR (dot on the U face, row 4, column 4)");
});

test("tokensThrough keeps the moves up to the slider and drops the rest", () => {
  const t = ["R", "U", "Q", "F", "D"];
  assert.deepEqual(tokensThrough(t, 3, 0), []);
  assert.deepEqual(tokensThrough(t, 3, 2), ["R", "U"], "an unreadable token after the cut goes too");
  assert.deepEqual(tokensThrough(t, 3, 3), ["R", "U", "Q", "F"], "one before it stays");
  assert.deepEqual(tokensThrough(t, 3, 4), t);
});
