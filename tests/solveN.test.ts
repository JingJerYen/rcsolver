import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { applyAlgorithm, fromNet, isSolved, parseAlgorithm, toNet } from "../web/src/cubeState.js";
import { installTable, tableHash, tableSpecs } from "../web/src/solvers/centres.js";
import { solveN } from "../web/src/solvers/solveN.js";
import type { Face } from "../web/src/api.js";

const COLORS: Record<Face, string> = { U: "W", R: "R", F: "G", D: "Y", L: "O", B: "B" };
const solvedNet = (n: number) => Object.fromEntries((Object.keys(COLORS) as Face[]).map((f) => [f, Array.from({ length: n }, () => COLORS[f].repeat(n))])) as Record<Face, string[]>;

function rng(seed: number) {
  let s = seed;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
}
function tokensFor(n: number) {
  const out = ["U", "U'", "U2", "R", "R'", "F", "F'", "D", "L", "B'", "B2"];
  for (let d = 2; d <= Math.floor(n / 2) + (n % 2); d++) for (const f of ["U", "R", "F", "D", "L", "B"]) out.push(`${d}${f}`, `${d}${f}'`);
  return out;
}
/** The shipped tables, as the page would fetch them. */
function loadTables(n: number) {
  for (const s of tableSpecs(n)) {
    const file = `web/tables/${tableHash(s.key)}.bin.gz`;
    assert.ok(existsSync(file), `missing table ${file}: run npm run gen:tables`);
    installTable(s.key, gunzipSync(readFileSync(file)));
  }
}

for (const n of [5, 6, 7]) {
  test(`${n}×${n}: random scrambles are solved and the model agrees`, () => {
    loadTables(n);
    const rand = rng(100 + n);
    const tokens = tokensFor(n);
    const lengths: number[] = [];
    const t0 = Date.now();
    for (let i = 0; i < 4; i++) {
      const scramble = Array.from({ length: 60 }, () => tokens[Math.floor(rand() * tokens.length)]!).join(" ");
      const scrambled = applyAlgorithm(fromNet(n, solvedNet(n)), parseAlgorithm(scramble, n));
      const r = solveN(toNet(n, scrambled), n);
      assert.ok(r.ok, `failed on ${scramble}: ${JSON.stringify(r)}`);
      assert.ok(isSolved(applyAlgorithm(scrambled, parseAlgorithm(r.moves.join(" "), n))), `not solved: ${scramble}`);
      lengths.push(r.moves.length);
      if (i === 0) console.log(`${n}x${n} stages`, r.stages);
    }
    console.log(`${n}x${n} lengths`, lengths.join(" "), "ms", Date.now() - t0);
  });
}

test("5×5: a solved cube needs no moves and bad pieces are reported", () => {
  loadTables(5);
  const r = solveN(solvedNet(5), 5);
  assert.ok(r.ok && r.moves.length === 0, JSON.stringify(r));
  // a midge showing two opposite colours cannot exist
  const net = solvedNet(5);
  net.U[4] = "WWRWW";
  net.F[0] = "GGOGG";
  const bad = solveN(net, 5);
  assert.ok(!bad.ok && bad.reason === "midge" && bad.badCells.length === 2, JSON.stringify(bad));
  // a wing with the wrong colours
  const net2 = solvedNet(5);
  net2.U[4] = "WWWBW";
  const bad2 = solveN(net2, 5);
  assert.ok(!bad2.ok && bad2.reason === "wing" && bad2.badCells.some((c) => c.face === "U" && c.row === 4 && c.col === 3), JSON.stringify(bad2));
});

test("6×6: the scheme comes from the corners and parity cases solve", () => {
  loadTables(6);
  // a single inner slice turn: an odd wing permutation plus centres out of place
  const one = toNet(6, applyAlgorithm(fromNet(6, solvedNet(6)), parseAlgorithm("3R", 6)));
  const r = solveN(one, 6);
  assert.ok(r.ok, JSON.stringify(r));
  assert.ok(isSolved(applyAlgorithm(fromNet(6, one), parseAlgorithm(r.moves.join(" "), 6))));
});
