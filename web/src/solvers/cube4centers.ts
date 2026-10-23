/**
 * 4×4 centres in three stages, each a BFS distance table over a small coordinate:
 *   1. get the 8 U/D-coloured centre stickers onto the U and D faces      C(24,8) = 735,471
 *   2. among the other 16 positions, separate L/R colours from F/B        C(16,8) =  12,870
 *   3. sort U from D, L from R, F from B                                   70³     = 343,000
 * Positions: 24 centre stickers, face order U R F D L B, 4 per face row-major.
 */
import { FACE_AXES, FACE_ORDER, applyMove, parseMove, type Sticker, type Vec } from "../cubeState.js";
import type { Face } from "../api.js";

export const OUTER_MOVES = ["U", "U2", "U'", "R", "R2", "R'", "F", "F2", "F'", "D", "D2", "D'", "L", "L2", "L'", "B", "B2", "B'"];
export const SLICE_MOVES = OUTER_MOVES.map((m) => `2${m}`);

/** The 24 centre positions as (p, n) of the sticker model. */
function centrePositions(): { p: Vec; n: Vec }[] {
  const out: { p: Vec; n: Vec }[] = [];
  for (const f of FACE_ORDER) {
    const ax = FACE_AXES[f];
    for (const r of [-1, 1]) for (const c of [-1, 1]) {
      const p: Vec = [0, 0, 0];
      for (let i = 0; i < 3; i++) p[i] = ax.n[i] * 3 + ax.right[i] * c + ax.down[i] * r;
      out.push({ p, n: [...ax.n] as Vec });
    }
  }
  return out;
}

const POSITIONS = centrePositions();
const key = (p: Vec, n: Vec) => `${p.join(",")}|${n.join(",")}`;
const POS_INDEX = new Map(POSITIONS.map((x, i) => [key(x.p, x.n), i]));

/** For each move token, where centre position i ends up: perm[i]. */
function movePermutation(token: string): Uint8Array {
  const stickers: Sticker[] = POSITIONS.map((x) => ({ p: x.p, n: x.n, c: "W" }));
  const moved = applyMove(stickers, parseMove(token, 4));
  const perm = new Uint8Array(24);
  moved.forEach((s, i) => (perm[i] = POS_INDEX.get(key(s.p, s.n))!));
  return perm;
}

const ALL_MOVES = [...OUTER_MOVES, ...SLICE_MOVES];
const PERMS = new Map(ALL_MOVES.map((m) => [m, movePermutation(m)]));

/** Faces of each centre position. */
const FACE_OF_POS: Face[] = POSITIONS.map((_, i) => FACE_ORDER[Math.floor(i / 4)]!);

// ---------- combinatorial ranking of bit masks ----------
const BINOM: number[][] = [];
for (let n = 0; n <= 24; n++) {
  BINOM.push([]);
  for (let k = 0; k <= 24; k++) BINOM[n]![k] = k === 0 ? 1 : n === 0 ? 0 : BINOM[n - 1]![k - 1]! + BINOM[n - 1]![k]!;
}

/** Colex rank of a mask with k set bits: sum of C(position of j-th set bit, j). */
function rankMask(mask: number): number {
  let r = 0;
  let j = 1;
  while (mask) {
    const low = mask & -mask;
    const pos = 31 - Math.clz32(low);
    r += BINOM[pos]![j]!;
    j++;
    mask ^= low;
  }
  return r;
}

/** Apply a position permutation to a bit mask (loops over set bits only). */
function permuteMask(mask: number, perm: Uint8Array): number {
  let out = 0;
  while (mask) {
    const low = mask & -mask;
    out |= 1 << perm[31 - Math.clz32(low)]!;
    mask ^= low;
  }
  return out;
}

/** Restrict a 24-position permutation to a subset of positions (which it must map to itself). */
function restrict(perm: Uint8Array, subset: number[]): Uint8Array {
  const index = new Map(subset.map((p, i) => [p, i]));
  const out = new Uint8Array(subset.length);
  subset.forEach((p, i) => {
    const target = index.get(perm[p]!);
    if (target === undefined) throw new Error("permutation leaves the subset");
    out[i] = target;
  });
  return out;
}

const UD_POS = POSITIONS.map((_, i) => i).filter((i) => FACE_OF_POS[i] === "U" || FACE_OF_POS[i] === "D");
const LRFB_POS = POSITIONS.map((_, i) => i).filter((i) => !UD_POS.includes(i));
const LR_POS = POSITIONS.map((_, i) => i).filter((i) => FACE_OF_POS[i] === "L" || FACE_OF_POS[i] === "R");
const FB_POS = POSITIONS.map((_, i) => i).filter((i) => FACE_OF_POS[i] === "F" || FACE_OF_POS[i] === "B");

/**
 * One stage: a BFS distance table over masks. `parts` lists the independent masks that make up
 * the coordinate (one for stages 1 and 2, three for stage 3), each with its own restricted perms.
 */
