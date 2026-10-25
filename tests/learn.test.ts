import { test } from "node:test";
import assert from "node:assert/strict";
import { LESSONS, demoStart, hintPlan, invert, puzzle, solvedFor, starsFor, type LearnSize } from "../web/src/learn.js";
import { applyAlgorithm, parseAlgorithm } from "../web/src/cubeState.js";

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

test("learn: practice puzzles need the stage, keep the earlier ones, and undoing the setup finishes it", () => {
  const rand = rng(11);
  for (const size of SIZES)
    LESSONS[size].forEach((l, i) => {
      if (l.copy) return;
      for (let k = 0; k < 3; k++)
        for (let n = 0; n < 15; n++) {
          const alg = l.setup(rand, k);
          const start = applyAlgorithm(solvedFor(size, l.whiteDown), parseAlgorithm(alg, size));
          if (l.goal(start, size)) continue; // puzzle() draws again
          if (l.keep) assert.ok(l.keep(start, size), `${size} #${i} setup ${alg} broke an earlier stage`);
          assert.ok(l.goal(applyAlgorithm(start, parseAlgorithm(invert(alg), size)), size), `${size} #${i} ${alg}`);
        }
      for (let k = 0; k < 3; k++) {
        const p = puzzle(size, i, k, rand);
        assert.ok(!l.goal(p.start, size) && (!l.keep || l.keep(p.start, size)) && p.par >= 8, `${size} #${i} puzzle ${k}`);
      }
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
        const p = puzzle(size, i, k, rand);
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
