/**
 * Study mode: the solve screen driven by moves the user enters, starting from a solved cube (or
 * from wherever a solve had got to). This module is the part without the page: reading typed
 * moves, the tokens the keypad produces, and the keypad itself.
 */
import { FACE_AXES, FACE_ORDER, layerValues, parseMove, type Move, type Vec } from "./cubeState.js";
import { tr } from "./i18n.js";

export const FACE_KEYS = ["U", "D", "F", "B", "L", "R"] as const;

/** One token for this cube size, or null if it is not a move (unknown letter, a layer the cube does not have). */
export function studyMove(token: string, size: number): Move | null {
  try {
    const mv = parseMove(token, size);
    return mv.layers.length && mv.layers.every((v) => v !== undefined) ? mv : null;
  } catch {
    return null;
  }
}

/** Split typed text into tokens; curly quotes from phone keyboards count as primes. */
export function tokenize(text: string): string[] {
  return text.replace(/[’‘`´′]/g, "'").trim().split(/\s+/).filter(Boolean);
}

/** The moves among the tokens, and whether any token was not a move (those are skipped). */
export function readMoves(tokens: string[], size: number): { moves: Move[]; bad: boolean } {
  const moves: Move[] = [];
  let bad = false;
  for (const t of tokens) {
    const mv = studyMove(t, size);
    if (mv) moves.push(mv);
    else bad = true;
  }
  return { moves, bad };
}

/**
 * The tokens up to and including the n-th move, for an edit made with the slider partway: the
 * moves after that point are dropped. A token that is not a move stays only if it comes earlier.
 */
export function tokensThrough(tokens: string[], size: number, n: number): string[] {
  const out: string[] = [];
  let count = 0;
  for (const t of tokens) {
    if (count === n) break;
    out.push(t);
    if (studyMove(t, size)) count++;
  }
  return out;
}

/** What a face key types: R, 2R (that inner layer alone) or 3Rw (that many layers together). */
export function keyToken(face: string, depth: number, wide: boolean): string {
  if (depth <= 1) return face;
  if (wide) return `${depth === 2 ? "" : depth}${face}w`;
  return `${depth}${face}`;
}

/** Scramble lengths by cube size, roughly what competitions use. */
const SCRAMBLE_LENGTH: Record<number, number> = { 2: 11, 3: 20, 4: 40, 5: 60, 6: 80, 7: 100 };

/**
 * A random scramble: outer turns, plus wide turns of up to half the cube on 4×4 and bigger. No
 * two moves in a row turn about the same axis, so nothing merges or cancels.
 */
export function scrambleTokens(size: number, rand: () => number = Math.random): string[] {
  const faces = ["U", "D", "R", "L", "F", "B"];
  const axisOf = (f: string) => "UDRLFB".indexOf(f) >> 1;
  const deepest = Math.floor(size / 2);
  const out: string[] = [];
  let lastAxis = -1;
  while (out.length < (SCRAMBLE_LENGTH[size] ?? 20)) {
    const face = faces[Math.floor(rand() * 6)]!;
    if (axisOf(face) === lastAxis) continue;
    lastAxis = axisOf(face);
    const depth = size >= 4 ? 1 + Math.floor(rand() * deepest) : 1;
    out.push(keyToken(face, depth, true) + ["", "'", "2"][Math.floor(rand() * 3)]);
  }
  return out;
}

/** Quarter turns clockwise in a move's suffix: R 1, R2 2, R' 3. */
const quarters = (token: string) => (token.endsWith("2") ? 2 : token.endsWith("'") ? 3 : 1);

/**
 * A key press added to the moves: the same layer as the last move merges into it, the way the
 * turns add up on the cube. L L → L2, L2 L → L′, L′ L → nothing (the two cancel), L2 L′ → L.
 * Another face, layer or width is a new move.
 */
export function pushMove(tokens: string[], token: string): string[] {
  const last = tokens[tokens.length - 1];
  const base = token.replace(/['2]$/, "");
  if (!last || last.replace(/['2]$/, "") !== base) return [...tokens, token];
  const q = (quarters(last) + quarters(token)) % 4;
  const rest = tokens.slice(0, -1);
  return q === 0 ? rest : [...rest, base + ["", "", "2", "'"][q]];
}

/**
 * The move for a layer turned by hand: the layer at `layer` on `axis` (0 x, 1 y, 2 z, coordinates
 * as layerValues), turned `quarters` quarter turns by the right-hand rule about that axis. Named
 * from the nearer face (the positive one for the middle layer): R, 2R, L′, U2 and so on.
 */
export function twistToken(size: number, axis: 0 | 1 | 2, layer: number, quarters: number): string | null {
  const q = (((quarters % 4) + 4) % 4) as 0 | 1 | 2 | 3;
  if (!q) return null;
  const [pos, neg] = (["RL", "UD", "FB"] as const)[axis];
  const fromPos = (size - 1 - layer) / 2 + 1;
  const fromNeg = (layer + size - 1) / 2 + 1;
  const bases = layer >= 0 ? [[pos, fromPos], [neg, fromNeg]] : [[neg, fromNeg], [pos, fromPos]];
  const target = (q * Math.PI) / 2;
  const same = (a: number) => Math.abs(Math.atan2(Math.sin(a - target), Math.cos(a - target))) < 1e-6;
  for (const [face, depth] of bases as [string, number][]) {
    const base = depth === 1 ? face : `${depth}${face}`;
    for (const suffix of ["", "'", "2"]) {
      const mv = studyMove(base + suffix, size);
      if (mv && mv.axis === axis && mv.layers.length === 1 && mv.layers[0] === layer && same(mv.angle)) return base + suffix;
    }
  }
  return null;
}

/**
 * When only the last move changed on the same layer (R → R2, R → R', typed), the
 * extra turn from the old move to the new one, so the cube can turn into place instead of jumping.
 * R → R2 continues a quarter turn; R → R' goes back half a turn.
 */
export function deltaTurn(before: string, after: string, size: number): { move: Move; dir: 1 | -1 } | null {
  const base = before.replace(/['2]$/, "");
  if (before === after || after.replace(/['2]$/, "") !== base) return null;
  const a = studyMove(before, size);
  const b = studyMove(after, size);
  if (!a || !b) return null;
  const d = (((b.q - a.q) % 4) + 4) % 4;
  if (d === 1) return { move: studyMove(base, size)!, dir: 1 };
  if (d === 3) return { move: studyMove(`${base}'`, size)!, dir: 1 };
  return { move: studyMove(`${base}2`, size)!, dir: a.q > 0 ? -1 : 1 };
}

/** The keypad: a layer row on 4×4 and up, the six faces clockwise, the same six counter-clockwise, then x y z and x′ y′ z′ and delete. A half turn is the same key twice. */
export function keypadHtml(size: number, depth: number, wide: boolean): string {
  const deepest = Math.floor(size / 2);
  const layers =
    size >= 4
      ? `<div class="krow" style="grid-template-columns:repeat(${deepest + 1},1fr)">${Array.from({ length: deepest }, (_, i) => {
          const d = i + 1;
          const label = d === 1 ? tr("外層", "Outer") : tr(`第 ${d} 層`, `Layer ${d}`);
          return `<button type="button" class="k small${depth === d ? " on" : ""}" data-depth="${d}">${label}</button>`;
        }).join("")}<button type="button" class="k small${wide ? " on" : ""}" data-wide aria-pressed="${wide}">${tr("多層", "Wide")}</button></div>`
      : "";
  const row = (prime: boolean) =>
    FACE_KEYS.map((f) => {
      const t = keyToken(f, depth, wide) + (prime ? "'" : "");
      return `<button type="button" class="k ${prime ? "ccw" : "face"}" data-tok="${t}">${t.replace("'", "′")}</button>`;
    }).join("");
  return `${layers}<div class="krow">${row(false)}</div><div class="krow">${row(true)}</div>`;
}

/**
 * A marked sticker in words for the custom-sequence helper: the piece it sits on, named by the
 * faces that piece touches (corner UFR, edge UF, centre F), and the face carrying the dot. On
 * cubes bigger than 3×3 several pieces share a name, so the sticker's row and column are added.
 */
export function describeMark(key: string, size: number): string {
  const [p, n] = key.split("|").map((v) => v.split(",").map(Number) as Vec);
  const h = size - 1;
  const touched = [
    p![1] === h ? "U" : p![1] === -h ? "D" : "",
    p![2] === h ? "F" : p![2] === -h ? "B" : "",
    p![0] === h ? "R" : p![0] === -h ? "L" : "",
  ].join("");
  const kind = touched.length === 3 ? "corner" : touched.length === 2 ? "edge" : "centre";
  const face = FACE_ORDER.find((f) => FACE_AXES[f].n.every((v, i) => v === n![i]))!;
  if (size <= 3) return `${kind} ${touched} (dot on the ${face} face)`;
  const ax = FACE_AXES[face];
  const vals = layerValues(size);
  const dot = (a: Vec) => a[0] * p![0] + a[1] * p![1] + a[2] * p![2];
  const row = vals.indexOf(dot(ax.down)) + 1;
  const col = vals.indexOf(dot(ax.right)) + 1;
  return `${kind} ${touched} (dot on the ${face} face, row ${row}, column ${col})`;
}
