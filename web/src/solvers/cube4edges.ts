/**
 * 4×4 wings (the 24 edge pieces). A wing has no orientation of its own: its position fixes
 * which way it sits, so the whole edge state is a permutation of 24 wing ids over 24 positions.
 * Two wings that belong to the same 3×3 edge are partners; a slot is paired when it holds
 * partners (either way round: a reversed pair is a flipped dedge, fixed later by OLL parity).
 */
import { FACE_AXES, FACE_ORDER, applyMove, parseMove, rotateVec, type Move, type Sticker, type Vec } from "../cubeState.js";
import type { Color, Face } from "../api.js";
import { OUTER_MOVES, SLICE_MOVES } from "./cube4centers.js";

export const ALL_MOVES_4 = [...OUTER_MOVES, ...SLICE_MOVES];

interface WingPos {
  p: Vec; // cubie position: two coordinates ±3, one ±1
  faces: [Vec, Vec]; // the two outward normals, in a fixed order
  slot: number; // 0..11
  sub: 0 | 1;
}

function buildPositions(): WingPos[] {
  const out: WingPos[] = [];
  const slots = new Map<string, number>();
  for (const x of [-3, -1, 1, 3]) for (const y of [-3, -1, 1, 3]) for (const z of [-3, -1, 1, 3]) {
    const big = [x, y, z].filter((v) => Math.abs(v) === 3).length;
    if (big !== 2) continue;
    const p: Vec = [x, y, z];
    const faces = ([0, 1, 2] as const).filter((i) => Math.abs(p[i]) === 3).map((i) => {
      const n: Vec = [0, 0, 0];
      n[i] = Math.sign(p[i]);
      return n;
    }) as [Vec, Vec];
    const slotKey = p.map((v) => (Math.abs(v) === 3 ? v : 0)).join(",");
    if (!slots.has(slotKey)) slots.set(slotKey, slots.size);
    const inner = p.find((v) => Math.abs(v) === 1)!;
    out.push({ p, faces, slot: slots.get(slotKey)!, sub: inner < 0 ? 0 : 1 });
  }
  return out;
}

export const WING_POS: WingPos[] = buildPositions();
const key = (p: Vec) => p.join(",");
const POS_INDEX = new Map(WING_POS.map((w, i) => [key(w.p), i]));
export const PARTNER: number[] = WING_POS.map((w, i) => WING_POS.findIndex((o, j) => j !== i && o.slot === w.slot));
export const SLOTS: [number, number][] = Array.from({ length: 12 }, (_, s) => [WING_POS.findIndex((w) => w.slot === s && w.sub === 0), WING_POS.findIndex((w) => w.slot === s && w.sub === 1)]);

/** Where position i goes under each move token. */
const MOVE_PERM = new Map<string, Uint8Array>();
export function wingPerm(token: string): Uint8Array {
  let perm = MOVE_PERM.get(token);
  if (perm) return perm;
  const mv = parseMove(token, 4);
  perm = new Uint8Array(24);
  WING_POS.forEach((w, i) => {
    const moved = mv.layers.includes(w.p[mv.axis]) ? (rotateVec(w.p, mv.axis, mv.angle).map(Math.round) as Vec) : w.p;
    perm![i] = POS_INDEX.get(key(moved))!;
  });
  MOVE_PERM.set(token, perm);
  return perm;
}

/** Permutation of a whole token sequence (composition). */
export function sequencePerm(tokens: string[]): Uint8Array {
  let perm = new Uint8Array(24).map((_, i) => i);
  for (const t of tokens) {
    const m = wingPerm(t);
    const next = new Uint8Array(24);
    for (let i = 0; i < 24; i++) next[i] = m[perm[i]!]!;
    perm = next;
  }
  return perm;
}

/** Apply a position permutation to an arrangement (arr[pos] = wing id). */
export function applyPerm(arr: Uint8Array, perm: Uint8Array): Uint8Array {
  const out = new Uint8Array(24);
  for (let i = 0; i < 24; i++) out[perm[i]!] = arr[i]!;
  return out;
}

