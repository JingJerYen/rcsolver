/**
 * The DianSheng Galaxy 2×2 Magic Wheel (4 wedges a wheel): a 2×2×2 whose every face also carries a
 * wheel, a disc cut into N equal wedges. A layer turn carries the layer's four corners, its own
 * wheel whole and the half of each neighbouring wheel on that side; a wheel turn spins one wheel a
 * wedge on, moving nothing else.
 *
 * Every sticker and wedge is a point in space. A move is a rotation of the points it carries, snapped
 * back onto the slots; the permutation tables are worked out from that geometry once, at start-up.
 *
 * Coordinates: the cube spans -1..1, faces U +y, D -y, R +x, L -x, F +z, B -z.
 */

export type Vec3 = [number, number, number];
export type WheelFace = "U" | "D" | "R" | "L" | "F" | "B";
export const WHEEL_FACES: WheelFace[] = ["U", "D", "R", "L", "F", "B"];

/** Each face's outward normal n and in-face axes u (right) and v (up as the face is read); u × v = n. */
export const FACE_BASIS: Record<WheelFace, { n: Vec3; u: Vec3; v: Vec3 }> = {
  U: { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1] },
  D: { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
  R: { n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0] },
  L: { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
  F: { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
  B: { n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0] },
};

export interface WheelConfig {
  /** Wedges on every wheel. */
  wedges: number;
  /** Whether the wheels turn on their own (wheel moves allowed). */
  wheelsTurn: boolean;
  /** Whether the wedge borders lie on the layer cuts; if not, they sit half a wedge round and the layers are locked. */
  aligned: boolean;
}

export const DEFAULT_WHEEL_CONFIG: WheelConfig = { wedges: 4, wheelsTurn: true, aligned: true };

/** Wheel radius, and where a wedge's point sits (inside the wheel; a corner sticker's point is outside it). */
const WHEEL_R = 0.6;
const WEDGE_R = 0.35;
const CORNER_OFF = 0.5;
const EPS = 1e-6;

export type SlotKind = "corner" | "wedge";
export interface Slot {
  kind: SlotKind;
  face: WheelFace;
  /** Corner stickers: quadrant 0..3 counter-clockwise from (+u, +v). Wedges: index 0..N-1 counter-clockwise from u. */
  index: number;
  p: Vec3;
}

export type MoveKind = "layer" | "wheel" | "rotation";
export interface WheelMove {
  token: string;
  kind: MoveKind;
  /** Where the content of each slot goes: next[dest[i]] = state[i]. */
  dest: number[];
}

const add = (a: Vec3, b: Vec3, k = 1): Vec3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** `p` turned by `angle` about the unit axis `k` (right-hand rule). */
export function rotate(p: Vec3, k: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle), s = Math.sin(angle);
  const kp = dot(k, p);
  const x = cross(k, p);
  return [0, 1, 2].map((i) => p[i]! * c + x[i]! * s + k[i]! * kp * (1 - c)) as Vec3;
}

export interface WheelPuzzle {
  config: WheelConfig;
  slots: Slot[];
  /** Every move by token: layers U D R L F B, wheels u d r l f b, rotations x y z, each with ' and 2. */
  moves: Map<string, WheelMove>;
  /** Layer moves that cannot turn (a wedge would be cut: wheels not aligned). */
  locked: Set<string>;
  /** The slot nearest a point (within EPS), or -1. */
  slotAt(p: Vec3): number;
}

export function wedgeAngle(config: WheelConfig, k: number): number {
  const step = (2 * Math.PI) / config.wedges;
  return (k + 0.5) * step + (config.aligned ? 0 : step / 2);
}

export function slotPoint(config: WheelConfig, kind: SlotKind, face: WheelFace, index: number): Vec3 {
  const { n, u, v } = FACE_BASIS[face];
  if (kind === "corner") {
    const a = Math.PI / 4 + (index * Math.PI) / 2;
    const r = CORNER_OFF * Math.SQRT2;
    return add(add(n, u, r * Math.cos(a)), v, r * Math.sin(a));
  }
  const a = wedgeAngle(config, index);
  return add(add(n, u, WEDGE_R * Math.cos(a)), v, WEDGE_R * Math.sin(a));
}

