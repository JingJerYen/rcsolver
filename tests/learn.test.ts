import { test } from "node:test";
import assert from "node:assert/strict";
import { LESSONS, demoStart, guidesFor, hintFor, puzzle, solvedFor, starsFor, type LearnSize } from "../web/src/learn.js";
import { applyAlgorithm, parseAlgorithm, toNet } from "../web/src/cubeState.js";

const SIZES: LearnSize[] = [2, 3];

test("learn: the solved cube passes every lesson's goal and keeps every earlier stage", () => {
  for (const size of SIZES)
    LESSONS[size].forEach((l, i) => {
      const s = solvedFor(size, l.whiteDown);
      assert.ok(l.goal(s, size), `${size} #${i} goal`);
      assert.ok(!l.keep || l.keep(s, size), `${size} #${i} keep`);
    });
});

test("learn: three fixed puzzles per lesson: each needs the stage, keeps the earlier ones, and its written solution finishes it", () => {
  for (const size of SIZES)
    LESSONS[size].forEach((l, i) => {
      if (l.copy) return;
      assert.equal(l.practice.length, 3, `${size} #${i}`);
      for (let k = 0; k < 3; k++) {
        const p = puzzle(size, i, k);
        assert.ok(!l.goal(p.start, size), `${size} #${i} puzzle ${k} is already done`);
        assert.ok(!l.keep || l.keep(p.start, size), `${size} #${i} puzzle ${k} broke an earlier stage`);
        const solution = l.practice[k]!.map((st) => (typeof st === "number" ? l.formulas[st]!.seq : st)).join(" ");
        assert.ok(l.goal(applyAlgorithm(p.start, parseAlgorithm(solution, size)), size), `${size} #${i} puzzle ${k}: the written solution`);
      }
      // the first puzzle is the first watch card's cube, now to do yourself
      const first = l.demos[0]!;
      assert.deepEqual(toNet(size, puzzle(size, i, 0).start), toNet(size, demoStart(size, i, first.seq)), `${size} #${i}`);
    });
});

test("learn: each formula keeps the earlier stages, and each watch card ends with the stage done", () => {
  for (const size of SIZES)
    LESSONS[size].forEach((l, i) => {
      for (const f of l.formulas) {
        const after = applyAlgorithm(solvedFor(size, l.whiteDown), parseAlgorithm(f.seq, size));
        assert.ok(!l.keep || l.keep(after, size), `${size} #${i} ${f.name}`);
      }
      for (const d of l.demos) {
        const start = demoStart(size, i, d.seq);
        if (l.copy) continue;
        assert.ok(!l.goal(start, size), `${size} #${i} ${d.name} starts unfinished`);
        assert.ok(l.goal(applyAlgorithm(start, parseAlgorithm(d.seq, size)), size), `${size} #${i} ${d.name} finishes`);
      }
    });
});

test("learn: the notation lesson's moves are all readable, and stars add up", () => {
  for (const size of SIZES) for (const moves of LESSONS[size][0]!.copy!) assert.doesNotThrow(() => parseAlgorithm(moves.join(" "), size));
  assert.equal(starsFor(0, 10, 12), 3);
  assert.equal(starsFor(1, 10, 12), 2);
  assert.equal(starsFor(2, 30, 12), 1);
});


test("learn: the hint walks each puzzle's written solution, turn by turn inside a formula, and asks for ⌫ off it", () => {
  for (const size of SIZES)
    LESSONS[size].forEach((l, i) => {
      if (l.copy) return;
      for (let k = 0; k < 3; k++) {
        const start = puzzle(size, i, k).start;
        // follow the hints: formulas as keys, turns one at a time
        let cube = start;
        let steps = 0;
        while (!l.goal(cube, size)) {
          const h = hintFor(size, i, k, cube);
          assert.ok(!("undo" in h) && steps++ < 30, `${size} #${i} puzzle ${k}`);
          cube = applyAlgorithm(cube, parseAlgorithm("formula" in h ? l.formulas[h.formula]!.seq : h.turn, size));
        }
        // the first hint of the first puzzle is the lesson's first formula (or the cross lesson's turn)
        if (k === 0) assert.deepEqual(hintFor(size, i, 0, start), l.formulas.length ? { formula: 0 } : { turn: l.practice[0]![0] });
        // part way through a formula turned by hand: the formula's next turn
        const first = l.practice[k]![0]!;
        if (typeof first === "number") {
          const moves = l.formulas[first]!.seq.split(" ");
          assert.deepEqual(hintFor(size, i, k, applyAlgorithm(start, parseAlgorithm(moves[0]!, size))), { turn: moves[1] }, `${size} #${i} puzzle ${k}`);
        }
        // a turn off the way: take it back
        assert.deepEqual(hintFor(size, i, k, applyAlgorithm(start, parseAlgorithm("B'", size))), { undo: true }, `${size} #${i} puzzle ${k}`);
      }
    });
});

test("learn: the watch cards show when to use them: arrows to where pieces go, rings on what to look for", () => {
  const g = (size: LearnSize, i: number, card = 0) => {
    const d = LESSONS[size][i]!.demos[card]!;
    return guidesFor(size, i, d, demoStart(size, i, d.seq))!;
  };
  const name = (p: number[]) => p.join(",");
  // insert: the white corner below its place goes up to it
  assert.deepEqual(g(3, 2).arrows.map(([a, b]) => `${name(a)}>${name(b)}`), ["2,-2,2>2,2,2"]);
  // middle layer: the top front edge goes into the front right slot, or the front left
  assert.deepEqual(g(3, 3, 0).arrows.map(([a, b]) => `${name(a)}>${name(b)}`), ["0,2,2>2,0,2"]);
  assert.deepEqual(g(3, 3, 1).arrows.map(([a, b]) => `${name(a)}>${name(b)}`), ["0,2,2>-2,0,2"]);
  // swap corners: three go round, the front-left one stays and is ringed
  const corners = g(3, 6);
  assert.equal(corners.arrows.length, 3);
  assert.ok([...corners.rings].every((k) => k.startsWith("-2,2,2|")) && corners.rings.size === 3);
  // edges: three go round, the back one stays
  const edges = g(3, 7);
  assert.equal(edges.arrows.length, 3);
  assert.ok([...edges.rings].every((k) => k.startsWith("0,2,-2|")));
  // the yellow cross: rings on the top face only, no arrows; the fish: its head on top at the front left
  const cross = g(3, 4);
  assert.ok(cross.arrows.length === 0 && cross.rings.size > 0 && [...cross.rings].every((k) => k.endsWith("|0,1,0")));
  assert.ok([...g(3, 5).rings].includes("-2,2,2|0,1,0"));
  // 2×2 swap: the two right corners trade places, the left pair (headlights) stays
  const t = g(2, 3);
  assert.equal(t.arrows.length, 2);
  assert.ok([...t.rings].every((k) => k.startsWith("-1,1,")));
});
