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
  const lookup = new Map(stickers.map((s) => [key(s.p, s.n), s.c]));
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
    mv.layers.includes(s.p[mv.axis])
      ? { p: rotateVec(s.p, mv.axis, mv.angle).map(Math.round) as Vec, n: rotateVec(s.n, mv.axis, mv.angle).map(Math.round) as Vec, c: s.c }
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