/** The geometric move: which slots it carries and the rotation (axis, angle), or null if it is locked. */
export function moveGeometry(config: WheelConfig, token: string): { carries: (p: Vec3) => boolean; axis: Vec3; angle: number; cuts: (p: Vec3) => boolean } | null {
  const m = /^([UDRLFBudrlfbxyz])(['2]?)$/.exec(token);
  if (!m) return null;
  const [, letter, suffix] = m as unknown as [string, string, string];
  const turns = suffix === "2" ? 2 : suffix === "'" ? -1 : 1;
  if ("xyz".includes(letter)) {
    // x turns like R, y like U, z like F, with everything
    const face = ({ x: "R", y: "U", z: "F" } as const)[letter as "x" | "y" | "z"];
    return { carries: () => true, axis: FACE_BASIS[face].n, angle: (-turns * Math.PI) / 2, cuts: () => false };
  }
  const face = letter.toUpperCase() as WheelFace;
  const n = FACE_BASIS[face].n;
  if (letter === face) {
    // clockwise seen from outside is a negative turn about the outward normal
    return { carries: (p) => dot(p, n) > EPS, axis: n, angle: (-turns * Math.PI) / 2, cuts: (p) => Math.abs(dot(p, n)) <= EPS };
  }
  if (!config.wheelsTurn) return null;
  const onWheel = (p: Vec3) => Math.abs(dot(p, n) - 1) < EPS && Math.hypot(...add(p, n, -1)) < WHEEL_R;
  return { carries: onWheel, axis: n, angle: (-turns * 2 * Math.PI) / config.wedges, cuts: () => false };
}

export function buildWheelPuzzle(config: WheelConfig = DEFAULT_WHEEL_CONFIG): WheelPuzzle {
  const slots: Slot[] = [];
  for (const face of WHEEL_FACES) for (let q = 0; q < 4; q++) slots.push({ kind: "corner", face, index: q, p: slotPoint(config, "corner", face, q) });
  for (const face of WHEEL_FACES) for (let k = 0; k < config.wedges; k++) slots.push({ kind: "wedge", face, index: k, p: slotPoint(config, "wedge", face, k) });
  const slotAt = (p: Vec3) => slots.findIndex((s) => Math.hypot(...add(s.p, p, -1)) < EPS);
  const moves = new Map<string, WheelMove>();
  const locked = new Set<string>();
  for (const letter of "UDRLFBudrlfbxyz")
    for (const suffix of ["", "'", "2"]) {
      const token = letter + suffix;
      const g = moveGeometry(config, token);
      if (!g) continue;
      if (slots.some((s) => g.cuts(s.p))) {
        locked.add(token);
        continue;
      }
      const dest = slots.map((s, i) => {
        if (!g.carries(s.p)) return i;
        const j = slotAt(rotate(s.p, g.axis, g.angle));
        if (j < 0) throw new Error(`${token}: slot ${i} lands nowhere`);
        return j;
      });
      moves.set(token, { token, kind: "xyz".includes(letter) ? "rotation" : letter === letter.toUpperCase() ? "layer" : "wheel", dest });
    }
  return { config, slots, moves, locked, slotAt };
}

/** A state: which sticker (its slot when solved) sits in each slot. */
export type WheelState = number[];

export const solvedWheel = (pz: WheelPuzzle): WheelState => pz.slots.map((_, i) => i);

export function applyWheelMove(state: WheelState, move: WheelMove): WheelState {
  const next = state.slice();
  move.dest.forEach((d, i) => (next[d] = state[i]!));
  return next;
}

/** Tokens: layer U D R L F B, wheel u d r l f b, rotation x y z, each optionally ' or 2. */
export function parseWheelMoves(pz: WheelPuzzle, text: string): { moves: WheelMove[]; bad: string[] } {
  const moves: WheelMove[] = [];
  const bad: string[] = [];
  for (const t of text.replace(/[’‘`´′]/g, "'").trim().split(/\s+/).filter(Boolean)) {
    const mv = pz.moves.get(t);
    if (mv) moves.push(mv);
    else bad.push(t);
  }
  return { moves, bad };
}

export function applyWheelMoves(state: WheelState, moves: WheelMove[]): WheelState {
  return moves.reduce(applyWheelMove, state);
}

/** The face colour each sticker shows (its solved face). */
export const colourOf = (pz: WheelPuzzle, sticker: number): WheelFace => pz.slots[sticker]!.face;

/**
 * Solved: on every face the wedges are one colour and the corner stickers that same colour. Colours
 * only, so a whole-cube rotation, or a wheel spun among wedges of one colour, is still solved.
 */
export function isWheelSolved(pz: WheelPuzzle, state: WheelState): boolean {
  const colour = new Map<WheelFace, WheelFace>();
  return state.every((sticker, slot) => {
    const f = pz.slots[slot]!.face;
    const c = colourOf(pz, sticker);
    const seen = colour.get(f);
    if (seen === undefined) colour.set(f, c);
    return seen === undefined || seen === c;
  });
}

/** The permutation a whole sequence makes: where each slot's content ends up. */
export function sequenceDest(pz: WheelPuzzle, moves: WheelMove[]): number[] {
  const after = applyWheelMoves(solvedWheel(pz), moves);
  const dest: number[] = new Array(after.length);
  after.forEach((sticker, slot) => (dest[sticker] = slot));
  return dest;
}

/** The cycles of a permutation (fixed points left out), corners and wedges apart, for the formula explorer. */
export function wheelCycles(pz: WheelPuzzle, dest: number[]): { corners: number[][]; wedges: number[][] } {
  const seen = new Set<number>();
  const out = { corners: [] as number[][], wedges: [] as number[][] };
  dest.forEach((_, start) => {
    if (seen.has(start) || dest[start] === start) return;
    const cycle: number[] = [];
    for (let i = start; !seen.has(i); i = dest[i]!) {
      seen.add(i);
      cycle.push(i);
    }
    out[pz.slots[start]!.kind === "corner" ? "corners" : "wedges"].push(cycle);
  });
  return out;
}

/** A slot as people say it: face, then the quadrant or wedge number ("U·c0", "F·w3"). */
export const slotName = (pz: WheelPuzzle, i: number) => `${pz.slots[i]!.face}·${pz.slots[i]!.kind === "corner" ? "c" : "w"}${pz.slots[i]!.index}`;

/* ---------- corners as pieces: permutation and twist, for checks ---------- */

/** The corner (each coordinate ±1) a corner sticker belongs to. */
function cornerAt(p: Vec3): string {
  return p.map((c) => (c > 0 ? 1 : -1)).join(",");
}

/**
 * The eight corners as pieces: which piece (by its solved corner) sits at each corner position, and
 * its twist: 0 when its U or D sticker is on the U or D face, else 1 or 2 by which way round the
 * corner that sticker has gone.
 */
export function cornerPieces(pz: WheelPuzzle, state: WheelState): { at: Map<string, string>; twist: Map<string, number> } {
  const at = new Map<string, string>();
  const twist = new Map<string, number>();
  const isUD = (f: WheelFace) => f === "U" || f === "D";
  pz.slots.forEach((s, slot) => {
    if (s.kind !== "corner" || !isUD(s.face)) return;
    const pos = cornerAt(s.p);
    at.set(pos, cornerAt(pz.slots[state[slot]!]!.p));
    // the slot at this corner holding the piece's U or D sticker
    const holder = pz.slots.findIndex((t, i) => t.kind === "corner" && cornerAt(t.p) === pos && isUD(colourOf(pz, state[i]!)));
    const face = pz.slots[holder]!.face;
    if (isUD(face)) twist.set(pos, 0);
    else {
      const c = pos.split(",").map(Number) as Vec3;
      twist.set(pos, dot(cross(FACE_BASIS[s.face].n, FACE_BASIS[face].n), c) > 0 ? 1 : 2);
    }
  });
  return { at, twist };
}

/* ---------- scramble and saving ---------- */

/** Random moves: layers and wheels mixed (or wheels only), never the same face twice in a row. */
export function scrambleWheel(pz: WheelPuzzle, steps: number, opts: { wheelsOnly?: boolean } = {}, rand: () => number = Math.random): string[] {
  const pool = [...pz.moves.values()].filter((m) => (opts.wheelsOnly ? m.kind === "wheel" : m.kind !== "rotation"));
  const out: string[] = [];
  let last = "";
  while (out.length < steps && pool.length) {
    const m = pool[Math.floor(rand() * pool.length)]!;
    if (m.token[0] === last) continue;
    last = m.token[0]!;
    out.push(m.token);
  }
  return out;
}

export interface WheelSaved {
  puzzle: "wheel2";
  wedges: number;
  state: WheelState;
}

export const exportWheel = (pz: WheelPuzzle, state: WheelState): string => JSON.stringify({ puzzle: "wheel2", wedges: pz.config.wedges, state } satisfies WheelSaved);

/** A state read back, or null when it is not one of this puzzle's (wrong size, not a permutation). */
export function importWheel(pz: WheelPuzzle, text: string): WheelState | null {
  try {
    const data = JSON.parse(text) as WheelSaved;
    if (data.puzzle !== "wheel2" || data.wedges !== pz.config.wedges || !Array.isArray(data.state) || data.state.length !== pz.slots.length) return null;
    const seen = new Set(data.state);
    if (seen.size !== pz.slots.length || data.state.some((v) => !Number.isInteger(v) || v < 0 || v >= pz.slots.length)) return null;
    return data.state;
  } catch {
    return null;
  }
}
