/**
 * The 3×3 whose centres have arrows (study mode's "3×3 ▲"): once the colours are solved, turn the
 * arrows back without disturbing anything else. Every macro below leaves the colours solved and
 * only turns centres, so the arrows are a separate small puzzle: 4⁶ ways to point the six arrows,
 * of which the reachable half (an even total of quarter turns) is searched once, cheapest first.
 */
import type { Face } from "../api.js";
import { netToFacelets } from "../cube3.js";
import { applyAlgorithm, centreTurns, FACE_AXES, FACE_ORDER, fromNet, isSolved, parseAlgorithm, parseMove, pointCentres, rotateVec, toNet, type Sticker, type Vec } from "../cubeState.js";
import { solve3 } from "../solver.js";

/** Face-turn sequences that put every piece back and turn some centres; each is used in all 24 orientations and both directions. */
const MACROS = [
  // the U centre a half turn
  "U R L U2 R' L' U R L U2 R' L'",
  // half turns found by a meet-in-the-middle search over face turns: U and B; R and L; four centres at once
  "R U2 F2 D2 R' L B2 D2 F2 L'",
  "U R2 U2 F2 B2 D2 L2 D2 B2 F2 U",
  "U R2 F2 B2 R2 U' D F2 L2 R2 F2 D'",
  // the U and D centres a quarter turn each: X U X with X = R L' F2 B2 R L' turns the D layer, but the U centre
  "R L' F2 B2 R L' U R L' F2 B2 R L' D'",
  // the U and R centres a quarter turn each: the U perm three times over (found on speedsolving.com); long,
  // so `solveArrows` mostly avoids it by picking a colour solution that leaves no such pair
  "R2 U R U R' U' R' U' R' U R U R U R' U' R' U' R' U R U R U R' U' R' U' R' U R'",
];

/** The 24 orientations of the cube, as whole-cube turns. */
const ROTATIONS = ["", "x", "x2", "x'", "z", "z'"].flatMap((a) => ["", "y", "y2", "y'"].map((b) => `${a} ${b}`.trim()));

/** `alg` done in another orientation: each face letter becomes the face that `rotation` carries it to. */
function relabel(alg: string, rotation: string): string {
  const map = new Map<Face, Face>();
  for (const f of FACE_ORDER) {
    let n: Vec = [...FACE_AXES[f].n];
    for (const t of rotation.split(" ").filter(Boolean)) {
      const mv = parseMove(t, 3)!;
      n = rotateVec(n, mv.axis, mv.angle).map(Math.round) as Vec;
    }
    map.set(f, FACE_ORDER.find((g) => FACE_AXES[g].n.every((v, i) => v === n[i]))!);
  }
  return alg.replace(/[URFDLB]/g, (f) => map.get(f as Face)!);
}

function invert(alg: string): string {
  return alg
    .split(" ")
    .reverse()
    .map((t) => (t.endsWith("2") ? t : t.endsWith("'") ? t.slice(0, -1) : `${t}'`))
    .join(" ");
}

const SOLVED: Record<Face, string> = { U: "W", R: "R", F: "G", D: "Y", L: "O", B: "B" };

function pointedSolved(): Sticker[] {
  const faces = Object.fromEntries(FACE_ORDER.map((f) => [f, [0, 1, 2].map(() => SOLVED[f].repeat(3))]));
  return pointCentres(3, fromNet(3, faces as Record<Face, string[]>));
}

/**
 * Where the arrows point on the solved cube in the orientation `stickers` is held: the plain
 * solved cube turned whole until its centre colours match. Null if no orientation matches.
 */
function targetTurns(stickers: Sticker[]): number[] | null {
  const solved = pointedSolved();
  const centreColour = (st: Sticker[]) => FACE_ORDER.map((f) => st.find((s) => s.d && s.n.every((v, i) => Math.round(v) === FACE_AXES[f].n[i]))?.c).join("");
  const want = centreColour(stickers);
  for (const r of ROTATIONS) {
    const turned = applyAlgorithm(solved, parseAlgorithm(r, 3));
    if (centreColour(turned) === want) return centreTurns(3, turned);
  }
  return null;
}

/** A state of the six arrows as one number: base 4, U first. */
const code = (turns: number[]) => turns.reduce((acc, t, i) => acc + (((t % 4) + 4) % 4) * 4 ** i, 0);

let table: { prev: Int32Array; via: Int32Array; macros: { alg: string; delta: number[] }[] } | null = null;