interface Part {
  positions: number[];
  pred: (f: Face) => boolean;
  perms: Uint8Array[];
  radix: number;
}
interface Stage {
  moves: string[];
  parts: Part[];
  table: Uint8Array;
}

const STAGE2_MOVES = [...OUTER_MOVES, "2U", "2U2", "2U'", "2D", "2D2", "2D'", "2R2", "2L2", "2F2", "2B2"];
const STAGE3_MOVES = [...OUTER_MOVES, "2U2", "2D2", "2R2", "2L2", "2F2", "2B2"];

function part(moves: string[], positions: number[], pred: (f: Face) => boolean): Part {
  const perms = moves.map((m) => restrict(PERMS.get(m)!, positions));
  const bits = positions.filter((p) => pred(FACE_OF_POS[p]!)).length;
  return { positions, pred, perms, radix: BINOM[positions.length]![bits]! };
}

/** Mask of a part for the given face classes of all 24 positions. */
function maskOf(p: Part, faces: Face[]): number {
  let m = 0;
  p.positions.forEach((pos, i) => {
    if (p.pred(faces[pos]!)) m |= 1 << i;
  });
  return m;
}

function encode(parts: Part[], masks: number[]): number {
  let code = 0;
  for (let i = 0; i < parts.length; i++) code = code * parts[i]!.radix + rankMask(masks[i]!);
  return code;
}

function buildStage(moves: string[], parts: Part[]): Stage {
  const size = parts.reduce((a, p) => a * p.radix, 1);
  const table = new Uint8Array(size).fill(255);
  const solved = parts.map((p) => maskOf(p, FACE_OF_POS));
  table[encode(parts, solved)] = 0;
  let frontier: number[][] = [solved];
  for (let d = 1; frontier.length; d++) {
    const next: number[][] = [];
    for (const masks of frontier) {
      for (let m = 0; m < moves.length; m++) {
        const moved = masks.map((mask, i) => permuteMask(mask, parts[i]!.perms[m]!));
        const k = encode(parts, moved);
        if (table[k] === 255) {
          table[k] = d;
          next.push(moved);
        }
      }
    }
    frontier = next;
  }
  return { moves, parts, table };
}

let stages: Stage[] | null = null;

export function buildCentreTables(): { reachable: number[]; ms: number } {
  const t0 = Date.now();
  if (!stages) {
    const all = POSITIONS.map((_, i) => i);
    stages = [
      buildStage(ALL_MOVES, [part(ALL_MOVES, all, (f) => f === "U" || f === "D")]),
      buildStage(STAGE2_MOVES, [part(STAGE2_MOVES, LRFB_POS, (f) => f === "L" || f === "R")]),
      buildStage(STAGE3_MOVES, [
        part(STAGE3_MOVES, UD_POS, (f) => f === "U"),
        part(STAGE3_MOVES, LR_POS, (f) => f === "L"),
        part(STAGE3_MOVES, FB_POS, (f) => f === "F"),
      ]),
    ];
  }
  const reachable = stages.map((s) => s.table.reduce((a, v) => a + (v !== 255 ? 1 : 0), 0));
  return { reachable, ms: Date.now() - t0 };
}

/** Face class of each centre sticker of the cube, by its colour under the scheme. */
export function centreFaces(stickers: Sticker[], faceOfColor: Map<string, Face>): Face[] {
  const faces = new Array<Face>(24);
  for (const s of stickers) {
    const i = POS_INDEX.get(key(s.p, s.n));
    if (i !== undefined) faces[i] = faceOfColor.get(s.c)!;
  }
  return faces;
}

/** Moves that bring all centres home, stage by stage (each stage optimal for its coordinate). */
export function solveCentres(faces: Face[]): string[] {
  if (!stages) buildCentreTables();
  const out: string[] = [];
  let cur = faces.slice();
  for (const st of stages!) {
    let masks = st.parts.map((p) => maskOf(p, cur));
    let d = st.table[encode(st.parts, masks)]!;
    if (d === 255) throw new Error("centre state not reachable");
    while (d > 0) {
      let stepped = false;
      for (let m = 0; m < st.moves.length; m++) {
        const moved = masks.map((mask, i) => permuteMask(mask, st.parts[i]!.perms[m]!));
        const nd = st.table[encode(st.parts, moved)]!;
        if (nd === d - 1) {
          out.push(st.moves[m]!);
          const perm = PERMS.get(st.moves[m]!)!;
          const next = new Array<Face>(24);
          for (let i = 0; i < 24; i++) next[perm[i]!] = cur[i]!;
          cur = next;
          masks = moved;
          d = nd;
          stepped = true;
          break;
        }
      }
      if (!stepped) throw new Error("centre descent stuck");
    }
  }
  return out;
}

export const _internal = { POSITIONS, FACE_OF_POS };
