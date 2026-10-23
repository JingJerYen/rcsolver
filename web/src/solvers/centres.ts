/**
 * Centres of a big cube, all orbits at once. Slices move several orbits together (on a 5×5 the
 * layer next to a face carries two x-centres and one +-centre of each side face), so the orbits
 * cannot be solved one after another. Each of the three stages (U/D colours to U/D; L/R from
 * F/B; sort) is an IDA* search over the joint state whose heuristic is the largest of the
 * per-orbit BFS distances. Tables are built per orbit and stage and shared between orbits that
 * move alike.
 */
import type { Color, Face } from "../api.js";
import { FACE_AXES, FACE_ORDER, applyAlgorithm, applyMove, parseAlgorithm, parseMove, type Sticker, type Vec } from "../cubeState.js";
import { CENTRE_MACROS } from "./centreMacros.js";

export const OUTER_MOVES = ["U", "U2", "U'", "R", "R2", "R'", "F", "F2", "F'", "D", "D2", "D'", "L", "L2", "L'", "B", "B2", "B'"];
export const sliceMoves = (d: number) => OUTER_MOVES.map((m) => `${d}${m}`);

const key = (p: Vec, n: Vec) => `${p.join(",")}|${n.join(",")}`;

// ---------- bit-mask coordinates ----------
const BINOM: number[][] = [];
for (let n = 0; n <= 24; n++) {
  BINOM.push([]);
  for (let k = 0; k <= 24; k++) BINOM[n]![k] = k === 0 ? 1 : n === 0 ? 0 : BINOM[n - 1]![k - 1]! + BINOM[n - 1]![k]!;
}
function rankMask(mask: number): number {
  let r = 0;
  let j = 1;
  while (mask) {
    const low = mask & -mask;
    r += BINOM[31 - Math.clz32(low)]![j]!;
    j++;
    mask ^= low;
  }
  return r;
}
function permuteMask(mask: number, perm: Uint8Array): number {
  let out = 0;
  while (mask) {
    const low = mask & -mask;
    out |= 1 << perm[31 - Math.clz32(low)]!;
    mask ^= low;
  }
  return out;
}
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

const FACE_OF_POS: Face[] = FACE_ORDER.flatMap((f) => [f, f, f, f]);
const ALL_POS = Array.from({ length: 24 }, (_, i) => i);
const UD_POS = [0, 1, 2, 3, 12, 13, 14, 15];
const LRFB_POS = [4, 5, 6, 7, 8, 9, 10, 11, 16, 17, 18, 19, 20, 21, 22, 23];
const LR_POS = [4, 5, 6, 7, 16, 17, 18, 19];
const FB_POS = [8, 9, 10, 11, 20, 21, 22, 23];

/** Stage coordinate: one or more masks over subsets of the 24 positions. */
interface Part {
  positions: number[];
  pred: (f: Face) => boolean;
  radix: number;
}
const STAGE_PARTS: Part[][] = [
  [{ positions: ALL_POS, pred: (f) => f === "U" || f === "D", radix: BINOM[24]![8]! }],
  [{ positions: LRFB_POS, pred: (f) => f === "L" || f === "R", radix: BINOM[16]![8]! }],
  [
    { positions: UD_POS, pred: (f) => f === "U", radix: 70 },
    { positions: LR_POS, pred: (f) => f === "L", radix: 70 },
    { positions: FB_POS, pred: (f) => f === "F", radix: 70 },
  ],
];

function maskOf(p: Part, faces: Face[]): number {
  let m = 0;
  p.positions.forEach((pos, i) => {
    if (p.pred(faces[pos]!)) m |= 1 << i;
  });
  return m;
}
function encodeMasks(parts: Part[], masks: number[]): number {
  let code = 0;
  for (let i = 0; i < parts.length; i++) code = code * parts[i]!.radix + rankMask(masks[i]!);
  return code;
}

