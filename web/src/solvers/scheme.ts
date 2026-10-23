/**
 * Colour scheme for cubes without fixed centres (2×2, 4×4, 6×6). The DBL corner fixes the
 * colours of D, B and L; the opposite colour of each is the one that never shares a corner
 * with it. Works for any brand's scheme, as long as the stickers were read correctly.
 */
import type { Color, Face } from "../api.js";
import { FACE_ORDER } from "../cubeState.js";

export type Net = Record<Face, string[]>;

/** Corner stickers as (face, row, col) on an N×N net, in Kociemba order URF UFL ULB UBR DFR DLF DBL DRB. */
export function cornerCells(size: number): [Face, number, number][][] {
  const m = size - 1;
  return [
    [["U", m, m], ["R", 0, 0], ["F", 0, m]],
    [["U", m, 0], ["F", 0, 0], ["L", 0, m]],
    [["U", 0, 0], ["L", 0, 0], ["B", 0, m]],
    [["U", 0, m], ["B", 0, 0], ["R", 0, m]],
    [["D", 0, m], ["F", m, m], ["R", m, 0]],
    [["D", 0, 0], ["L", m, m], ["F", m, 0]],
    [["D", m, 0], ["B", m, m], ["L", m, 0]],
    [["D", m, m], ["R", m, m], ["B", m, 0]],
  ];
}

export function cell(net: Net, f: Face, r: number, c: number): Color {
  return net[f][r]![c] as Color;
}

export interface Scheme {
  colorOfFace: Record<Face, Color>;
  faceOfColor: Map<Color, Face>;
}

/** Derive the scheme from the corners, or null when the corners cannot belong to one cube. */
export function schemeFromCorners(net: Net, size: number): Scheme | null {
  const corners = cornerCells(size).map((cs) => cs.map(([f, r, c]) => cell(net, f, r, c)));
  const dbl = corners[6]!; // (D, B, L) stickers
  const colorOfFace = { D: dbl[0]!, B: dbl[1]!, L: dbl[2]! } as Record<Face, Color>;
  const used = new Set<Color>(dbl);
  if (used.size !== 3) return null;
  const rest = (["W", "Y", "R", "O", "G", "B"] as Color[]).filter((c) => !used.has(c));
  const together = (a: Color, b: Color) => corners.some((cs) => cs.includes(a) && cs.includes(b));
  for (const [face, opp] of [["U", "D"], ["R", "L"], ["F", "B"]] as [Face, Face][]) {
    const candidates = rest.filter((c) => !together(c, colorOfFace[opp]));
    if (candidates.length !== 1) return null;
    colorOfFace[face] = candidates[0]!;
  }
  if (new Set(Object.values(colorOfFace)).size !== 6) return null;
  const faceOfColor = new Map<Color, Face>();
  for (const f of FACE_ORDER) faceOfColor.set(colorOfFace[f], f);
  return { colorOfFace, faceOfColor };
}

const CORNER_COLORS: Face[][] = [["U", "R", "F"], ["U", "F", "L"], ["U", "L", "B"], ["U", "B", "R"], ["D", "F", "R"], ["D", "L", "F"], ["D", "B", "L"], ["D", "R", "B"]];

/** Corner pieces that cannot exist under the scheme, as net cells. */
export function badCorners(net: Net, size: number, faceOfColor: Map<Color, Face>): { face: Face; row: number; col: number }[] {
  const bad: { face: Face; row: number; col: number }[] = [];
  for (const cs of cornerCells(size)) {
    const f = cs.map(([face, r, c]) => faceOfColor.get(cell(net, face, r, c))!);
    let found = false;
    for (let ori = 0; ori < 3 && !found; ori++) {
      const a = f[ori];
      if (a !== "U" && a !== "D") continue;
      const b = f[(ori + 1) % 3];
      const c = f[(ori + 2) % 3];
      found = CORNER_COLORS.some((cc) => cc[1] === b && cc[2] === c);
    }
    if (!found) bad.push(...cs.map(([face, row, col]) => ({ face, row, col })));
  }
  return bad;
}
