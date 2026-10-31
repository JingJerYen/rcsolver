/**
 * The Pyraminx (study mode): a tetrahedron cut into thirds from each corner. Four corners U (top),
 * L (front left), R (front right) and B (back); a layer turn (U L R B) turns that corner's two
 * upper thirds 120° clockwise as seen from the corner, a tip turn (u l r b) the tip alone.
 *
 * Its stickers live in the same sticker model as the cubes (`Sticker.t` holds each triangle), so
 * the view, the study and saving treat it like any other puzzle there.
 */
import type { Color, Face } from "./api.js";
import { addSnapPoints, along, applyAlgorithm, applyMove, isSolved, type Move, type Sticker, type Vec } from "./cubeState.js";

const S6 = Math.sqrt(6), S2 = Math.sqrt(2);
/** The corners, 3 from the middle: standing on its bottom face with a face towards the viewer. */
export const PYRA_CORNERS: Record<"U" | "L" | "R" | "B", Vec> = {
  U: [0, 3, 0],
  L: [-S6, -1, S2],
  R: [S6, -1, S2],
  B: [0, -1, -2 * S2],
};
const CORNERS = ["U", "L", "R", "B"] as const;
type Corner = (typeof CORNERS)[number];
const unit = (v: Vec): Vec => v.map((x) => x / 3) as Vec;

/** Each face (its corners, the first one the apex its rows count from) and its colour. */
const FACES: { corners: [Corner, Corner, Corner]; colour: Color }[] = [
  { corners: ["U", "L", "R"], colour: "G" },
  { corners: ["U", "R", "B"], colour: "B" },
  { corners: ["U", "B", "L"], colour: "R" },
  { corners: ["L", "B", "R"], colour: "Y" },
];

/** Where along a corner's axis the cuts lie: past the first the tip, past the second its layer too. */
const TIP_CUT = 5 / 3;
const LAYER_CUT = 1 / 3;

/** The solved Pyraminx, built once: nine triangles a face, row by row from the face's first corner. */
const SOLVED: Sticker[] = [];
for (const f of FACES) {
  const [a, b, c] = f.corners.map((k) => PYRA_CORNERS[k]);
  const at = (i: number, j: number): Vec => [0, 1, 2].map((x) => a![x]! + ((b![x]! - a![x]!) * i) / 3 + ((c![x]! - a![x]!) * j) / 3) as Vec;
  const opposite = CORNERS.find((k) => !f.corners.includes(k))!;
  const n = unit(PYRA_CORNERS[opposite]).map((x) => -x) as Vec;
  for (let row = 0; row < 3; row++) {
    for (let k = 0; k <= 2 * row; k++) {
      const j = Math.floor(k / 2), i = row - j;
      const t = (k % 2 === 0 ? [at(i, j), at(i + 1, j), at(i, j + 1)] : [at(i, j), at(i, j + 1), at(i - 1, j + 1)]) as [Vec, Vec, Vec];
      const p = [0, 1, 2].map((x) => (t[0][x]! + t[1][x]! + t[2][x]!) / 3) as Vec;
      SOLVED.push({ p, n, c: f.colour, t });
    }
  }
}
// every place a turn can put a middle, a normal or a triangle's corner
addSnapPoints(SOLVED.flatMap((s) => [s.p, s.n, ...s.t!]).filter((q, i, all) => all.findIndex((r) => r.every((x, k) => Math.abs(x - q[k]!) < 1e-9)) === i));

export function pyraSolved(): Sticker[] {
  return SOLVED.map((s) => ({ ...s }));
}

