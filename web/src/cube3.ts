/**
 * 3×3 specifics: turning a recognised net into Kociemba facelets and checking that it is a
 * cube that can exist, pointing at the stickers that cannot be right when it is not.
 */
import type { Color, Face } from "./api.js";
import { FACE_ORDER } from "./cubeState.js";

// Facelet index = face index (U R F D L B) × 9 + row × 3 + col.
const CORNER_FACELETS = [[8, 9, 20], [6, 18, 38], [0, 36, 47], [2, 45, 11], [29, 26, 15], [27, 44, 24], [33, 53, 42], [35, 17, 51]];
const CORNER_COLORS: Face[][] = [["U", "R", "F"], ["U", "F", "L"], ["U", "L", "B"], ["U", "B", "R"], ["D", "F", "R"], ["D", "L", "F"], ["D", "B", "L"], ["D", "R", "B"]];
const EDGE_FACELETS = [[5, 10], [7, 19], [3, 37], [1, 46], [32, 16], [28, 25], [30, 43], [34, 52], [23, 12], [21, 41], [50, 39], [48, 14]];
const EDGE_COLORS: Face[][] = [["U", "R"], ["U", "F"], ["U", "L"], ["U", "B"], ["D", "R"], ["D", "F"], ["D", "L"], ["D", "B"], ["F", "R"], ["F", "L"], ["B", "L"], ["B", "R"]];

export interface FaceletCell {
  face: Face;
  row: number;
  col: number;
}

export function faceletCell(index: number): FaceletCell {
  return { face: FACE_ORDER[Math.floor(index / 9)]!, row: Math.floor((index % 9) / 3), col: index % 3 };
}

/**
 * Map sticker colours to face letters using the centre of each face, and build the 54-letter
 * facelet string. Returns null when two centres share a colour.
 */
export function netToFacelets(faces: Record<Face, string[]>): { facelets: string; colorOfFace: Record<Face, Color> } | null {
  const faceOfColor = new Map<string, Face>();
  const colorOfFace = {} as Record<Face, Color>;
  for (const f of FACE_ORDER) {
    const centre = faces[f][1]![1]!;
    if (faceOfColor.has(centre)) return null;
    faceOfColor.set(centre, f);
    colorOfFace[f] = centre as Color;
  }
  let facelets = "";
  for (const f of FACE_ORDER) for (const row of faces[f]) for (const ch of row) facelets += faceOfColor.get(ch) ?? "?";
  return { facelets, colorOfFace };
}

export interface Validity {
  ok: boolean;
  /** Facelet indices of pieces that cannot exist (e.g. a corner with two whites). */
  badFacelets: number[];
  /** Why the whole cube is impossible even though every piece exists. */
  reasons: ("duplicate_piece" | "corner_twist" | "edge_flip" | "parity" | "centres")[];
}

/** Check a facelet string the way Kociemba's FaceCube.verify does, plus which stickers are to blame. */
export function checkFacelets(facelets: string): Validity {
  const f = facelets.split("") as Face[];
  const bad: number[] = [];
  const reasons: Validity["reasons"] = [];
  const cp: number[] = [];
  const co: number[] = [];
  for (let i = 0; i < 8; i++) {
    const idx = CORNER_FACELETS[i]!;
    let found = false;
    for (let ori = 0; ori < 3 && !found; ori++) {
      const a = f[idx[ori]!];
      if (a !== "U" && a !== "D") continue;
      const b = f[idx[(ori + 1) % 3]!];
      const c = f[idx[(ori + 2) % 3]!];
      for (let j = 0; j < 8; j++) {
        if (CORNER_COLORS[j]![1] === b && CORNER_COLORS[j]![2] === c) {
          cp.push(j);
          co.push(ori);
          found = true;
          break;
        }
      }
    }
    if (!found) bad.push(...idx);
  }
  const ep: number[] = [];
  const eo: number[] = [];
  for (let i = 0; i < 12; i++) {
    const idx = EDGE_FACELETS[i]!;
    let found = false;
    for (let ori = 0; ori < 2 && !found; ori++) {
      const a = f[idx[ori]!];
      const b = f[idx[(ori + 1) % 2]!];
      for (let j = 0; j < 12; j++) {
        if (EDGE_COLORS[j]![0] === a && EDGE_COLORS[j]![1] === b) {
          ep.push(j);
          eo.push(ori);
          found = true;
          break;
        }
      }
    }
    if (!found) bad.push(...idx);
  }
  if (bad.length) return { ok: false, badFacelets: bad, reasons };
  if (new Set(cp).size !== 8 || new Set(ep).size !== 12) reasons.push("duplicate_piece");
  if (co.reduce((a, b) => a + b, 0) % 3 !== 0) reasons.push("corner_twist");
  if (eo.reduce((a, b) => a + b, 0) % 2 !== 0) reasons.push("edge_flip");
  if (!reasons.includes("duplicate_piece") && parity(cp) !== parity(ep)) reasons.push("parity");
  return { ok: reasons.length === 0, badFacelets: [], reasons };
}

function parity(perm: number[]): number {
  let s = 0;
  for (let i = 0; i < perm.length; i++) for (let j = i + 1; j < perm.length; j++) if (perm[i]! > perm[j]!) s++;
  return s % 2;
}
