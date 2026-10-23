/**
 * Wing orbits on any cube size. A slot (one of the 12 edges) holds, on an N×N cube, the wing
 * pairs at inner offsets ±k (k = 1, 3, … for even N; 2, 4, … for odd N) and, on odd cubes, a
 * midge at offset 0. Each orbit of 24 wings behaves exactly like the 4×4's wings, moved by the
 * slice at its own depth, so the 4×4 pairing machinery and its macro library carry over with
 * the slice depth renamed.
 */
import type { Color, Face } from "../api.js";
import { FACE_AXES, FACE_ORDER, applyAlgorithm, fromNet, parseAlgorithm, parseMove, rotateVec, type Move, type Sticker, type Vec } from "../cubeState.js";
import { OUTER_MOVES, centresSolved } from "./centres.js";
import { MACROS } from "./cube4macros.js";

interface Cycle {
  tokens: string[];
  perm: Uint8Array;
  /** How the macro's outer moves alone move the orbit: what happens to the reference pieces. */
  refPerm: Uint8Array;
}

export interface WingPos {
  p: Vec;
  faces: [Vec, Vec];
  slot: number;
  sub: 0 | 1;
}

const key = (p: Vec) => p.join(",");
const faceOfNormal = (n: Vec): Face => FACE_ORDER.find((f) => FACE_AXES[f].n.every((v, i) => v === n[i]))!;

/** Slot index of an edge position: by the two ±m coordinates. */
function slotOf(p: Vec, m: number, slots: Map<string, number>): number {
  const k = p.map((v) => (Math.abs(v) === m ? v : 0)).join(",");
  if (!slots.has(k)) slots.set(k, slots.size);
  return slots.get(k)!;
}

export class WingOrbit {
  readonly positions: WingPos[];
  readonly partner: number[];
  readonly slots: [number, number][];
  /** Slice depth whose quarter turn moves this orbit (2 = next to the face). */
  readonly depth: number;
  private posIndex: Map<string, number>;
  private permCache = new Map<string, Uint8Array>();
  private orient: Vec[][];
  private macroPerms: { tokens: string[]; perm: Uint8Array }[] | null = null;

  constructor(readonly size: number, readonly k: number) {
    const m = size - 1;
    this.depth = (m - k) / 2 + 1;
    const slots = new Map<string, number>();
    const out: WingPos[] = [];
    const vals = [-m, m];
    for (const x of [-m, -k, k, m]) for (const y of [-m, -k, k, m]) for (const z of [-m, -k, k, m]) {
      const p: Vec = [x, y, z];
      const big = p.filter((v) => Math.abs(v) === m).length;
      const inner = p.filter((v) => Math.abs(v) === k).length;
      if (big !== 2 || inner !== 1) continue;
      const faces = ([0, 1, 2] as const).filter((i) => Math.abs(p[i]) === m).map((i) => {
        const n: Vec = [0, 0, 0];
        n[i] = Math.sign(p[i]);
        return n;
      }) as [Vec, Vec];
      void vals;
      out.push({ p, faces, slot: slotOf(p, m, slots), sub: p.find((v) => Math.abs(v) === k)! < 0 ? 0 : 1 });
    }
    this.positions = out;
    this.posIndex = new Map(out.map((w, i) => [key(w.p), i]));
    this.partner = out.map((w, i) => out.findIndex((o, j) => j !== i && o.slot === w.slot));
    this.slots = Array.from({ length: 12 }, (_, s) => [out.findIndex((w) => w.slot === s && w.sub === 0), out.findIndex((w) => w.slot === s && w.sub === 1)]);
    // orientation table by BFS of a single wing through every move
    const all = [...OUTER_MOVES];
    for (let d = 2; d <= Math.floor(size / 2) + (size % 2); d++) all.push(...OUTER_MOVES.map((t) => `${d}${t}`));
    const moves = all.map((t) => parseMove(t, size));
    this.orient = out.map((home) => {
      const table: Vec[] = new Array(24);
      const seen = new Set<string>();
      const q = [{ p: home.p, n0: home.faces[0] }];
      seen.add(key(home.p) + "|" + key(home.faces[0]));
      table[this.posIndex.get(key(home.p))!] = home.faces[0];
      while (q.length) {
        const cur = q.shift()!;
        for (const mv of moves) {
          if (!mv.layers.includes(cur.p[mv.axis])) continue;
          const p = rotateVec(cur.p, mv.axis, mv.angle).map(Math.round) as Vec;
          const n0 = rotateVec(cur.n0, mv.axis, mv.angle).map(Math.round) as Vec;
          const kk = key(p) + "|" + key(n0);
          if (seen.has(kk)) continue;
          seen.add(kk);
          const idx = this.posIndex.get(key(p))!;
          if (table[idx] && key(table[idx]!) !== key(n0)) throw new Error("wing orientation is not unique");
          table[idx] = n0;
          q.push({ p, n0 });
        }
      }
      if (seen.size !== 24) throw new Error(`wing reaches ${seen.size} states`);
      return table;
    });
  }