/** Cheapest macro path from every arrow state to all-up, built on first use (a few milliseconds). */
function build() {
  const solved = pointedSolved();
  const seen = new Set<string>();
  const macros: { alg: string; delta: number[] }[] = [];
  for (const m of MACROS)
    for (const r of ROTATIONS)
      for (const alg of [relabel(m, r), invert(relabel(m, r))]) {
        if (seen.has(alg)) continue;
        seen.add(alg);
        const end = applyAlgorithm(solved, parseAlgorithm(alg, 3));
        if (isSolved(end)) macros.push({ alg, delta: centreTurns(3, end) });
      }
  // Dijkstra from all-up over macro steps, by move count: the path to a state is the cheapest set of macros turning the arrows that much
  const cost = new Float64Array(4096).fill(Infinity);
  const prev = new Int32Array(4096).fill(-1);
  const via = new Int32Array(4096).fill(-1);
  const done = new Uint8Array(4096);
  cost[0] = 0;
  for (;;) {
    let s = -1;
    for (let i = 0; i < 4096; i++) if (!done[i] && cost[i]! < Infinity && (s < 0 || cost[i]! < cost[s]!)) s = i;
    if (s < 0) break;
    done[s] = 1;
    const turns = [0, 1, 2, 3, 4, 5].map((i) => Math.floor(s / 4 ** i) % 4);
    macros.forEach((m, k) => {
      const t = code(turns.map((v, i) => v + m.delta[i]!));
      const c = cost[s]! + m.alg.split(" ").length;
      if (c < cost[t]!) {
        cost[t] = c;
        prev[t] = s;
        via[t] = k;
      }
    });
  }
  return { prev, via, macros };
}

/**
 * Moves that point every arrow of a colour-solved cube back up its face, keeping the colours;
 * null if the arrows cannot be reached (they always can on a cube that was turned, never pulled apart).
 */
export function fixArrows(stickers: Sticker[]): string[] | null {
  table ??= build();
  const target = targetTurns(stickers);
  if (!target) return null;
  const now = centreTurns(3, stickers);
  // how far each arrow still has to turn; the macros' turns add up, in any order
  let s = code(target.map((v, i) => v - now[i]!));
  if (table.prev[s] === -1 && s !== 0) return null;
  const out: string[] = [];
  while (s !== 0) {
    out.push(table.macros[table.via[s]!]!.alg);
    s = table.prev[s]!;
  }
  return out.join(" ").split(" ").filter(Boolean);
}

/** Quarter turns of a face token: U 1, U2 2, U' 3. */
const quarters = (t: string) => (t.endsWith("2") ? 2 : t.endsWith("'") ? 3 : 1);

/** Turns of the same face in a row merged (U U → U2, U U' → nothing); also across a turn of the opposite face. */
export function simplify(tokens: string[]): string[] {
  const out: string[] = [];
  const opposite: Record<string, string> = { U: "D", D: "U", R: "L", L: "R", F: "B", B: "F" };
  for (const t of tokens) {
    const f = t[0]!;
    const at = out.length - 1;
    const i = out[at]?.[0] === f ? at : out[at]?.[0] === opposite[f] && out[at - 1]?.[0] === f ? at - 1 : -1;
    if (i < 0) {
      out.push(t);
      continue;
    }
    const q = (quarters(out[i]!) + quarters(t)) % 4;
    if (q === 0) out.splice(i, 1);
    else out[i] = f + ["", "", "2", "'"][q];
  }
  return out;
}

/**
 * A whole solution for the 3×3 with arrows: the colours by the two-phase solver, then the arrows.
 * Which centres a colour solution leaves turned depends on the solution, so a few are tried (after
 * a first move or none) and the shortest total kept; that mostly spares the long U-perm macro.
 */
export function solveArrows(stickers: Sticker[]): string[] | null {
  let best: string[] | null = null;
  const singles = FACE_ORDER.flatMap((f) => [f, `${f}'`, `${f}2`]);
  const firsts = ["", ...singles, ...singles.flatMap((a) => singles.filter((b) => b[0] !== a[0]).map((b) => `${a} ${b}`))];
  for (const first of firsts) {
    const start = applyAlgorithm(stickers, parseAlgorithm(first, 3));
    const read = netToFacelets(toNet(3, start));
    if (!read) return null;
    const colours = [...first.split(" ").filter(Boolean), ...solve3(read.facelets)];
    const fix = fixArrows(applyAlgorithm(stickers, parseAlgorithm(colours.join(" "), 3)));
    if (!fix) continue;
    const all = simplify([...colours, ...fix]);
    if (!best || all.length < best.length) best = all;
    // a colour solution that happens to leave the arrows up cannot be beaten by much
    if (!fix.length && best.length <= 24) break;
  }
  return best;
}
