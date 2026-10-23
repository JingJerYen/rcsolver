/**
 * 2×2 solver: corners only, DBL corner held fixed (so only U, R and F turns are needed),
 * IDA* with permutation and orientation pruning tables. Optimal in half-turn metric, ≤ 11 moves.
 */
import { cornerCells, cell, schemeFromCorners, type Net } from "./scheme.js";
import type { Face } from "../api.js";

// Corner colours in Kociemba order; cp/co move tables for U, R, F.
const CORNER_COLORS: Face[][] = [["U", "R", "F"], ["U", "F", "L"], ["U", "L", "B"], ["U", "B", "R"], ["D", "F", "R"], ["D", "L", "F"], ["D", "B", "L"], ["D", "R", "B"]];
const MOVE_CP = [[3, 0, 1, 2, 4, 5, 6, 7], [4, 1, 2, 0, 7, 5, 6, 3], [1, 5, 2, 3, 0, 4, 6, 7]];
const MOVE_CO = [[0, 0, 0, 0, 0, 0, 0, 0], [2, 0, 0, 1, 1, 0, 0, 2], [1, 2, 0, 0, 2, 1, 0, 0]];
const MOVE_NAMES = ["U", "R", "F"];

interface Cubies {
  cp: number[];
  co: number[];
}

function multiply(a: Cubies, b: Cubies): Cubies {
  const cp = new Array<number>(8);
  const co = new Array<number>(8);
  for (let i = 0; i < 8; i++) {
    cp[i] = a.cp[b.cp[i]!]!;
    co[i] = (a.co[b.cp[i]!]! + b.co[i]!) % 3;
  }
  return { cp, co };
}

const MOVES: Cubies[] = [];
for (let m = 0; m < 3; m++) {
  const base = { cp: MOVE_CP[m]!, co: MOVE_CO[m]! };
  let cur = base;
  for (let k = 0; k < 3; k++) {
    MOVES.push(cur); // quarter, half, inverse
    cur = multiply(cur, base);
  }
}
const MOVE_TOKENS = MOVE_NAMES.flatMap((n) => [n, `${n}2`, `${n}'`]);

/** Permutation of the 7 movable corners (DBL stays home) as a number in [0, 5040). */
function permCoord(cp: number[]): number {
  const seq = cp.filter((_, i) => i !== 6).map((x) => (x > 6 ? x - 1 : x));
  let coord = 0;
  for (let i = 0; i < 7; i++) {
    let smaller = 0;
    for (let j = i + 1; j < 7; j++) if (seq[j]! < seq[i]!) smaller++;
    coord = coord * (7 - i) + smaller;
  }
  return coord;
}

/** Orientation of 6 corners (DBL fixed, the last one follows) as a number in [0, 729). */
function oriCoord(co: number[]): number {
  let coord = 0;
  for (let i = 0; i < 8; i++) {
    if (i === 6 || i === 7) continue;
    coord = coord * 3 + co[i]!;
  }
  return coord;
}

let permTable: Uint8Array | null = null;
let oriTable: Uint8Array | null = null;

/** BFS distance tables over the two coordinates (built once, a few milliseconds). */
function buildTables() {
  if (permTable) return;
  const solved: Cubies = { cp: [0, 1, 2, 3, 4, 5, 6, 7], co: [0, 0, 0, 0, 0, 0, 0, 0] };
  const bfs = (coord: (c: Cubies) => number, n: number): Uint8Array => {
    const table = new Uint8Array(n).fill(255);
    const reps = new Map<number, Cubies>();
    let frontier: Cubies[] = [solved];
    table[coord(solved)] = 0;
    reps.set(coord(solved), solved);
    for (let d = 1; frontier.length; d++) {
      const next: Cubies[] = [];
      for (const c of frontier) {
        for (const m of MOVES) {
          const r = multiply(c, m);
          const k = coord(r);
          if (table[k] === 255) {
            table[k] = d;
            next.push(r);
          }
        }
      }
      frontier = next;
    }
    return table;
  };
  permTable = bfs((c) => permCoord(c.cp), 5040);
  oriTable = bfs((c) => oriCoord(c.co), 729);
}

/** Facelet letters (24, faces U R F D L B row-major) → cubies, or null if a corner is impossible. */
function toCubies(facelets: Face[]): { cubies: Cubies; bad: number[] } {
  const idx = cornerCells(2).map((cs) => cs.map(([f, r, c]) => ["U", "R", "F", "D", "L", "B"].indexOf(f) * 4 + r * 2 + c));
  const cp: number[] = [];
  const co: number[] = [];
  const bad: number[] = [];
  for (let i = 0; i < 8; i++) {
    const ids = idx[i]!;
    let found = false;
    for (let ori = 0; ori < 3 && !found; ori++) {
      const a = facelets[ids[ori]!];
      if (a !== "U" && a !== "D") continue;
      const b = facelets[ids[(ori + 1) % 3]!];
      const c = facelets[ids[(ori + 2) % 3]!];
      for (let j = 0; j < 8; j++) {
        if (CORNER_COLORS[j]![1] === b && CORNER_COLORS[j]![2] === c) {
          cp.push(j);
          co.push(ori);
          found = true;
          break;
        }
      }
    }
    if (!found) {
      bad.push(...ids);
      cp.push(-1);
      co.push(0);
    }
  }
  return { cubies: { cp, co }, bad };
}

export interface Solve2Result {
  ok: true;
  moves: string[];
}
export interface Solve2Failure {
  ok: false;
  /** Net cells that cannot be right, as facelet indices into U R F D L B (4 per face). */
  badFacelets: number[];
  reason: "scheme" | "piece" | "duplicate" | "twist";
}

export function solve2(net: Net): Solve2Result | Solve2Failure {
  const scheme = schemeFromCorners(net, 2);
  if (!scheme) return { ok: false, badFacelets: [], reason: "scheme" };
  const facelets: Face[] = [];
  for (const f of ["U", "R", "F", "D", "L", "B"] as Face[]) for (let r = 0; r < 2; r++) for (let c = 0; c < 2; c++) facelets.push(scheme.faceOfColor.get(cell(net, f, r, c))!);
  const { cubies, bad } = toCubies(facelets);
  if (bad.length) return { ok: false, badFacelets: bad, reason: "piece" };
  if (new Set(cubies.cp).size !== 8) return { ok: false, badFacelets: [], reason: "duplicate" };
  if (cubies.co.reduce((a, b) => a + b, 0) % 3 !== 0) return { ok: false, badFacelets: [], reason: "twist" };
  // DBL is home by construction (the scheme was read off it), so cp[6] === 6 and co[6] === 0.
  buildTables();
  const path: number[] = [];
  const h = (c: Cubies) => Math.max(permTable![permCoord(c.cp)]!, oriTable![oriCoord(c.co)]!);
  const search = (c: Cubies, depth: number, bound: number, lastAxis: number): boolean => {
    const est = h(c);
    if (est === 0) return true;
    if (depth + est > bound) return false;
    for (let m = 0; m < 9; m++) {
      const axis = Math.floor(m / 3);
      if (axis === lastAxis) continue;
      path.push(m);
      if (search(multiply(c, MOVES[m]!), depth + 1, bound, axis)) return true;
      path.pop();
    }
    return false;
  };
  for (let bound = h(cubies); bound <= 14; bound++) {
    if (search(cubies, 0, bound, -1)) return { ok: true, moves: path.map((m) => MOVE_TOKENS[m]!) };
  }
  return { ok: false, badFacelets: [], reason: "duplicate" };
}
