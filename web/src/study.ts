/**
 * Study mode: the solve screen driven by moves the user enters, starting from a solved cube (or
 * from wherever a solve had got to). This module is the part without the page: reading typed
 * moves, the tokens the keypad produces, and the keypad itself.
 */
import { parseMove, type Move } from "./cubeState.js";
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

/** What a face key types: R, 2R (that inner layer alone) or 3Rw (that many layers together). */
export function keyToken(face: string, depth: number, wide: boolean): string {
  if (depth <= 1) return face;
  if (wide) return `${depth === 2 ? "" : depth}${face}w`;
  return `${depth}${face}`;
}

/** The ' and 2 keys change the last move: R → R' → R, R → R2 → R. */
export function withModifier(tokens: string[], mod: "'" | "2"): string[] {
  const last = tokens[tokens.length - 1];
  if (!last) return tokens;
  const base = last.replace(/['2]$/, "");
  const now = last.slice(base.length);
  return [...tokens.slice(0, -1), now === mod ? base : base + mod];
}

/** The keypad: a layer row on 4×4 and up, the six faces, then ' 2 x y z and delete. */
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
  const faces = FACE_KEYS.map((f) => {
    const t = keyToken(f, depth, wide);
    return `<button type="button" class="k face" data-tok="${t}">${t}</button>`;
  }).join("");
  return `${layers}<div class="krow">${faces}</div>
    <div class="krow"><button type="button" class="k" data-mod="'">'</button><button type="button" class="k" data-mod="2">2</button><button type="button" class="k" data-tok="x">x</button><button type="button" class="k" data-tok="y">y</button><button type="button" class="k" data-tok="z">z</button><button type="button" class="k del" data-del aria-label="${tr("刪除", "Delete")}">⌫</button></div>`;
}