  mate(pos: number): number {
    const w = this.positions[pos]!;
    return w.sub === 0 ? this.slots[w.slot]![1] : this.slots[w.slot]![0];
  }

  perm(token: string): Uint8Array {
    let perm = this.permCache.get(token);
    if (perm) return perm;
    const mv: Move = parseMove(token, this.size);
    perm = new Uint8Array(24);
    this.positions.forEach((w, i) => {
      const moved = mv.layers.includes(w.p[mv.axis]) ? (rotateVec(w.p, mv.axis, mv.angle).map(Math.round) as Vec) : w.p;
      perm![i] = this.posIndex.get(key(moved))!;
    });
    this.permCache.set(token, perm);
    return perm;
  }

  sequencePerm(tokens: string[]): Uint8Array {
    let perm = new Uint8Array(24).map((_, i) => i);
    for (const t of tokens) {
      const m = this.perm(t);
      const next = new Uint8Array(24);
      for (let i = 0; i < 24; i++) next[i] = m[perm[i]!]!;
      perm = next;
    }
    return perm;
  }

  applyPerm(arr: Uint8Array, perm: Uint8Array): Uint8Array {
    const out = new Uint8Array(24);
    for (let i = 0; i < 24; i++) out[perm[i]!] = arr[i]!;
    return out;
  }

  pairedCount(arr: Uint8Array): number {
    let n = 0;
    for (const [a, b] of this.slots) if (this.partner[arr[a]!] === arr[b]) n++;
    return n;
  }

  /** Wing id of a piece that shows c0 on faces[0] and c1 on faces[1] of position P, or -1 if no wing can. */
  identify(P: number, c0: Color, c1: Color, colorOfFace: Record<Face, Color>): number {
    const pos = this.positions[P]!;
    return this.positions.findIndex((w, i) => {
      const h0 = colorOfFace[faceOfNormal(w.faces[0])];
      const h1 = colorOfFace[faceOfNormal(w.faces[1])];
      if (!((h0 === c0 && h1 === c1) || (h0 === c1 && h1 === c0))) return false;
      const n0 = this.orient[i]![P]!;
      const colourOnN0 = key(n0) === key(pos.faces[0]) ? c0 : c1;
      return colourOnN0 === h0 && h0 !== h1;
    });
  }

  /** Identify the wing at every position from sticker colours; positions with no matching wing are listed. */
  read(stickers: Sticker[], colorOfFace: Record<Face, Color>): { arr: Uint8Array; badPositions: number[] } {
    const colorAt = new Map<string, Color>();
    for (const s of stickers) colorAt.set(key(s.p) + "|" + key(s.n), s.c);
    const arr = new Uint8Array(24).fill(255);
    const badPositions: number[] = [];
    this.positions.forEach((pos, P) => {
      const c0 = colorAt.get(key(pos.p) + "|" + key(pos.faces[0]))!;
      const c1 = colorAt.get(key(pos.p) + "|" + key(pos.faces[1]))!;
      const match = this.identify(P, c0, c1, colorOfFace);
      if (match < 0) badPositions.push(P);
      else arr[P] = match;
    });
    return { arr, badPositions };
  }

  /**
   * The wing that belongs at every position when the slot's colours are given by a reference piece
   * (the midge on odd cubes, the outermost wing pair on even ones): `refColour(slot key, normal)`.
   * Positions whose reference colours match no wing get 255.
   */
  target(refColour: (slotKey: string, normal: Vec) => Color, colorOfFace: Record<Face, Color>): Uint8Array {
    const m = this.size - 1;
    const out = new Uint8Array(24).fill(255);
    this.positions.forEach((pos, P) => {
      const sk = slotKey(pos.p, m);
      const w = this.identify(P, refColour(sk, pos.faces[0]), refColour(sk, pos.faces[1]), colorOfFace);
      if (w >= 0) out[P] = w;
    });
    return out;
  }

