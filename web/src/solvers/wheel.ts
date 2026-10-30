/**
 * The 2×2 Magic Wheel (study mode): the corners first, by the 2×2 solver, then the wedges.
 *
 * Nothing on the web had a method for this puzzle, so the wedges use one idea: a layer turn, a
 * wheel turn and the layer turned back (R u R′) leaves every corner where it was but trades wedges
 * between two wheels. Those conjugates and the plain wheel turns are the only macros, so once the
 * corners are solved they stay solved; a beam search over them, scored by the wedges still on the
 * wrong face, brings the wedges home.
 */
import type { Face } from "../api.js";
import { applyAlgorithm, applyMove, FACE_ORDER, fromNet, isSolved, parseMove, parseWheelMove, toNet, wheelToken, withWheels, type Move, type Sticker } from "../cubeState.js";
import { solve2 } from "./cube2.js";

const LAYERS = FACE_ORDER.flatMap((f) => [f, `${f}'`, `${f}2`]);
/** Every wheel turn of a wheel with this many wedges, written the shortest way. */
const wheelTurns = (wedges: number) => FACE_ORDER.flatMap((f) => Array.from({ length: wedges - 1 }, (_, k) => wheelToken(f, k + 1, wedges)!));

const move = (token: string, wedges: number): Move => (/^[udrlfb]/.test(token) ? parseWheelMove(token, 2, wedges)! : parseMove(token, 2));

function inverse(token: string, wedges: number): string {
  const wheel = /^([udrlfb])(\d?)('?)$/.exec(token);
  if (wheel) return wheelToken(wheel[1]!.toUpperCase() as Face, -(wheel[2] ? Number(wheel[2]) : 1) * (wheel[3] ? -1 : 1), wedges)!;
  return token.endsWith("2") ? token : token.endsWith("'") ? token[0]! : `${token}'`;
}

/** A sticker's place: where it is, which way it faces, and for a wedge which way it points. */
const placeKey = (s: Sticker) => `${s.p.join(",")}|${s.n.join(",")}|${s.w ? s.w.map((v) => Math.round(v * 1000) + 0).join(",") : ""}`;

interface Tables {
  /** The places, as on a solved cube. */
  places: Sticker[];
  slotOf: Map<string, number>;
  /** Where each move takes the sticker in each place. */
  perm: Map<string, Int16Array>;
  /** The wedge places, and each macro as a permutation of them alone (corners stay put). */
  wedgeSlots: number[];
  macros: { tokens: string[]; dest: Int16Array }[];
}

const tables = new Map<number, Tables>();

function build(wedges: number): Tables {
  const faces = Object.fromEntries(FACE_ORDER.map((f) => [f, [f + f, f + f]])) as Record<Face, string[]>;
  const places = withWheels(2, fromNet(2, faces), wedges);
  const slotOf = new Map(places.map((s, i) => [placeKey(s), i]));
  const perm = new Map<string, Int16Array>();
  for (const t of [...LAYERS, ...wheelTurns(wedges)]) {
    const mv = move(t, wedges);
    perm.set(t, Int16Array.from(places.map((s) => slotOf.get(placeKey(applyMove([s], mv)[0]!))!)));
  }
  const wedgeSlots = places.flatMap((s, i) => (s.w ? [i] : []));
  const local = new Map(wedgeSlots.map((slot, k) => [slot, k]));
  const sequences = [...wheelTurns(wedges).map((w) => [w]), ...LAYERS.flatMap((a) => wheelTurns(wedges).map((w) => [a, w, inverse(a, wedges)]))];
  const macros = sequences.map((tokens) => {
    // follow each wedge place through the sequence
    const dest = Int16Array.from(wedgeSlots.map((slot) => local.get(tokens.reduce((at, t) => perm.get(t)![at]!, slot))!));
    return { tokens, dest };
  });
  return { places, slotOf, perm, wedgeSlots, macros };
}

/** Same-letter turns in a row merged: layers by quarters, wheels by wedges. */
function simplify(tokens: string[], wedges: number): string[] {
  const out: string[] = [];
  const steps = (t: string) => {
    const m = /^([A-Za-z])(\d?)('?)$/.exec(t)!;
    return (m[2] ? Number(m[2]) : 1) * (m[3] ? -1 : 1);
  };
  for (const t of tokens) {
    const last = out[out.length - 1];
    if (!last || last[0] !== t[0]) {
      out.push(t);
      continue;
    }
    out.pop();
    const wheel = t[0] === t[0]!.toLowerCase();
    const merged = wheel ? wheelToken(t[0]!.toUpperCase() as Face, steps(last) + steps(t), wedges) : ["", t[0], `${t[0]}2`, `${t[0]}'`][(((steps(last) + steps(t)) % 4) + 4) % 4];
    if (merged) out.push(merged);
  }
  return out;
}

/**
 * Moves that solve this Magic Wheel (layer turns U R F D L B, wheel turns u r f d l b), or null when
 * the stickers are not one. About 40 moves for four wedges a wheel; `beam` trades time for length.
 */
export function solveWheel(stickers: Sticker[], wedges: number, beam = 30): string[] | null {
  const t = tables.get(wedges) ?? build(wedges);
  tables.set(wedges, t);
  if (stickers.length !== t.places.length) return null;
  // colours by place
  const colours: string[] = new Array(t.places.length);
  for (const s of stickers) {
    const slot = t.slotOf.get(placeKey(s));
    if (slot === undefined) return null;
    colours[slot] = s.c;
  }
  const corners = solve2(toNet(2, stickers));
  if (!corners.ok) return null;
  let state = colours;
  for (const tok of corners.moves) {
    const d = t.perm.get(tok)!;
    const next = state.slice();
    state.forEach((c, i) => (next[d[i]!] = c));
    state = next;
  }
  // each wedge belongs on the face its corner stickers now show
  const faceColour = new Map(t.places.flatMap((s, i) => (s.w ? [] : [[s.n.join(), state[i]!] as const])));
  const codes = new Map<string, number>();
  const code = (c: string) => codes.get(c) ?? (codes.set(c, codes.size), codes.size - 1);
  const target = Uint8Array.from(t.wedgeSlots.map((slot) => code(faceColour.get(t.places[slot]!.n.join())!)));
  const start = Uint8Array.from(t.wedgeSlots.map((slot) => code(state[slot]!)));
  const off = (s: Uint8Array) => s.reduce((a, c, i) => a + (c === target[i] ? 0 : 1), 0);

  type Node = { s: Uint8Array; path: string[]; h: number };
  let front: Node[] = [{ s: start, path: [], h: off(start) }];
  let found: string[] | null = front[0]!.h === 0 ? [] : null;
  for (let depth = 0; depth < 80 && !found; depth++) {
    const next = new Map<string, Node>();
    for (const n of front) {
      for (const m of t.macros) {
        const s = new Uint8Array(n.s.length);
        for (let i = 0; i < s.length; i++) s[m.dest[i]!] = n.s[i]!;
        const key = String.fromCharCode(...s);
        if (next.has(key)) continue;
        const node = { s, path: [...n.path, ...m.tokens], h: off(s) };
        next.set(key, node);
        if (node.h === 0) {
          found = node.path;
          break;
        }
      }
      if (found) break;
    }
    front = [...next.values()].sort((a, b) => a.h - b.h || a.path.length - b.path.length).slice(0, beam);
  }
  if (!found) return null;
  const all = simplify([...corners.moves, ...found], wedges);
  // checked on the stickers themselves, so a slip in the tables can never hand back a wrong solution
  return isSolved(applyAlgorithm(stickers, all.map((tok) => move(tok, wedges)))) ? all : null;
}
