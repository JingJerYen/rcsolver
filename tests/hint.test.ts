import { test } from "node:test";
import assert from "node:assert/strict";
import { studyHint } from "../web/src/hint.js";
import { LESSONS, puzzle } from "../web/src/learn.js";
import { applyAlgorithm, fromNet, parseAlgorithm, type Sticker } from "../web/src/cubeState.js";
import type { Face } from "../web/src/api.js";

const SCHEME: Record<Face, string> = { U: "W", R: "R", F: "G", D: "Y", L: "O", B: "B" };
const solved = (n: number) => fromNet(n, Object.fromEntries(Object.entries(SCHEME).map(([f, c]) => [f, Array.from({ length: n }, () => c.repeat(n))])) as Record<Face, string[]>);
const turn = (s: Sticker[], alg: string, n: number) => applyAlgorithm(s, parseAlgorithm(alg, n));
const HOLDS = ["", "x", "y z", "x2 y", "z'", "x' y'"];
const keys = (s: Sticker[]) => new Set(s.map((st) => `${st.p.join(",")}|${st.n.join(",")}`));

test("hint: a solved cube of any size, held any way, is solved", () => {
  for (let n = 2; n <= 7; n++)
    for (const hold of HOLDS) {
      const h = studyHint(n, turn(solved(n), hold, n))!;
      assert.equal(h.lesson, null, `${n} ${hold}`);
      assert.equal(h.rings.size, 0, `${n} ${hold}`);
      assert.match(h.title, /完成|Solved/);
    }
});

test("hint: each learning puzzle is at its own lesson, held any way, with its rings on the cube", () => {
  for (const size of [2, 3] as const)
    LESSONS[size].forEach((l, i) => {
      if (l.copy) return;
      for (let k = 0; k < 3; k++)
        for (const hold of HOLDS) {
          const cube = turn(puzzle(size, i, k).start, hold, size);
          const h = studyHint(size, cube)!;
          assert.deepEqual(h.lesson, { size, index: i }, `${size} lesson ${i} puzzle ${k} held ${hold || "as is"}: ${h.title} ${h.body}`);
          const all = keys(cube);
          assert.ok([...h.rings].every((r) => all.has(r)), `${size} #${i}`);
        }
    });
});

test("hint: a scrambled 3×3 starts at the white cross, ringing the white edges still to do", () => {
  const h = studyHint(3, turn(solved(3), "R U F' L2 D B' R' U2 F D'", 3))!;
  assert.deepEqual(h.lesson, { size: 3, index: 1 });
  assert.ok(h.rings.size > 0 && h.rings.size <= 4);
});

test("hint: a 4×4 goes centres, edges, then the 3×3 steps", () => {
  // a wide turn moves centres
  assert.match(studyHint(4, turn(solved(4), "Rw U", 4))!.title, /中心|Centres/);
  // outer turns only: centres and edges stay together, so it is a 3×3 to solve
  const outer = studyHint(4, turn(solved(4), "R U R' U' F2", 4))!;
  assert.match(outer.title, /3×3/);
  assert.equal(outer.lesson, null);
  // two edge pieces traded between edges: two edges to pair
  const s = solved(4);
  const at = (p: number[], n: number[]) => s.findIndex((st) => st.p.join() === p.join() && st.n.join() === n.join());
  const swap = (a: number, b: number) => ([s[a]!.c, s[b]!.c] = [s[b]!.c, s[a]!.c]);
  swap(at([1, 3, 3], [0, 0, 1]), at([1, 3, -3], [0, 0, -1]));
  const edges = studyHint(4, s)!;
  assert.match(edges.title, /邊塊配對|Pairing/);
  assert.match(edges.body, /2/);
});

test("hint: a 4×4's lone flipped edge and two swapped edges are named as parity", () => {
  const at = (s: Sticker[], p: number[], n: number[]) => s.findIndex((st) => st.p.join() === p.join() && st.n.join() === n.join());
  // flip the yellow-green edge (D-F) in place: both its pieces
  const flip = solved(4);
  for (const x of [-1, 1]) {
    const d = at(flip, [x, -3, 3], [0, -1, 0]);
    const f = at(flip, [x, -3, 3], [0, 0, 1]);
    [flip[d]!.c, flip[f]!.c] = [flip[f]!.c, flip[d]!.c];
  }
  const oll = studyHint(4, flip)!;
  assert.match(oll.title, /黃色十字|Yellow cross/);
  assert.match(oll.body, /偶數方塊|even cubes/);
  // swap the yellow-green and yellow-blue edges: both pieces of each
  const swap = solved(4);
  for (const x of [-1, 1]) {
    const f = at(swap, [x, -3, 3], [0, 0, 1]);
    const b = at(swap, [-x, -3, -3], [0, 0, -1]);
    [swap[f]!.c, swap[b]!.c] = [swap[b]!.c, swap[f]!.c];
  }
  const pll = studyHint(4, swap)!;
  assert.match(pll.body, /偶數方塊|even cubes/);
});
