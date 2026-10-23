/**
 * 4×4 by reduction: centres (BFS tables) → pair the wings with setup moves + wing 3-cycles →
 * fix OLL/PLL parity → solve the reduced cube as a 3×3 with min2phase. Every stage is replayed
 * on the sticker model, so the returned moves are known to solve the cube as it was read.
 */
import type { Face } from "../api.js";
import { FACE_AXES, FACE_ORDER, applyAlgorithm, fromNet, isSolved, parseAlgorithm, toNet, type Sticker, type Vec } from "../cubeState.js";
import { checkFacelets, netToFacelets } from "../cube3.js";
import { solve3 } from "../solver.js";
import { OUTER_MOVES, buildCentreTables, centreFaces, solveCentres } from "./cube4centers.js";
import { PARTNER, SLOTS, WING_POS, applyPerm, pairedCount, readWings, sequencePerm } from "./cube4edges.js";
import { MACROS } from "./cube4macros.js";
import { badCorners, cornerCells, schemeFromCorners, type Net } from "./scheme.js";
import { cube3Segments, type Segment } from "./segments.js";

const OLL_PARITY = "Rw2 B2 U2 Lw U2 Rw' U2 Rw U2 F2 Rw F2 Lw' B2 Rw2";
const PLL_PARITY = "2R2 U2 2R2 Uw2 2R2 2U2";

export interface Cell {
  face: Face;
  row: number;
  col: number;
}
export type Solve4Result = { ok: true; moves: string[]; stages: Record<string, number>; segments: Segment[] } | { ok: false; badCells: Cell[]; reason: string };

/** Net cell of a sticker (p, n) on an N×N cube. */
export function stickerCell(p: Vec, n: Vec, size: number): Cell {
  const face = FACE_ORDER.find((f) => FACE_AXES[f].n.every((v, i) => v === n[i]))!;
  const ax = FACE_AXES[face];
  const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  return { face, row: (dot(p, ax.down) + size - 1) / 2, col: (dot(p, ax.right) + size - 1) / 2 };
}

// ---------- edge pairing ----------

interface Setup {
  tokens: string[];
  perm: Uint8Array;
}
interface Cycle {
  tokens: string[];
  /** q1 → q2 → q3 → q1 */
  q: [number, number, number];
}
let setups: Setup[] | null = null;
let cycles: Cycle[] | null = null;