function invert(perm: Uint8Array): Uint8Array {
  const inv = new Uint8Array(perm.length);
  for (let i = 0; i < perm.length; i++) inv[perm[i]!] = i;
  return inv;
}

/**
 * BFS distance table for one orbit under one stage's generators (given as permutations). The
 * search runs from the solved state over the INVERSE generators, so the table gives, for any
 * state, how many generators applied forward bring it home; descent then always finds a
 * neighbour one closer, even when the generator set is not closed under inverses (macros).
 */
export function buildTable(stage: number, perms: Uint8Array[]): Uint8Array {
  const parts = STAGE_PARTS[stage]!;
  const partPerms = parts.map((p) => perms.map((pm) => restrict(invert(pm), p.positions)));
  const size = parts.reduce((a, p) => a * p.radix, 1);
  const table = new Uint8Array(size).fill(255);
  const solved = parts.map((p) => maskOf(p, FACE_OF_POS));
  table[encodeMasks(parts, solved)] = 0;
  let frontier: number[][] = [solved];
  for (let d = 1; frontier.length; d++) {
    const next: number[][] = [];
    for (const masks of frontier) {
      for (let m = 0; m < perms.length; m++) {
        const moved = masks.map((mask, i) => permuteMask(mask, partPerms[i]![m]!));
        const k = encodeMasks(parts, moved);
        if (table[k] === 255) {
          table[k] = d;
          next.push(moved);
        }
      }
    }
    frontier = next;
  }
  return table;
}

const tableCache = new Map<string, Uint8Array>();

