/**
 * Kociemba-style facelet strings for sharing a cube state: faces in the order U R F D L B,
 * each face row by row, one letter per sticker naming the face that sticker belongs to
 * (so a solved 3×3 is UUUUUUUUURRRRRRRRR…). Centres decide the mapping on odd cubes, the
 * corners on even ones. Colour letters (W Y R O G B) are accepted on import too.
 */
import type { Color, Face } from "./api.js";
import { FACE_ORDER } from "./cubeState.js";
import { schemeFromCorners, type Net } from "./solvers/scheme.js";

const STANDARD: Record<Face, Color> = { U: "W", R: "R", F: "G", D: "Y", L: "O", B: "B" };

function faceOfColorMap(net: Net, size: number): Map<Color, Face> | null {
  if (size % 2 === 1) {
    const m = new Map<Color, Face>();
    const mid = (size - 1) / 2;
    for (const f of FACE_ORDER) {
      const c = net[f][mid]![mid]! as Color;
      if (m.has(c)) return null;
      m.set(c, f);
    }
    return m;
  }
  return schemeFromCorners(net, size)?.faceOfColor ?? null;
}

/** Facelet string of a net, or null when the stickers cannot be mapped to faces. */
export function toFacelets(net: Net, size: number): string | null {
  const map = faceOfColorMap(net, size);
  if (!map) return null;
  let out = "";
  for (const f of FACE_ORDER) for (const row of net[f]) for (const ch of row) out += map.get(ch as Color) ?? "?";
  return out.includes("?") ? null : out;
}

/** Parse a facelet string (face letters, or colour letters) into a net; null if it is not one. */
export function fromFacelets(text: string): { size: number; net: Net } | null {
  const s = text.replace(/[^A-Za-z]/g, "").toUpperCase();
  const size = Math.round(Math.sqrt(s.length / 6));
  if (size < 2 || size > 7 || size * size * 6 !== s.length) return null;
  const isFaces = /^[URFDLB]+$/.test(s);
  const isColors = /^[WYROGB]+$/.test(s);
  if (!isFaces && !isColors) return null;
  const net = {} as Net;
  let i = 0;
  for (const f of FACE_ORDER) {
    net[f] = [];
    for (let r = 0; r < size; r++) {
      let row = "";
      for (let c = 0; c < size; c++) row += isFaces ? STANDARD[s[i++]! as Face] : s[i++]!;
      net[f].push(row);
    }
  }
  return { size, net };
}