  /**
   * The 4×4 macro library with its slice depth renamed to this orbit's, filtered to those that
   * are 3-cycles here and leave every centre sticker on its face (checked on this cube size).
   */
  private macros(): { tokens: string[]; perm: Uint8Array }[] {
    if (this.macroPerms) return this.macroPerms;
    const rename = (t: string) => t.replace(/^2([URFDLB])/, `${this.depth}$1`);
    const colors: Record<Face, Color> = { U: "W", R: "R", F: "G", D: "Y", L: "O", B: "B" };
    const solved = fromNet(this.size, Object.fromEntries(FACE_ORDER.map((f) => [f, Array.from({ length: this.size }, () => colors[f].repeat(this.size))])) as Record<Face, string[]>);
    const out: { tokens: string[]; perm: Uint8Array }[] = [];
    for (const m of MACROS) {
      const tokens = m.map(rename);
      const perm = this.sequencePerm(tokens);
      let moved = 0;
      for (let i = 0; i < 24; i++) if (perm[i] !== i) moved++;
      if (moved !== 3) continue;
      if (!centresSolved(applyAlgorithm(solved, parseAlgorithm(tokens.join(" "), this.size)), this.size)) continue;
      out.push({ tokens, perm });
    }
    this.macroPerms = out;
    return out;
  }

  private search: { setups: { tokens: string[]; perm: Uint8Array }[]; byPair: Cycle[][] } | null = null;

