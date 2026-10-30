/**
 * Sticker-level model of an N×N cube, shared by the 3D view and the tests. Positions use odd
 * coordinates from -(N-1) to N-1 in steps of 2, so a cubie's layer index is simply its coordinate.
 */
import type { Color, Face } from "./api.js";

export type Vec = [number, number, number];

export interface Sticker {
  p: Vec; // cubie position
  n: Vec; // outward normal of this sticker
  c: Color;
  /** The way its picture points, on a cube whose centres have a direction; turns with the sticker. */
  d?: Vec;
  /**
   * A wedge of the 2×2 Magic Wheel: the unit direction from its face's centre to its middle. Its p is
   * the corner cubie of the quadrant it lies in, so layer turns carry it with that corner; a wheel
   * turn spins only the wedges, round the face.
   */
  w?: Vec;
}

/** Face geometry: outward normal, image-right and image-down directions (same convention as the net). */
export const FACE_AXES: Record<Face, { n: Vec; right: Vec; down: Vec }> = {
  F: { n: [0, 0, 1], right: [1, 0, 0], down: [0, -1, 0] },
  R: { n: [1, 0, 0], right: [0, 0, -1], down: [0, -1, 0] },
  B: { n: [0, 0, -1], right: [-1, 0, 0], down: [0, -1, 0] },
  L: { n: [-1, 0, 0], right: [0, 0, 1], down: [0, -1, 0] },
  U: { n: [0, 1, 0], right: [1, 0, 0], down: [0, 0, 1] },
  D: { n: [0, -1, 0], right: [1, 0, 0], down: [0, 0, -1] },
};

export const FACE_ORDER: Face[] = ["U", "R", "F", "D", "L", "B"];

export function layerValues(size: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < size; i++) out.push(-(size - 1) + 2 * i);
  return out;
}

/** Build the sticker list from a net (N rows of N colour letters per face). */
export function fromNet(size: number, faces: Record<Face, string[]>): Sticker[] {
  const vals = layerValues(size);
  const out: Sticker[] = [];
  for (const f of FACE_ORDER) {
    const ax = FACE_AXES[f];
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const p: Vec = [0, 0, 0];
        for (let i = 0; i < 3; i++) p[i] = ax.n[i] * (size - 1) + ax.right[i] * vals[c]! + ax.down[i] * vals[r]!;
        out.push({ p, n: [...ax.n] as Vec, c: faces[f][r]![c] as Color });
      }
    }
  }
  return out;
}

/** Read the net back out of a sticker list. */
export function toNet(size: number, stickers: Sticker[]): Record<Face, string[]> {
  const vals = layerValues(size);
  const key = (p: Vec, n: Vec) => `${p.join(",")}|${n.join(",")}`;
  // (a Magic Wheel's wedges share their corner stickers' places: the net is the corners)
  const lookup = new Map(stickers.filter((s) => !s.w).map((s) => [key(s.p, s.n), s.c]));
  const net = {} as Record<Face, string[]>;
  for (const f of FACE_ORDER) {
    const ax = FACE_AXES[f];
    net[f] = [];
    for (let r = 0; r < size; r++) {
      let row = "";
      for (let c = 0; c < size; c++) {
        const p: Vec = [0, 0, 0];
        for (let i = 0; i < 3; i++) p[i] = ax.n[i] * (size - 1) + ax.right[i] * vals[c]! + ax.down[i] * vals[r]!;
        row += lookup.get(key(p, ax.n)) ?? "?";
      }
      net[f].push(row);
    }
  }
  return net;
}

export interface Move {
  token: string;
  face: Face;
  axis: 0 | 1 | 2;
  /** Coordinates (on `axis`) of the layers that turn. */
  layers: number[];
  /** Quarter turns: 1, 2 or -1 (counter-clockwise as seen from the face). */
  q: 1 | 2 | -1;
  /** Signed rotation angle about the axis, in radians. */
  angle: number;
  /** The Magic Wheel's wheel turn (u d r l f b): only that face's wedges turn, by `angle`. */
  wheel?: true;
}

