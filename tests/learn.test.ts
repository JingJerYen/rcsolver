import { test } from "node:test";
import assert from "node:assert/strict";
import { LESSONS, demoStart, hintPlan, hintStep, invert, puzzle, solvedFor, starsFor, type LearnSize } from "../web/src/learn.js";
import { applyAlgorithm, parseAlgorithm, toNet } from "../web/src/cubeState.js";

function rng(seed: number) {
  let s = seed;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
}
const SIZES: LearnSize[] = [2, 3];

test("learn: the solved cube passes every lesson's goal and keeps every earlier stage", () => {
  for (const size of SIZES)
    LESSONS[size].forEach((l, i) => {
      const s = solvedFor(size, l.whiteDown);
      assert.ok(l.goal(s, size), `${size} #${i} goal`);
      assert.ok(!l.keep || l.keep(s, size), `${size} #${i} keep`);
    });
});

test("learn: three fixed puzzles per lesson: each needs the stage, keeps the earlier ones, and undoing it finishes it", () => {
  for (const size of SIZES)
    LESSONS[size].forEach((l, i) => {
      if (l.copy) return;
      assert.equal(l.practice.length, 3, `${size} #${i}`);
      for (let k = 0; k < 3; k++) {
        const p = puzzle(size, i, k);
        assert.ok(!l.goal(p.start, size), `${size} #${i} puzzle ${k} is already done`);
        assert.ok(!l.keep || l.keep(p.start, size), `${size} #${i} puzzle ${k} broke an earlier stage`);
        assert.ok(l.goal(applyAlgorithm(p.start, parseAlgorithm(invert(p.setup), size)), size), `${size} #${i} puzzle ${k}`);
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

test("learn: following the hint one turn at a time reaches the goal, even after stray turns", () => {
  const rand = rng(5);
  const stray = ["R", "U'", "F2", "L", "D'", "y"];
  assert.deepEqual(hintPlan([], "R U"), ["U'", "R'"]);
  assert.deepEqual(hintPlan(["U'"], "R U"), ["R'"], "a turn on the way shortens the plan");
  assert.deepEqual(hintPlan(["U"], "R U"), ["U2", "R'"], "a stray turn is taken back first, merged with the next");
  for (const size of SIZES)
    LESSONS[size].forEach((l, i) => {
      if (l.copy) return;
      for (let k = 0; k < 3; k++) {
        const p = puzzle(size, i, k);
        const done = Array.from({ length: Math.floor(rand() * 3) }, () => stray[Math.floor(rand() * stray.length)]!);
        let cube = applyAlgorithm(p.start, parseAlgorithm(done.join(" "), size));
        let steps = 0;
        while (!l.goal(cube, size)) {
          const next = hintPlan(done, p.setup)[0];
          assert.ok(next && steps++ < 200, `${size} #${i}: the hint ran out (${p.setup} / ${done.join(" ")})`);
          cube = applyAlgorithm(cube, parseAlgorithm(next, size));
          done.push(next);
        }
      }
    });
});

test("learn: the hint speaks in the lesson's formulas and lines-up turns, and following it finishes every puzzle", () => {
  let slowest = 0;
  for (const size of SIZES)
    LESSONS[size].forEach((l, i) => {
      if (l.copy) return;
      for (let k = 0; k < 3; k++) {
        let cube = puzzle(size, i, k).start;
        const said: string[] = [];
        while (!l.goal(cube, size)) {
          const t0 = performance.now();
          const step = hintStep(size, i, cube);
          slowest = Math.max(slowest, performance.now() - t0);
          assert.ok(step && said.length < 4, `${size} #${i} puzzle ${k}: no hint after ${said.join(", ")}`);
          const seq = "formula" in step ? l.formulas[step.formula]!.seq : step.turn;
          said.push("formula" in step ? l.formulas[step.formula]!.name : step.turn);
          cube = applyAlgorithm(cube, parseAlgorithm(seq, size));
        }
        // the first puzzle is the demo: its first hint is the lesson's first formula
        if (k === 0 && l.formulas.length) assert.equal(said[0], l.formulas[0]!.name, `${size} #${i}`);
      }
    });
  // the middle layer's second puzzle is the Left demo
  const left = hintStep(3, 3, puzzle(3, 3, 1).start);
  assert.deepEqual(left, { formula: 1 });
  console.log(`slowest hint ${slowest.toFixed(0)} ms`);
});