export function pairedCount(arr: Uint8Array): number {
  let n = 0;
  for (const [a, b] of SLOTS) if (PARTNER[arr[a]!] === arr[b]) n++;
  return n;
}

/**
 * Orientation table: for wing w (home position w) at position P, the normal its first home
 * sticker lies on. Built by BFS of a single piece through all moves; every wing reaches every
 * position in exactly one orientation.
 */
const ORIENT: Vec[][] = WING_POS.map((home) => {
  const table: Vec[] = new Array(24);
  const seen = new Set<string>();
  const start = { p: home.p, n0: home.faces[0] };
  const q = [start];
  seen.add(key(start.p) + "|" + key(start.n0));
  table[POS_INDEX.get(key(start.p))!] = start.n0;
  while (q.length) {
    const cur = q.shift()!;
    for (const t of ALL_MOVES_4) {
      const mv: Move = parseMove(t, 4);
      if (!mv.layers.includes(cur.p[mv.axis])) continue;
      const p = rotateVec(cur.p, mv.axis, mv.angle).map(Math.round) as Vec;
      const n0 = rotateVec(cur.n0, mv.axis, mv.angle).map(Math.round) as Vec;
      const k = key(p) + "|" + key(n0);
      if (seen.has(k)) continue;
      seen.add(k);
      const idx = POS_INDEX.get(key(p))!;
      if (table[idx] && key(table[idx]!) !== key(n0)) throw new Error("wing orientation is not unique");
      table[idx] = n0;
      q.push({ p, n0 });
    }
  }
  if (seen.size !== 24) throw new Error(`wing reaches ${seen.size} states`);
  return table;
});

export interface WingRead {
  arr: Uint8Array;
  /** Wing positions whose stickers match no wing (impossible pieces). */
  badPositions: number[];
}

/** Identify the wing at every position from sticker colours and the colour scheme. */
export function readWings(stickers: Sticker[], colorOfFace: Record<Face, Color>): WingRead {
  const colorAt = new Map<string, Color>();
  for (const s of stickers) colorAt.set(key(s.p) + "|" + key(s.n), s.c);
  const faceOfNormal = (n: Vec): Face => FACE_ORDER.find((f) => key(FACE_AXES[f].n) === key(n))!;
  // home colours of each wing: [colour on faces[0], colour on faces[1]]
  const home = WING_POS.map((w) => [colorOfFace[faceOfNormal(w.faces[0])], colorOfFace[faceOfNormal(w.faces[1])]] as [Color, Color]);
  const arr = new Uint8Array(24).fill(255);
  const badPositions: number[] = [];
  WING_POS.forEach((pos, P) => {
    const c0 = colorAt.get(key(pos.p) + "|" + key(pos.faces[0]))!;
    const c1 = colorAt.get(key(pos.p) + "|" + key(pos.faces[1]))!;
    const match = home.findIndex((h, w) => {
      if (!((h[0] === c0 && h[1] === c1) || (h[0] === c1 && h[1] === c0))) return false;
      // which normal does wing w's first sticker lie on at P? its colour must be there
      const n0 = ORIENT[w]![P]!;
      const colourOnN0 = key(n0) === key(pos.faces[0]) ? c0 : c1;
      return colourOnN0 === h[0] && (h[0] !== h[1]);
    });
    if (match < 0) badPositions.push(P);
    else arr[P] = match;
  });
  return { arr, badPositions };
}

/** Sticker-model colour check used by the macro generator: are all centres uniform? */
export function centresUniform(stickers: Sticker[]): boolean {
  const seen = new Map<string, Color>();
  for (const s of stickers) {
    if (!(Math.abs(s.p[0]) !== 3 || Math.abs(s.p[1]) !== 3 || Math.abs(s.p[2]) !== 3)) continue;
    const inner = s.p.filter((v) => Math.abs(v) === 1).length;
    if (inner !== 2) continue; // only centre cubies have two inner coordinates
    const k = key(s.n);
    const c = seen.get(k);
    if (c === undefined) seen.set(k, s.c);
    else if (c !== s.c) return false;
  }
  return true;
}

export { applyMove };
