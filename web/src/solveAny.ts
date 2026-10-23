/**
 * One entry point for every cube size: picks the solver, replays the answer on the sticker
 * model before trusting it, and names the cells that cannot be right when the net is impossible.
 * Pure code with no DOM, so it runs in the solver worker as well as on the page.
 */
import { FACES, type Face } from "./api.js";
import { checkFacelets, faceletCell, netToFacelets } from "./cube3.js";
import { applyAlgorithm, fromNet, isSolved, parseAlgorithm } from "./cubeState.js";
import { solve3, warmUp } from "./solver.js";
import { solve2 } from "./solvers/cube2.js";
import { solve4 } from "./solvers/cube4.js";
import { buildCentreTables } from "./solvers/cube4centers.js";
import { solveN } from "./solvers/solveN.js";
import { ensureTables } from "./solvers/tables.js";

export type Cell = { face: Face; row: number; col: number };
export type SolveResult = { ok: true; moves: string[] } | { ok: false; badCells: Cell[] };

/** Everything a size needs before solving: 3×3 pruning tables, 4×4 centre tables, fetched tables for 5×5 and up. */
export async function prepare(size: number, onProgress?: (fraction: number) => void): Promise<void> {
  if (size === 3) warmUp();
  else if (size === 4) buildCentreTables();
  else if (size >= 5) await ensureTables(size, undefined, onProgress);
  onProgress?.(1);
}

/** Solve a net with the right solver; a failure names the cells that cannot be right (maybe none). */
export function solveNet(size: number, n: Record<Face, string[]>): SolveResult {
  let moves: string[];
  if (size === 3) {
    const conv = netToFacelets(n);
    if (!conv) return { ok: false, badCells: FACES.map((face) => ({ face, row: 1, col: 1 })) };
    const v = checkFacelets(conv.facelets);
    if (!v.ok) return { ok: false, badCells: v.badFacelets.map(faceletCell) };
    try {
      moves = solve3(conv.facelets);
    } catch {
      return { ok: false, badCells: [] };
    }
  } else if (size === 2) {
    const r = solve2(n);
    if (!r.ok) return { ok: false, badCells: r.badFacelets.map((i) => ({ face: FACES[Math.floor(i / 4)]!, row: Math.floor((i % 4) / 2), col: i % 2 })) };
    moves = r.moves;
  } else if (size === 4) {
    const r = solve4(n);
    if (!r.ok) return { ok: false, badCells: r.badCells };
    moves = r.moves;
  } else if (size >= 5 && size <= 7) {
    const r = solveN(n, size);
    if (!r.ok) return { ok: false, badCells: r.badCells };
    moves = r.moves;
  } else {
    return { ok: false, badCells: [] };
  }
  // Belt and braces: replay the solution on our own model before trusting it.
  if (!isSolved(applyAlgorithm(fromNet(size, n), parseAlgorithm(moves.join(" "), size)))) return { ok: false, badCells: [] };
  return { ok: true, moves };
}