/** FNV-1a of a string, as 8 hex digits: the file name of a precomputed table. */
export function tableHash(key: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** Every table a size needs: its cache key and how to build it. Used for precomputation and loading. */
export function tableSpecs(size: number): { key: string; stage: number; perms: Uint8Array[] }[] {
  const out: { key: string; stage: number; perms: Uint8Array[] }[] = [];
  solveCentresStaged(null, null, size, (stage, perms, key) => out.push({ key, stage, perms }));
  return out;
}

/** Install precomputed tables (from fetched files) so no BFS runs at solve time. */
export function installTable(key: string, table: Uint8Array) {
  tableCache.set(key, table);
}
export function hasTable(key: string): boolean {
  return tableCache.has(key);
}

/** One orbit: four stickers per face at the given (row, col) offsets from the face centre. */
export class Orbit {
  readonly positions: { p: Vec; n: Vec }[];
  private posIndex: Map<string, number>;
  private permCache = new Map<string, Uint8Array>();

  constructor(readonly size: number, readonly cells: [number, number][]) {
    const m = size - 1;
    this.positions = FACE_ORDER.flatMap((f) => {
      const ax = FACE_AXES[f];
      return cells.map(([r, c]) => {
        const p: Vec = [0, 0, 0];
        for (let i = 0; i < 3; i++) p[i] = ax.n[i] * m + ax.right[i] * c + ax.down[i] * r;
        return { p, n: [...ax.n] as Vec };
      });
    });
    this.posIndex = new Map(this.positions.map((x, i) => [key(x.p, x.n), i]));
  }

  /**
   * Permutation of the orbit positions under a move, expressed in the frame of the core (the six
   * fixed middle stickers of an odd cube). A middle-slice turn carries the core with it, so it is
   * followed by the inverse whole-cube rotation: the core stays put and every orbit appears to
   * move instead. Solving in this frame makes the orbits match the middles automatically.
   */
  perm(token: string): Uint8Array {
    let perm = this.permCache.get(token);
    if (perm) return perm;
    const stickers: Sticker[] = this.positions.map((x) => ({ p: x.p, n: x.n, c: "W" }));
    let moved = applyMove(stickers, parseMove(token, this.size));
    const mid = /^(\d)([URFDLB])(['2]?)$/.exec(token);
    if (mid && this.size % 2 === 1 && Number(mid[1]) === (this.size + 1) / 2) {
      const axis = { R: "x", L: "x", U: "y", D: "y", F: "z", B: "z" }[mid[2]!]!;
      const same = "URF".includes(mid[2]!);
      const suffix = mid[3] ?? "";
      // the core turned like this rotation; undo it so the core is the frame again
      const inverse = suffix === "2" ? "2" : (suffix === "'") === same ? "" : "'";
      moved = applyMove(moved, parseMove(`${axis}${inverse}`, this.size));
    }
    perm = new Uint8Array(24);
    moved.forEach((s, i) => {
      const j = this.posIndex.get(key(s.p, s.n));
      if (j === undefined) throw new Error(`move ${token} takes a centre out of its orbit`);
      perm![i] = j;
    });
    this.permCache.set(token, perm);
    return perm;
  }

  /** Net permutation of a whole sequence whose core rotation is zero (plain physical replay). */
  sequencePerm(tokens: string[]): Uint8Array {
    const stickers: Sticker[] = this.positions.map((x) => ({ p: x.p, n: x.n, c: "W" }));
    const moved = applyAlgorithm(stickers, parseAlgorithm(tokens.join(" "), this.size));
    const perm = new Uint8Array(24);
    moved.forEach((st, i) => {
      const j = this.posIndex.get(key(st.p, st.n));
      if (j === undefined) throw new Error(`sequence ${tokens.join(" ")} takes a centre out of its orbit`);
      perm[i] = j;
    });
    return perm;
  }

  faces(stickers: Sticker[], faceOfColor: Map<Color, Face>): Face[] {
    const out = new Array<Face>(24);
    for (const s of stickers) {
      const i = this.posIndex.get(key(s.p, s.n));
      if (i !== undefined) out[i] = faceOfColor.get(s.c)!;
    }
    return out;
  }
}

/**
 * Frame: which core face sits at each physical face position. A middle-slice turn carries the
 * core with it, so after "3U" the core face that was in front is on the left, and a later
 * physical "3R" is, in the core's own coordinates, a middle slice on whatever core face now
 * faces right.
 */
type Frame = Record<Face, Face>;
const IDENTITY_FRAME: Frame = { U: "U", R: "R", F: "F", D: "D", L: "L", B: "B" };
/** Where a physical rotation sends each face position: y (like U), x (like R), z (like F). */
const ROT: Record<string, Record<Face, Face>> = {
  y: { U: "U", D: "D", F: "L", L: "B", B: "R", R: "F" },
  x: { R: "R", L: "L", F: "U", U: "B", B: "D", D: "F" },
  z: { F: "F", B: "B", U: "R", R: "D", D: "L", L: "U" },
};
function rotateFrame(frame: Frame, axis: string, times: number): Frame {
  let cur = frame;
  for (let k = 0; k < times; k++) {
    const next = {} as Frame;
    for (const f of FACE_ORDER) next[ROT[axis]![f]] = cur[f];
    cur = next;
  }
  return cur;
}
/** The frame after a physical token (unchanged unless it is a middle slice of an odd cube). */
function frameAfter(frame: Frame, token: string, size: number): Frame {
  const mid = /^(\d)([URFDLB])(['2]?)$/.exec(token);
  if (!mid || size % 2 === 0 || Number(mid[1]) !== (size + 1) / 2) return frame;
  const axis = { R: "x", L: "x", U: "y", D: "y", F: "z", B: "z" }[mid[2]!]!;
  const forward = "URF".includes(mid[2]!) !== (mid[3] === "'");
  const times = mid[3] === "2" ? 2 : forward ? 1 : 3;
  return rotateFrame(frame, axis, times);
}
/** A physical token expressed in the core's coordinates. */
function toCoreToken(token: string, frame: Frame): string {
  const m = /^(\d*)([URFDLB])(['2]?)$/.exec(token)!;
  return `${m[1]}${frame[m[2] as Face]}${m[3]}`;
}

/** Does this permutation keep stage `s` of an orbit solved (U/D set; L/R and F/B sets; every face)? */
function preservesStage(perm: Uint8Array, s: number): boolean {
  const groups = s === 0 ? [UD_POS] : s === 1 ? [UD_POS, LR_POS, FB_POS] : FACE_ORDER.map((_, f) => [0, 1, 2, 3].map((i) => f * 4 + i));
  for (const g of groups) {
    const set = new Set(g);
    for (const p of g) if (!set.has(perm[p]!)) return false;
  }
  return true;
}

/** A size's centre orbits and the move sets of the three stages (every move; U/D slices and halves; halves only). */
export interface CentreSolver {
  orbits: Orbit[];
  stages: [string[], string[], string[]];
}

interface Generator {
  tokens: string[]; // core-frame tokens
  perm: Uint8Array;
}

/** Inverse of a frame: for each core face, the physical position it sits at. */
function invertFrame(frame: Frame): Frame {
  const inv = {} as Frame;
  for (const f of FACE_ORDER) inv[frame[f]] = f;
  return inv;
}

/**
 * Staged centre solving: the x-centre orbits by table descent on plain moves (each keeping the
 * earlier ones), then every other orbit by table descent on macros that leave the earlier
 * orbits alone. Much faster than the joint search and scales to 7×7.
 */
export function solveCentresStaged(
  stickers: Sticker[] | null,
  faceOfColor: Map<Color, Face> | null,
  size: number,
  /** When given, no solving happens: each table that would be needed is reported instead. */
  enumerate?: (stage: number, perms: Uint8Array[], key: string) => void,
): string[] {
  const solver = centreSolverFor(size);
  const plan = CENTRE_MACROS[size] ?? { order: solver.orbits.map((_, i) => i), tableOrbits: solver.orbits.length, macros: [] as string[][][][] };
  const orbits = solver.orbits;
  const states = stickers ? orbits.map((o) => o.faces(stickers, faceOfColor!)) : orbits.map(() => FACE_OF_POS.slice());
  let frame: Frame = { ...IDENTITY_FRAME };
  const out: string[] = [];
  const allMoves = solver.stages[0]!;

  const applyGenerator = (g: Generator, oi: number) => {
    // every orbit moves under a plain move; a macro leaves the earlier ones alone by construction
    for (let oj = 0; oj < orbits.length; oj++) {
      const perm = g.tokens.length === 1 ? orbits[oj]!.perm(g.tokens[0]!) : oj === oi ? g.perm : orbits[oj]!.sequencePerm(g.tokens);
      const next = new Array<Face>(24);
      for (let i = 0; i < 24; i++) next[perm[i]!] = states[oj]![i]!;
      states[oj] = next;
    }
    const inv = invertFrame(frame);
    for (const t of g.tokens) {
      const physical = toCoreToken(t, inv); // rename core token to the physical face that holds it
      out.push(physical);
      frame = frameAfter(frame, physical, size);
    }
  };

  const descend = (oi: number, stage: number, gens: Generator[]) => {
    const parts = STAGE_PARTS[stage]!;
    const k = `gen${stage}:${gens.map((g) => Array.from(g.perm).join(".")).join("/")}`;
    if (enumerate) {
      enumerate(stage, gens.map((g) => g.perm), k);
      return;
    }
    let table = tableCache.get(k);
    if (!table) {
      table = buildTable(stage, gens.map((g) => g.perm));
      tableCache.set(k, table);
    }
    let cur = states[oi]!;
    let d = table[encodeMasks(parts, parts.map((p) => maskOf(p, cur)))]!;
    if (d === 255) throw new Error(`centre orbit ${oi} stage ${stage} not reachable`);
    while (d > 0) {
      let stepped = false;
      for (const g of gens) {
        const next = new Array<Face>(24);
        for (let i = 0; i < 24; i++) next[g.perm[i]!] = cur[i]!;
        const nd = table[encodeMasks(parts, parts.map((p) => maskOf(p, next)))]!;
        if (nd === d - 1) {
          applyGenerator(g, oi);
          cur = states[oi]!;
          d = nd;
          stepped = true;
          break;
        }
      }
      if (!stepped) throw new Error("centre descent stuck");
    }
  };

  for (let idx = 0; idx < plan.order.length; idx++) {
    const oi = plan.order[idx]!;
    const earlier = plan.order.slice(0, idx);
    if (idx < plan.tableOrbits) {
      for (let stage = 0; stage < 3; stage++) {
        const gens: Generator[] = allMoves
          .filter((t) => {
            // keep every earlier orbit fully solved and this orbit's earlier stages
            if (earlier.some((oj) => !preservesStage(orbits[oj]!.perm(t), 2))) return false;
            for (let st = 0; st < stage; st++) if (!preservesStage(orbits[oi]!.perm(t), st)) return false;
            return true;
          })
          .map((t) => ({ tokens: [t], perm: orbits[oi]!.perm(t) }));
        descend(oi, stage, gens);
      }
    } else {
      const perStage = plan.macros[idx - plan.tableOrbits]!;
      for (let stage = 0; stage < 3; stage++) {
        const gens: Generator[] = [
          ...OUTER_MOVES.map((t) => ({ tokens: [t], perm: orbits[oi]!.perm(t) })),
          ...perStage[stage]!.map((tokens) => ({ tokens, perm: orbits[oi]!.sequencePerm(tokens) })),
        ];
        descend(oi, stage, gens);
      }
    }
  }
  return out;
}

/** Centre solver for a cube size: every centre orbit, with the slices that move them. */
export function centreSolverFor(size: number): CentreSolver {
  const m = size - 1; // half-offsets from the centre: for size 5 the stickers sit at -2, 0, 2
  const offsets: number[] = [];
  for (let v = -(m - 2); v <= m - 2; v += 2) offsets.push(v);
  // Orbits are the sets of cells that a quarter turn of the face cycles through:
  //   x-centres (±k, ±k), +-centres (0, ±k) with (±k, 0), and for ka ≠ kb two mirror-image
  //   oblique orbits, the rotations of (ka, kb) and of (ka, -kb).
  const orbits: Orbit[] = [];
  const rotations = (r: number, c: number): [number, number][] => [[r, c], [c, -r], [-r, -c], [-c, r]];
  const ks = offsets.filter((v) => v > 0);
  for (const k of ks) {
    orbits.push(new Orbit(size, rotations(k, k)));
    if (size % 2 === 1) orbits.push(new Orbit(size, rotations(0, k))); // only odd cubes have a middle row
  }
  for (const ka of ks) for (const kb of ks) {
    if (ka >= kb) continue;
    orbits.push(new Orbit(size, rotations(ka, kb)));
    orbits.push(new Orbit(size, rotations(ka, -kb)));
  }
  const depths: number[] = [];
  for (let d = 2; d <= Math.floor(size / 2) + (size % 2); d++) depths.push(d);
  const slices = depths.flatMap(sliceMoves);
  const half = (ts: string[]) => ts.filter((t) => t.endsWith("2"));
  const isUD = (t: string) => /^\d[UD]/.test(t);
  const stages: [string[], string[], string[]] = [
    [...OUTER_MOVES, ...slices],
    [...OUTER_MOVES, ...slices.filter(isUD), ...half(slices.filter((t) => !isUD(t)))],
    [...OUTER_MOVES, ...half(slices)],
  ];
  return { orbits, stages };
}

/** Are all centre stickers of every face one colour? */
export function centresSolved(stickers: Sticker[], size: number): boolean {
  const m = size - 1;
  const seen = new Map<string, Color>();
  for (const s of stickers) {
    const inner = s.p.filter((v) => Math.abs(v) < m).length;
    if (inner !== 2) continue;
    const k = s.n.join(",");
    const c = seen.get(k);
    if (c === undefined) seen.set(k, s.c);
    else if (c !== s.c) return false;
  }
  return true;
}