/** A Pyraminx token as a move: U L R B (layer) or u l r b (tip), ′ counter-clockwise. */
export function parsePyraMove(token: string): Move | null {
  const m = /^([ULRBulrb])('?)$/.exec(token.trim());
  if (!m) return null;
  const corner = m[1]!.toUpperCase() as Corner;
  const tip = m[1] !== corner;
  const q = m[2] ? -1 : 1;
  // clockwise as seen from the corner: a negative turn about the axis pointing out through it
  return { token, face: corner as Face, axis: 0, layers: [], q, angle: (-q * 2 * Math.PI) / 3, k: unit(PYRA_CORNERS[corner]), depth: tip ? TIP_CUT : LAYER_CUT };
}

/** Which piece a sticker (by its middle) is on: a tip, a corner's centre piece, or an edge between two corners. */
export function pyraPiece(p: Vec): string {
  const inside = CORNERS.filter((k) => along(p, unit(PYRA_CORNERS[k])) > LAYER_CUT);
  if (inside.length === 2) return `e${inside.join("")}`;
  const k = inside[0]!;
  return `${along(p, unit(PYRA_CORNERS[k])) > TIP_CUT ? "t" : "a"}${k}`;
}

const keyOf = (s: Sticker) => `${s.p.join(",")}|${s.n.join(",")}`;

/** The colours of a Pyraminx's stickers, in the solved one's order: what a save keeps. */
export function pyraColours(stickers: Sticker[]): string {
  const at = new Map(stickers.map((s) => [keyOf(s), s.c]));
  return pyraSolved()
    .map((s) => at.get(keyOf(s)) ?? "?")
    .join("");
}

/** A Pyraminx with these colours (`pyraColours`). */
export function pyraFromColours(colours: string): Sticker[] {
  return pyraSolved().map((s, i) => ({ ...s, c: (colours[i] ?? s.c) as Color }));
}

/** A scramble: eleven layer turns, never the same corner twice running, then each tip at random. */
export function pyraScrambleTokens(rand: () => number = Math.random): string[] {
  const out: string[] = [];
  let last = "";
  while (out.length < 11) {
    const c = CORNERS[Math.floor(rand() * 4)]!;
    if (c === last) continue;
    last = c;
    out.push(c + (rand() < 0.5 ? "" : "'"));
  }
  for (const c of CORNERS) {
    const r = Math.floor(rand() * 3);
    if (r) out.push(c.toLowerCase() + (r === 2 ? "'" : ""));
  }
  return out;
}

const LAYER_TOKENS = CORNERS.flatMap((c) => [c, `${c}'`]);

interface Tables {
  places: Sticker[];
  slotOf: Map<string, number>;
  /** Where each move takes the sticker in each place. */
  perm: Map<string, Int16Array>;
  axial: number[];
  edge: number[];
  /** Fewest layer turns from each colouring of the centre pieces, and of the edges, to solved. */
  axialDist: Map<string, number>;
  edgeDist: Map<string, number>;
}
let tables: Tables | null = null;

function build(): Tables {
  const places = pyraSolved();
  const slotOf = new Map(places.map((s, i) => [keyOf(s), i]));
  const perm = new Map<string, Int16Array>();
  for (const t of [...LAYER_TOKENS, ...LAYER_TOKENS.map((x) => x.toLowerCase())]) {
    const mv = parsePyraMove(t)!;
    perm.set(t, Int16Array.from(places.map((s) => slotOf.get(keyOf(applyMove([s], mv)[0]!))!)));
  }
  const axial = places.flatMap((s, i) => (pyraPiece(s.p)[0] === "a" ? [i] : []));
  const edge = places.flatMap((s, i) => (pyraPiece(s.p)[0] === "e" ? [i] : []));
  // every colouring of these places that layer turns reach, by breadth-first search from solved
  const distances = (slots: number[]) => {
    const local = new Map(slots.map((s, i) => [s, i]));
    const moves = LAYER_TOKENS.map((t) => slots.map((s) => local.get(perm.get(t)![s]!)!));
    const start = slots.map((s) => places[s]!.c).join("");
    const dist = new Map([[start, 0]]);
    let frontier = [start];
    for (let d = 1; frontier.length; d++) {
      const next: string[] = [];
      for (const st of frontier)
        for (const m of moves) {
          const out = new Array<string>(st.length);
          for (let i = 0; i < st.length; i++) out[m[i]!] = st[i]!;
          const key = out.join("");
          if (dist.has(key)) continue;
          dist.set(key, d);
          next.push(key);
        }
      frontier = next;
    }
    return dist;
  };
  return { places, slotOf, perm, axial, edge, axialDist: distances(axial), edgeDist: distances(edge) };
}

const step = (state: string[], d: Int16Array) => {
  const out = state.slice();
  state.forEach((c, i) => (out[d[i]!] = c));
  return out;
};

/**
 * A solution: the tips first (each turned to match the centre piece under it, which no layer turn
 * changes), then the fewest layer turns, found by iterative deepening on two exact distance tables
 * (centre pieces, edges). At most 4 tip turns and 11 layer turns. Null if the stickers are not a
 * Pyraminx this model knows.
 */
export function solvePyra(stickers: Sticker[]): string[] | null {
  const t = (tables ??= build());
  let state = new Array<string>(t.places.length);
  for (const s of stickers) {
    const slot = t.slotOf.get(keyOf(s));
    if (slot === undefined) return null;
    state[slot] = s.c;
  }
  const out: string[] = [];
  // tips: turn each until its colours match its centre piece's on the same faces
  for (const c of CORNERS) {
    const tip = t.places.flatMap((s, i) => (pyraPiece(s.p) === `t${c}` ? [i] : []));
    const ax = t.places.flatMap((s, i) => (pyraPiece(s.p) === `a${c}` ? [i] : []));
    const fits = (st: string[]) => tip.every((i) => st[i] === st[ax.find((j) => t.places[j]!.n.join() === t.places[i]!.n.join())!]);
    for (const tok of ["", c.toLowerCase(), `${c.toLowerCase()}'`]) {
      const tried = tok ? step(state, t.perm.get(tok)!) : state;
      if (fits(tried)) {
        if (tok) out.push(tok);
        state = tried;
        break;
      }
    }
  }
  const h = (st: string[]) => Math.max(t.axialDist.get(t.axial.map((i) => st[i]).join("")) ?? 99, t.edgeDist.get(t.edge.map((i) => st[i]).join("")) ?? 99);
  if (h(state) >= 99) return null;
  const path: string[] = [];
  const search = (st: string[], bound: number, last: string): boolean => {
    const est = h(st);
    if (est === 0) return true;
    if (path.length + est > bound) return false;
    for (const tok of LAYER_TOKENS) {
      if (tok[0] === last) continue;
      path.push(tok);
      if (search(step(st, t.perm.get(tok)!), bound, tok[0]!)) return true;
      path.pop();
    }
    return false;
  };
  for (let bound = h(state); bound <= 12; bound++) if (search(state, bound, "")) break;
  const all = [...out, ...path];
  // checked on the stickers themselves
  return isSolved(applyAlgorithm(stickers, all.map((tok) => parsePyraMove(tok)!))) ? all : null;
}