const FACE_AXIS: Record<Face, { axis: 0 | 1 | 2; sign: 1 | -1 }> = {
  R: { axis: 0, sign: 1 },
  L: { axis: 0, sign: -1 },
  U: { axis: 1, sign: 1 },
  D: { axis: 1, sign: -1 },
  F: { axis: 2, sign: 1 },
  B: { axis: 2, sign: -1 },
};

/**
 * Parse one move token. Supports outer turns (R, U', F2), wide turns (Rw, r, 3Rw: this many
 * layers from that face) and single inner slices (2R, 3L: only the n-th layer from that face).
 */
export function parseMove(token: string, size: number): Move {
  // whole-cube rotations: x turns like R, y like U, z like F, with every layer moving
  const rot = /^([xyz])(['2]?)$/.exec(token.trim());
  if (rot) {
    const face: Face = rot[1] === "x" ? "R" : rot[1] === "y" ? "U" : "F";
    const base = parseMove(`${face}${rot[2]}`, size);
    return { ...base, token, layers: layerValues(size) };
  }
  const m = /^(\d*)([URFDLBurfdlb])(w?)(['2]?)$/.exec(token.trim());
  if (!m) throw new Error(`bad move: ${token}`);
  const [, numStr, letter, w, suffix] = m;
  const face = letter!.toUpperCase() as Face;
  const wide = w === "w" || letter === letter!.toLowerCase();
  const num = numStr ? Number(numStr) : wide ? 2 : 1;
  const { axis, sign } = FACE_AXIS[face];
  const vals = layerValues(size);
  const outerIndex = sign > 0 ? size - 1 : 0;
  const step = sign > 0 ? -1 : 1;
  const layers: number[] = [];
  if (wide) {
    for (let i = 0; i < Math.min(num, size); i++) layers.push(vals[outerIndex + step * i]!);
  } else {
    layers.push(vals[outerIndex + step * (num - 1)]!);
  }
  const q = suffix === "2" ? 2 : suffix === "'" ? -1 : 1;
  // A clockwise turn of a positive-axis face is a negative rotation about that axis.
  const angle = -sign * q * (Math.PI / 2);
  return { token, face, axis, layers, q, angle };
}

/**
 * Rewrite a sequence so it has no whole-cube rotations: each later move is renamed to the face
 * that physically sits where the rotation put it. Same effect on the cube, no x/y/z tokens.
 */
export function unrotate(tokens: string[], size: number): string[] {
  const out: string[] = [];
  // current[f] = the original face now standing where face f is named
  let normals: Record<Face, Vec> = Object.fromEntries(FACE_ORDER.map((f) => [f, [...FACE_AXES[f].n] as Vec])) as Record<Face, Vec>;
  const faceOfNormal = (n: Vec): Face => FACE_ORDER.find((f) => FACE_AXES[f].n.every((v, i) => v === n[i]))!;
  for (const t of tokens) {
    const rot = /^([xyz])(['2]?)$/.exec(t);
    if (rot) {
      const mv = parseMove(t, size);
      // rotating the cube moves each original face's normal; the name of a position stays put
      const next = {} as Record<Face, Vec>;
      for (const f of FACE_ORDER) next[f] = rotateVec(normals[f], mv.axis, mv.angle).map(Math.round) as Vec;
      normals = next;
      continue;
    }
    const m = /^(\d*)([URFDLBurfdlb])(w?)(['2]?)$/.exec(t);
    if (!m) throw new Error(`bad move: ${t}`);
    const named = m[2]!.toUpperCase() as Face;
    // which original face currently sits at the named position?
    const original = FACE_ORDER.find((f) => faceOfNormal(normals[f]) === named)!;
    const letter = m[2] === m[2]!.toLowerCase() ? original.toLowerCase() : original;
    out.push(`${m[1]}${letter}${m[3]}${m[4]}`);
  }
  return out;
}

export function parseAlgorithm(alg: string, size: number): Move[] {
  return alg
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => parseMove(t, size));
}

export function rotateVec(v: Vec, axis: 0 | 1 | 2, angle: number): Vec {
  const b = ((axis + 1) % 3) as 0 | 1 | 2;
  const c = ((axis + 2) % 3) as 0 | 1 | 2;
  const r: Vec = [...v] as Vec;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  r[b] = v[b] * cos - v[c] * sin;
  r[c] = v[b] * sin + v[c] * cos;
  return r;
}

/** Apply a move and return the new sticker list (positions snapped back to integers). */
export function applyMove(stickers: Sticker[], mv: Move): Sticker[] {
  return stickers.map((s) =>
    mv.layers.includes(s.p[mv.axis]) && (!mv.wheel || (s.w && s.n[mv.axis] !== 0))
      ? mv.wheel
        ? spinWedge(s, mv)
        : {
          p: rotateVec(s.p, mv.axis, mv.angle).map(Math.round) as Vec,
          n: rotateVec(s.n, mv.axis, mv.angle).map(Math.round) as Vec,
          c: s.c,
          ...(s.d ? { d: rotateVec(s.d, mv.axis, mv.angle).map(Math.round) as Vec } : {}),
          ...(s.w ? { w: snapDir(rotateVec(s.w, mv.axis, mv.angle)) } : {}),
        }
      : s,
  );
}

export function applyAlgorithm(stickers: Sticker[], moves: Move[]): Sticker[] {
  return moves.reduce(applyMove, stickers);
}

/** Every face shows one colour. */
export function isSolved(stickers: Sticker[]): boolean {
  const seen = new Map<string, Color>();
  for (const s of stickers) {
    const k = s.n.join(",");
    const c = seen.get(k);
    if (c === undefined) seen.set(k, s.c);
    else if (c !== s.c) return false;
  }
  return true;
}

/*
 * Centres with a direction (study mode's "3×3 with arrows"): each odd cube's centre sticker carries a
 * triangle, pointing up the face as the net reads it when solved; the puzzle is solved only when the
 * faces are one colour and every triangle points the way it did. The turns carry the arrows along.
 */

/** The face whose outward normal is `n`. */
function faceAt(n: Vec): Face {
  return FACE_ORDER.find((f) => FACE_AXES[f].n.every((v, i) => v === n[i]))!;
}

/** Up the face as the net reads it: away from its image-down direction. */
function upOf(f: Face): Vec {
  return FACE_AXES[f].down.map((v) => -v) as Vec;
}

const isCentre = (size: number, s: Sticker) => size % 2 === 1 && s.p.every((v, i) => (s.n[i] ? true : v === 0));

/** The centres pointing up their faces (a solved cube's arrows). */
export function pointCentres(size: number, stickers: Sticker[]): Sticker[] {
  return stickers.map((s) => (isCentre(size, s) ? { ...s, d: upOf(faceAt(s.n)) } : s));
}

/** Each face's centre arrow (net order) as quarter turns from pointing up that face, for saving. */
export function centreTurns(size: number, stickers: Sticker[]): number[] {
  return FACE_ORDER.map((f) => {
    const s = stickers.find((t) => isCentre(size, t) && faceAt(t.n) === f);
    const ax = FACE_AXES[f].n.findIndex((v) => v !== 0) as 0 | 1 | 2;
    let v = upOf(f);
    for (let k = 0; k < 4; k++, v = rotateVec(v, ax, Math.PI / 2).map(Math.round) as Vec) if (s?.d && v.every((c, i) => c === s.d![i])) return k;
    return 0;
  });
}

/** The arrows put back from `centreTurns`. */
export function withCentreTurns(size: number, stickers: Sticker[], turns: number[]): Sticker[] {
  return stickers.map((s) => {
    if (!isCentre(size, s)) return s;
    const f = faceAt(s.n);
    const ax = s.n.findIndex((v) => v !== 0) as 0 | 1 | 2;
    let d = upOf(f);
    for (let k = 0; k < (turns[FACE_ORDER.indexOf(f)] ?? 0); k++) d = rotateVec(d, ax, Math.PI / 2).map(Math.round) as Vec;
    return { ...s, d };
  });
}

/* The 2×2 Magic Wheel: wedges as stickers alongside the corner ones, and wheel turns. */

/** A wedge's direction with the rounding of repeated turns taken off (and no -0), so it stays a stable key. */
function snapDir(v: Vec): Vec {
  return v.map((x) => Math.round(x * 1e6) / 1e6 + 0) as Vec;
}

/** A wedge spun round its face: its direction turns, and it lands in the quadrant that direction points into. */
function spinWedge(s: Sticker, mv: Move): Sticker {
  const w = snapDir(rotateVec(s.w!, mv.axis, mv.angle));
  const p = s.p.map((c, i) => (i === mv.axis ? c : Math.sign(w[i]!) * Math.abs(c))) as Vec;
  return { ...s, p, w };
}

/**
 * A wheel turn: lowercase u d r l f b, one wedge on clockwise; a number of wedges after it (u2, u3)
 * and ' for anticlockwise. Null if not one.
 */
export function parseWheelMove(token: string, size: number, wedges: number): Move | null {
  const m = /^([udrlfb])(\d?)('?)$/.exec(token.trim());
  if (!m) return null;
  const steps = (m[2] ? Number(m[2]) : 1) * (m[3] ? -1 : 1);
  if (!steps || Math.abs(steps) >= wedges) return null;
  const base = parseMove(m[1]!.toUpperCase(), size);
  const angle = (base.angle * steps * 4) / wedges;
  const q = (Math.abs(angle) > Math.PI * 0.99 ? 2 : Math.sign(steps)) as 1 | 2 | -1;
  return { ...base, token, q, angle, wheel: true };
}

/** A wheel turn of `steps` wedges clockwise on `face`, written the shortest way: u, u2, u', u3'. */
export function wheelToken(face: Face, steps: number, wedges: number): string | null {
  let k = ((steps % wedges) + wedges) % wedges;
  if (!k) return null;
  if (k > wedges / 2) k -= wedges;
  const letter = face.toLowerCase();
  return `${letter}${Math.abs(k) === 1 ? "" : Math.abs(k)}${k < 0 ? "'" : ""}`;
}

/** Each face's up direction as its net is read (away from image-down). */
const upAxis = (f: Face): Vec => FACE_AXES[f].down.map((v) => -v) as Vec;

/** Which wedge of its face a direction is: 0.. counter-clockwise from the face's right, as the face is read. */
function wedgeIndex(f: Face, w: Vec, wedges: number): number {
  const ax = FACE_AXES[f];
  const up = upAxis(f);
  const a = Math.atan2(w[0] * up[0] + w[1] * up[1] + w[2] * up[2], w[0] * ax.right[0] + w[1] * ax.right[1] + w[2] * ax.right[2]);
  return Math.floor((((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) / ((2 * Math.PI) / wedges));
}

/** The wedges' colours: each face's, in wedge order (counter-clockwise from its right). */
export function wheelColours(stickers: Sticker[]): Record<Face, string> {
  const wedges = stickers.filter((s) => s.w);
  const per = wedges.length / 6;
  const out = Object.fromEntries(FACE_ORDER.map((f) => [f, Array.from({ length: per }, () => "?")])) as Record<Face, string[]>;
  for (const s of wedges) {
    const f = FACE_ORDER.find((g) => FACE_AXES[g].n.every((v, i) => v === s.n[i]))!;
    out[f][wedgeIndex(f, s.w!, per)] = s.c;
  }
  return Object.fromEntries(FACE_ORDER.map((f) => [f, out[f].join("")])) as Record<Face, string>;
}

/**
 * Stickers with a wheel of `wedges` wedges on every face: coloured from `colours` (wheelColours), or
 * else each like the corner sticker beside it (as on a cube turned by layers only).
 */
export function withWheels(size: number, stickers: Sticker[], wedges = 4, colours?: Record<Face, string>): Sticker[] {
  const plain = stickers.filter((s) => !s.w);
  const out = [...plain];
  for (const f of FACE_ORDER) {
    const ax = FACE_AXES[f];
    const up = upAxis(f);
    for (let k = 0; k < wedges; k++) {
      const a = ((k + 0.5) * 2 * Math.PI) / wedges;
      const w = snapDir([0, 1, 2].map((i) => Math.cos(a) * ax.right[i]! + Math.sin(a) * up[i]!) as Vec);
      const p = [0, 1, 2].map((i) => ax.n[i]! * (size - 1) + Math.sign(w[i]!) * (size - 1)) as Vec;
      const beside = plain.find((s) => s.p.every((v, i) => v === p[i]) && s.n.every((v, i) => v === ax.n[i]));
      out.push({ p, n: [...ax.n] as Vec, c: (colours?.[f]?.[k] ?? beside?.c ?? "?") as Color, w });
    }
  }
  return out;
}
