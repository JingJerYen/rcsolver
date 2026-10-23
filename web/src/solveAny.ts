/**
 * One entry point for every cube size: picks the solver, replays the answer on the sticker
 * model before trusting it, and names the cells that cannot be right when the net is impossible.
 * Pure code with no DOM, so it runs in the solver worker as well as on the page.
 */
import { FACES, type Face } from "./api.js";
import { checkFacelets, faceletCell, netToFacelets } from "./cube3.js";
import { applyAlgorithm, fromNet, isSolved, parseAlgorithm, toNet } from "./cubeState.js";
import { solve3, warmUp } from "./solver.js";
import { solve2 } from "./solvers/cube2.js";
import { solve4 } from "./solvers/cube4.js";
import { buildCentreTables } from "./solvers/cube4centers.js";
import { solveN } from "./solvers/solveN.js";
import { ensureTables } from "./solvers/tables.js";
import { cube3Segments, type Segment } from "./solvers/segments.js";
import { solveTeach3 } from "./solvers/lbl3.js";

export type { Segment };
/** "fast" is the shortest-solution solver; "teach" is the layer-by-layer method with explanations (3×3 only). */
export type SolveMode = "fast" | "teach";

export type Cell = { face: Face; row: number; col: number };
export type SolveResult = { ok: true; moves: string[]; segments: Segment[] } | { ok: false; badCells: Cell[] };

/** Everything a size needs before solving: 3×3 pruning tables, 4×4 centre tables, fetched tables for 5×5 and up. */
export async function prepare(size: number, onProgress?: (fraction: number) => void): Promise<void> {
  if (size === 3) warmUp();
  else if (size === 4) buildCentreTables();
  else if (size >= 5) await ensureTables(size, undefined, onProgress);
  onProgress?.(1);
}

/** Solve a net with the right solver; a failure names the cells that cannot be right (maybe none). */
export function solveNet(size: number, n: Record<Face, string[]>, mode: SolveMode = "fast"): SolveResult {
  let moves: string[];
  let segments: Segment[];
  if (size === 3 && mode === "teach") {
    const conv = netToFacelets(n);
    if (!conv) return { ok: false, badCells: FACES.map((face) => ({ face, row: 1, col: 1 })) };
    const v = checkFacelets(conv.facelets);
    if (!v.ok) return { ok: false, badCells: v.badFacelets.map(faceletCell) };
    const r = solveTeach3(n);
    if (!r) return { ok: false, badCells: [] };
    moves = r.moves;
    segments = r.segments;
  } else if (size === 3) {
    const conv = netToFacelets(n);
    if (!conv) return { ok: false, badCells: FACES.map((face) => ({ face, row: 1, col: 1 })) };
    const v = checkFacelets(conv.facelets);
    if (!v.ok) return { ok: false, badCells: v.badFacelets.map(faceletCell) };
    try {
      moves = solve3(conv.facelets);
    } catch {
      return { ok: false, badCells: [] };
    }
    const start = fromNet(3, n);
    segments = cube3Segments(0, moves, (k) => toNet(3, applyAlgorithm(start, parseAlgorithm(moves.slice(0, k).join(" "), 3))));
  } else if (size === 2) {
    const r = solve2(n);
    if (!r.ok) return { ok: false, badCells: r.badFacelets.map((i) => ({ face: FACES[Math.floor(i / 4)]!, row: Math.floor((i % 4) / 2), col: i % 2 })) };
    moves = r.moves;
    segments = moves.length ? [{ kind: "optimal", from: 0, to: moves.length }] : [];
  } else if (size === 4) {
    const r = solve4(n);
    if (!r.ok) return { ok: false, badCells: r.badCells };
    moves = r.moves;
    segments = r.segments;
  } else if (size >= 5 && size <= 7) {
    const r = solveN(n, size);
    if (!r.ok) return { ok: false, badCells: r.badCells };
    moves = r.moves;
    segments = r.segments;
  } else {
    return { ok: false, badCells: [] };
  }
  // Belt and braces: replay the solution on our own model before trusting it.
  if (!isSolved(applyAlgorithm(fromNet(size, n), parseAlgorithm(moves.join(" "), size)))) return { ok: false, badCells: [] };
  return { ok: true, moves, segments };
}