function prepareEdgeSearch() {
  if (setups) return;
  const faceOf = (t: string) => t.replace(/[2']/g, "");
  setups = [{ tokens: [], perm: sequencePerm([]) }];
  const rec = (seq: string[]) => {
    if (seq.length === 3) return;
    for (const m of OUTER_MOVES) {
      if (seq.length && faceOf(seq[seq.length - 1]!) === faceOf(m)) continue;
      const tokens = [...seq, m];
      setups!.push({ tokens, perm: sequencePerm(tokens) });
      rec(tokens);
    }
  };
  rec([]);
  cycles = [];
  for (const tokens of MACROS) {
    const perm = sequencePerm(tokens);
    const moved: number[] = [];
    for (let i = 0; i < 24; i++) if (perm[i] !== i) moved.push(i);
    if (moved.length !== 3) continue;
    const q1 = moved[0]!;
    cycles.push({ tokens, q: [q1, perm[q1]!, perm[perm[q1]!]!] });
  }
}

/** Moves that leave every slot holding partners. Throws if the greedy search gets stuck. */
export function pairEdges(arr: Uint8Array): string[] {
  prepareEdgeSearch();
  const out: string[] = [];
  let cur = arr;
  const mate = (pos: number) => (WING_POS[pos]!.sub === 0 ? SLOTS[WING_POS[pos]!.slot]![1] : SLOTS[WING_POS[pos]!.slot]![0]);
  for (let guard = 0; pairedCount(cur) < 12; guard++) {
    if (guard > 24) throw new Error("edge pairing did not converge");
    const paired = pairedCount(cur);
    let best: { tokens: string[]; next: Uint8Array } | null = null;
    // every unpaired slot is a candidate target
    for (const [a, aMate] of SLOTS) {
      for (const [pA, pAp] of [[a, aMate], [aMate, a]] as [number, number][]) {
        const A = cur[pA]!;
        if (PARTNER[A] === cur[pAp]) continue; // slot already paired
        const pB = cur.indexOf(PARTNER[A]!);
        for (const s of setups!) {
          if (best && s.tokens.length + 7 >= best.tokens.length) continue; // cannot beat the best
          const q1 = s.perm[pB]!;
          const q2 = s.perm[pAp]!;
          for (const cyc of cycles!) {
            if (cyc.q[0] !== q1 || cyc.q[1] !== q2) continue;
            const total = s.tokens.length + cyc.tokens.length;
            if (best && total >= best.tokens.length) continue;
            // the third position must come from an unpaired slot (after the setup)
            const afterSetup = applyPerm(cur, s.perm);
            const q3 = cyc.q[2];
            if (PARTNER[afterSetup[q3]!] === afterSetup[mate(q3)]) continue;
            const next = applyPerm(afterSetup, sequencePerm(cyc.tokens));
            if (pairedCount(next) <= paired) continue;
            best = { tokens: [...s.tokens, ...cyc.tokens], next };
          }
        }
      }
    }
    if (!best) throw new Error(`no pairing step found with ${paired} paired: ${Array.from(cur).join(",")}`);
    out.push(...best.tokens);
    cur = best.next;
  }
  return out;
}

// ---------- reduction ----------

/** The reduced 3×3 net of a 4×4 whose centres are uniform and whose slots hold partners. */
export function reduceTo3(stickers: Sticker[]): Net {
  const net4 = toNet(4, stickers);
  const map = [0, 1, 3];
  const net3 = {} as Net;
  for (const f of FACE_ORDER) net3[f] = map.map((r) => map.map((c) => net4[f][r]![c]!).join(""));
  return net3;
}

export function solve4(net: Net): Solve4Result {
  const scheme = schemeFromCorners(net, 4);
  if (!scheme) return { ok: false, badCells: cornerCells(4)[6]!.map(([face, row, col]) => ({ face, row, col })), reason: "scheme" };
  const bc = badCorners(net, 4, scheme.faceOfColor);
  if (bc.length) return { ok: false, badCells: bc, reason: "corner" };
  let cube = fromNet(4, net);
  const stages: Record<string, number> = {};
  const moves: string[] = [];
  const segments: Segment[] = [];
  const run = (label: string, tokens: string[], segment?: (from: number, to: number) => Segment[]) => {
    if (!tokens.length) return;
    const from = moves.length;
    cube = applyAlgorithm(cube, parseAlgorithm(tokens.join(" "), 4));
    moves.push(...tokens);
    stages[label] = (stages[label] ?? 0) + tokens.length;
    if (segment) segments.push(...segment(from, moves.length));
  };

  // centres: every face class must have exactly four stickers
  const faces = centreFaces(cube, scheme.faceOfColor);
  for (const f of FACE_ORDER) if (faces.filter((x) => x === f).length !== 4) return { ok: false, badCells: [], reason: "centre_count" };
  buildCentreTables();
  {
    const parts: { stage: number; count: number }[] = [];
    const tokens = solveCentres(faces, (stage, count) => parts.push({ stage, count }));
    run("centres", tokens, (from) => {
      const out: Segment[] = [];
      let at = 0;
      for (const p of parts) {
        if (p.count > at) out.push({ kind: "centres", from: from + at, to: from + p.count, orbit: 0, orbits: 1, stage: p.stage });
        at = p.count;
      }
      return out;
    });
  }

  // wings
  const wings = readWings(cube, scheme.colorOfFace);
  if (wings.badPositions.length) {
    const badCells = wings.badPositions.flatMap((P) => WING_POS[P]!.faces.map((n) => stickerCell(WING_POS[P]!.p, n, 4)));
    return { ok: false, badCells, reason: "wing" };
  }
  if (new Set(wings.arr).size !== 24) return { ok: false, badCells: [], reason: "wing_duplicate" };
  try {
    run("edges", pairEdges(wings.arr), (from, to) => [{ kind: "edges", from, to, orbit: 0, orbits: 1 }]);
  } catch {
    return { ok: false, badCells: [], reason: "pairing" };
  }

  // reduced 3×3 with parity fixes
  for (let attempt = 0; attempt < 3; attempt++) {
    const conv = netToFacelets(reduceTo3(cube));
    if (!conv) return { ok: false, badCells: [], reason: "reduce" };
    const v = checkFacelets(conv.facelets);
    if (v.ok) {
      const before = cube;
      const tokens = solve3(conv.facelets);
      run("3x3", tokens, (from) => cube3Segments(from, tokens, (k) => reduceTo3(applyAlgorithm(before, parseAlgorithm(tokens.slice(0, k).join(" "), 4)))));
      break;
    }
    const parity = (from: number, to: number): Segment[] => [{ kind: "parity", from, to }];
    if (v.reasons.includes("edge_flip")) run("parity", OLL_PARITY.split(" "), parity);
    else if (v.reasons.includes("parity")) run("parity", PLL_PARITY.split(" "), parity);
    else return { ok: false, badCells: [], reason: `reduced:${v.reasons.join(",")}` };
  }
  if (!isSolved(cube)) return { ok: false, badCells: [], reason: "unsolved" };
  return { ok: true, moves, stages, segments };
}
