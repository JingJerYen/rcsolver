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
  /** `moved`: the wedge places a macro changes, so a step only looks at those. */
  macros: { tokens: string[]; dest: Int16Array; moved: Int16Array }[];
  /** Random keys per wedge place and colour, so a state's hash changes only where a macro moves wedges. */
  zobrist: [Int32Array, Int32Array];
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
    return { tokens, dest, moved: Int16Array.from([...dest.keys()].filter((i) => dest[i] !== i)) };
  });
  let seed = 12345;
  const rand = () => (seed = (Math.imul(seed, 1103515245) + 12345) | 0);
  const zobrist: [Int32Array, Int32Array] = [Int32Array.from({ length: wedgeSlots.length * 8 }, rand), Int32Array.from({ length: wedgeSlots.length * 8 }, rand)];
  return { places, slotOf, perm, wedgeSlots, macros, zobrist };
}

interface Node {
  s: Uint8Array;
  /** Wedges on the wrong face. */
  h: number;
  /** Moves so far. */
  len: number;
  /** Two 32-bit hashes of `s`. */
  z1: number;
  z2: number;
  parent: Node | null;
  macro: number;
}

/**
 * Wedges home with the corner-keeping macros: each round expands every state kept, scoring a step
 * from the few wedges its macro moves (no copying) and keeping the `beam` states with the fewest
 * wedges astray (fewer moves first among equals), never one seen before.
 */
function beamSearch(t: Tables, start: Uint8Array, target: Uint8Array, beam: number): string[] | null {
  const [Z1, Z2] = t.zobrist;
  const n = start.length;
  let z1 = 0, z2 = 0, h = 0;
  for (let i = 0; i < n; i++) {
    z1 ^= Z1[i * 8 + start[i]!]!;
    z2 ^= Z2[i * 8 + start[i]!]!;
    if (start[i] !== target[i]) h++;
  }
  const seen = new Set<number>();
  const keyOf = (a: number, b: number) => (a >>> 0) * 2097152 + ((b >>> 0) & 0x1fffff);
  let front: Node[] = [{ s: start, h, len: 0, z1, z2, parent: null, macro: -1 }];
  seen.add(keyOf(z1, z2));
  let done: Node | null = h === 0 ? front[0]! : null;
  for (let depth = 0; depth < 120 && !done && front.length; depth++) {
    // candidates by how many wedges they leave astray
    const buckets: { parent: Node; macro: number; h: number; len: number; z1: number; z2: number }[][] = Array.from({ length: n + 1 }, () => []);
    for (const node of front) {
      const s = node.s;
      t.macros.forEach((m, k) => {
        let a = node.z1, b = node.z2, hh = node.h;
        for (const i of m.moved) {
          const j = m.dest[i]!;
          a ^= Z1[j * 8 + s[j]!]! ^ Z1[j * 8 + s[i]!]!;
          b ^= Z2[j * 8 + s[j]!]! ^ Z2[j * 8 + s[i]!]!;
          hh += (s[i] !== target[j] ? 1 : 0) - (s[j] !== target[j] ? 1 : 0);
        }
        const key = keyOf(a, b);
        if (seen.has(key)) return;
        seen.add(key);
        buckets[hh]!.push({ parent: node, macro: k, h: hh, len: node.len + m.tokens.length, z1: a, z2: b });
      });
    }
    const kept: Node[] = [];
    for (const bucket of buckets) {
      if (kept.length >= beam) break;
      bucket.sort((x, y) => x.len - y.len);
      for (const c of bucket.slice(0, beam - kept.length)) {
        const m = t.macros[c.macro]!;
        const s = c.parent.s.slice();
        for (const i of m.moved) s[m.dest[i]!] = c.parent.s[i]!;
        kept.push({ s, h: c.h, len: c.len, z1: c.z1, z2: c.z2, parent: c.parent, macro: c.macro });
      }
    }
    front = kept;
    if (front[0]?.h === 0) done = front[0];
  }
  if (!done) return null;
  const path: string[][] = [];
  for (let node: Node | null = done; node?.parent; node = node.parent) path.push(t.macros[node.macro]!.tokens);
  return path.reverse().flat();
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
 * the stickers are not one. About 35 moves for four wedges a wheel (a few hundredths of a second),
 * about 55 for eight (a few tenths); `beam` trades time for length.
 */
export function solveWheel(stickers: Sticker[], wedges: number, beam = wedges <= 4 ? 100 : 60): string[] | null {
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
  const found = beamSearch(t, start, target, beam);
  if (!found) return null;
  const all = simplify([...corners.moves, ...found], wedges);
  // checked on the stickers themselves, so a slip in the tables can never hand back a wrong solution
  return isSolved(applyAlgorithm(stickers, all.map((tok) => move(tok, wedges)))) ? all : null;
}