  /** Outer setups of up to three moves and the 3-cycle macros, each with how its outer moves alone move the orbit. */
  private prepareSearch() {
    if (this.search) return this.search;
    const faceOf = (t: string) => t.replace(/[2']/g, "");
    const setups: { tokens: string[]; perm: Uint8Array }[] = [{ tokens: [], perm: this.sequencePerm([]) }];
    const rec = (seq: string[]) => {
      if (seq.length === 3) return;
      for (const m of OUTER_MOVES) {
        if (seq.length && faceOf(seq[seq.length - 1]!) === faceOf(m)) continue;
        const tokens = [...seq, m];
        setups.push({ tokens, perm: this.sequencePerm(tokens) });
        rec(tokens);
      }
    };
    rec([]);
    const isOuter = (t: string) => /^[URFDLB]['2]?$/.test(t);
    // every 3-cycle, indexed by each (from → to) pair it contains
    const byPair: Cycle[][] = Array.from({ length: 24 * 24 }, () => []);
    for (const { tokens, perm } of this.macros()) {
      const cyc: Cycle = { tokens, perm, refPerm: this.sequencePerm(tokens.filter(isOuter)) };
      for (let q = 0; q < 24; q++) if (perm[q] !== q) byPair[q * 24 + perm[q]!]!.push(cyc);
    }
    this.search = { setups, byPair };
    return this.search;
  }

  /** Moves that leave every slot holding partners (same greedy as the 4×4: outer setup + a wing 3-cycle). */
  pair(arr: Uint8Array): string[] {
    const { setups, byPair } = this.prepareSearch();
    const out: string[] = [];
    let cur = arr;
    for (let guard = 0; this.pairedCount(cur) < 12; guard++) {
      if (guard > 24) throw new Error("edge pairing did not converge");
      const paired = this.pairedCount(cur);
      let best: { tokens: string[]; next: Uint8Array } | null = null;
      for (const [a, aMate] of this.slots) {
        for (const [pA, pAp] of [[a, aMate], [aMate, a]] as [number, number][]) {
          const A = cur[pA]!;
          if (this.partner[A] === cur[pAp]) continue;
          const pB = cur.indexOf(this.partner[A]!);
          for (const s of setups) {
            if (best && s.tokens.length + 7 >= best.tokens.length) continue;
            const q1 = s.perm[pB]!;
            const q2 = s.perm[pAp]!;
            for (const cyc of byPair[q1 * 24 + q2]!) {
              const total = s.tokens.length + cyc.tokens.length;
              if (best && total >= best.tokens.length) continue;
              const afterSetup = this.applyPerm(cur, s.perm);
              const q3 = cyc.perm[q2]!;
              if (this.partner[afterSetup[q3]!] === afterSetup[this.mate(q3)]) continue;
              const next = this.applyPerm(afterSetup, cyc.perm);
              if (this.pairedCount(next) <= paired) continue;
              best = { tokens: [...s.tokens, ...cyc.tokens], next };
            }
          }
        }
      }
      if (!best) throw new Error(`no pairing step found with ${paired} paired`);
      out.push(...best.tokens);
      cur = best.next;
    }
    return out;
  }

  /**
   * Moves that put the wing `target[P]` at every position P, where the target follows a reference
   * (midges or the outer orbit) that outer moves carry along. An odd permutation first gets the pure
   * UF wing swap; then outer setups + 3-cycles place wings greedily, the cheapest gain per move first.
   */
  pairTo(arr: Uint8Array, target: Uint8Array): string[] {
    const { setups, byPair } = this.prepareSearch();
    const out: string[] = [];
    let cur = arr;
    let tgt = target;
    const solvedCount = (a: Uint8Array, t: Uint8Array) => {
      let n = 0;
      for (let i = 0; i < 24; i++) if (a[i] === t[i]) n++;
      return n;
    };
    if (this.parityOdd(cur, tgt)) {
      const flip = flipUF(this.depth);
      out.push(...flip);
      cur = this.applyPerm(cur, this.sequencePerm(flip));
    }
    for (let guard = 0; solvedCount(cur, tgt) < 24; guard++) {
      if (guard > 30) throw new Error("wing placement did not converge");
      const solved = solvedCount(cur, tgt);
      let best: { tokens: string[]; next: Uint8Array; nextTarget: Uint8Array; cost: number } | null = null;
      for (let P = 0; P < 24; P++) {
        if (cur[P] === tgt[P]) continue;
        const pB = cur.indexOf(tgt[P]!);
        for (const s of setups) {
          if (best && s.tokens.length / 3 >= best.cost) continue; // no cycle after this setup can beat the best
          const q1 = s.perm[pB]!;
          const q2 = s.perm[P]!;
          let afterSetup: Uint8Array | null = null;
          let targetAfter: Uint8Array | null = null;
          for (const cyc of byPair[q1 * 24 + q2]!) {
            const total = s.tokens.length + cyc.tokens.length;
            if (best && total / 3 >= best.cost) continue; // even a gain of three cannot beat the best
            afterSetup ??= this.applyPerm(cur, s.perm);
            targetAfter ??= this.applyPerm(tgt, s.perm);
            const next = this.applyPerm(afterSetup, cyc.perm);
            const nextTarget = this.applyPerm(targetAfter, cyc.refPerm);
            const gain = solvedCount(next, nextTarget) - solved;
            if (gain <= 0) continue;
            const cost = total / gain;
            if (best && cost >= best.cost) continue;
            best = { tokens: [...s.tokens, ...cyc.tokens], next, nextTarget, cost };
          }
        }
      }
      if (!best) throw new Error(`no placement step found with ${solved} placed`);
      out.push(...best.tokens);
      cur = best.next;
      tgt = best.nextTarget;
    }
    return out;
  }

  /** Is the permutation taking the current wings to their targets odd? */
  private parityOdd(cur: Uint8Array, target: Uint8Array): boolean {
    const where = new Array<number>(24);
    for (let P = 0; P < 24; P++) where[target[P]!] = P;
    const seen = new Array<boolean>(24).fill(false);
    let odd = false;
    for (let P = 0; P < 24; P++) {
      if (seen[P]) continue;
      let len = 0;
      for (let q = P; !seen[q]; q = where[cur[q]!]!) {
        seen[q] = true;
        len++;
      }
      if (len % 2 === 0) odd = !odd;
    }
    return odd;
  }
}

/** The slot of an edge position, named by its two ±m coordinates (shared by every orbit and the midges). */
export function slotKey(p: Vec, m: number): string {
  return p.map((v) => (Math.abs(v) === m ? v : 0)).join(",");
}

const orbitCache = new Map<number, WingOrbit[]>();

/** All wing orbits of a size, outermost first (cached: each carries its orientation and macro tables). */
export function wingOrbits(size: number): WingOrbit[] {
  let orbits = orbitCache.get(size);
  if (!orbits) {
    const m = size - 1;
    const ks: number[] = [];
    for (let k = m - 2; k >= 1; k -= 2) ks.push(k);
    orbits = ks.map((k) => new WingOrbit(size, k));
    orbitCache.set(size, orbits);
  }
  return orbits;
}

/** Pure flip of the two wings of the UF slot in the orbit at this slice depth (verified by test). */
export function flipUF(depth: number): string[] {
  return `${depth}R2 B2 U2 ${depth}L U2 ${depth}R' U2 ${depth}R U2 F2 ${depth}R F2 ${depth}L' B2 ${depth}R2`.split(" ");
}
