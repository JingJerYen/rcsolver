/**
 * The study mode's hint: which step of the beginner's method the cube on screen is at, and the
 * pieces still to do there. It reads the stickers alone, with the cube held any way: the colour
 * each face should end up comes from the cube itself (its centres; on an even cube, the corners
 * and whichever way round the centres mostly sit). The 2×2 and 3×3 follow the learning mode's
 * lessons; bigger cubes go centres, then edges, then the 3×3 steps on the cube they reduce to.
 */
import type { Color, Face } from "./api.js";
import { FACE_AXES, FACE_ORDER, applyMove, layerValues, parseMove, rotateVec, type Sticker, type Vec } from "./cubeState.js";
import { LESSONS } from "./learn.js";
import { tr } from "./i18n.js";

export interface StudyHint {
  title: string;
  body: string;
  /** Sticker keys ("x,y,z|nx,ny,nz") on the cube as given: the pieces this step still needs. */
  rings: Set<string>;
  /** The learning mode's lesson for this step (2×2 and 3×3 only). */
  lesson: { size: 2 | 3; index: number } | null;
}

type Scheme = Record<Face, Color>;

const faceOf = (n: Vec): Face => FACE_ORDER.find((f) => FACE_AXES[f].n.every((v, i) => v === n[i]))!;
const keyOf = (s: Sticker) => `${s.p.join(",")}|${s.n.join(",")}`;
/** How many coordinates of a cubie are on the outside: 3 corner, 2 edge, 1 centre. */
const outer = (p: Vec, h: number) => p.filter((v) => Math.abs(v) === h).length;

// the 24 ways to hold a cube: which face goes on top, then a turn about the vertical
const ROTATIONS = ["", "x", "x2", "x'", "z", "z'"].flatMap((a) => ["", "y", "y2", "y'"].map((b) => [a, b].filter(Boolean)));

/** Whole-cube turns keep every sticker at its index, so an index names the same sticker before and after. */
function turnCube(cube: Sticker[], tokens: string[], size: number): Sticker[] {
  return tokens.reduce((s, t) => applyMove(s, parseMove(t, size)), cube);
}

/** The colours the faces should be, after the same whole-cube turns. */
function turnScheme(scheme: Scheme, tokens: string[], size: number): Scheme {
  let out = scheme;
  for (const t of tokens) {
    const mv = parseMove(t, size);
    const next = {} as Scheme;
    for (const f of FACE_ORDER) next[faceOf(rotateVec(FACE_AXES[f].n, mv.axis, mv.angle).map(Math.round) as Vec)] = out[f];
    out = next;
  }
  return out;
}

/** The stickers of each cubie, by index. */
function pieces(cube: Sticker[]): number[][] {
  const by = new Map<string, number[]>();
  cube.forEach((s, i) => by.set(s.p.join(","), [...(by.get(s.p.join(",")) ?? []), i]));
  return [...by.values()];
}

const done = (cube: Sticker[], scheme: Scheme, piece: number[]) => piece.every((i) => cube[i]!.c === scheme[faceOf(cube[i]!.n)]);

/**
 * What each face should be. Odd cubes: the middle centres. Even cubes: one corner fixes the
 * colours round it, never sharing a corner fixes the opposite ones, and of the 24 ways to hold
 * that the one most centre stickers agree with (on a 2×2, the most white corners done).
 */
function schemeOf(size: number, cube: Sticker[]): Scheme | null {
  const h = size - 1;
  if (size % 2 === 1) {
    const s = {} as Scheme;
    for (const f of FACE_ORDER) {
      const n = FACE_AXES[f].n;
      s[f] = cube.find((st) => st.n.every((v, i) => v === n[i]) && st.p.every((v, i) => v === n[i] * h))!.c;
    }
    return new Set(Object.values(s)).size === 6 ? s : null;
  }
  const corners = pieces(cube).filter((pc) => pc.length === 3);
  const together = new Map<Color, Set<Color>>();
  for (const pc of corners) for (const i of pc) for (const j of pc) if (i !== j) together.set(cube[i]!.c, (together.get(cube[i]!.c) ?? new Set()).add(cube[j]!.c));
  const colours = [...together.keys()];
  const opposite = (c: Color) => colours.find((o) => o !== c && !together.get(c)!.has(o));
  const ufr = cube.filter((st) => st.p.every((v) => v === h));
  const at = (n: Vec) => ufr.find((st) => st.n.every((v, i) => v === n[i]))?.c;
  const R = at([1, 0, 0]), U = at([0, 1, 0]), F = at([0, 0, 1]);
  if (!R || !U || !F) return null;
  const L = opposite(R), D = opposite(U), B = opposite(F);
  if (!L || !D || !B) return null;
  const base: Scheme = { U, R, F, D, L, B };
  let best: Scheme = base;
  let bestScore = -1;
  for (const r of ROTATIONS) {
    const s = turnScheme(base, r, size);
    const score =
      size === 2
        ? corners.filter((pc) => done(cube, s, pc)).reduce((n, pc) => n + (pc.some((i) => cube[i]!.c === "W") ? 10 : 1), 0)
        : cube.filter((st) => outer(st.p, h) === 1 && st.c === s[faceOf(st.n)]).length;
    if (score > bestScore) {
      best = s;
      bestScore = score;
    }
  }
  return best;
}

/** Permutation parity (true = odd) of the pieces in `list`, each sent to where its colours belong. */
function oddPermutation(cube: Sticker[], scheme: Scheme, list: number[][]): boolean {
  const home = (pc: number[]) => pc.map((i) => cube[i]!.c).sort().join("");
  const slot = (pc: number[]) => pc.map((i) => scheme[faceOf(cube[i]!.n)]).sort().join("");
  const at = new Map(list.map((pc) => [slot(pc), home(pc)]));
  const seen = new Set<string>();
  let odd = false;
  for (const start of at.keys()) {
    if (seen.has(start)) continue;
    let len = 0;
    for (let k: string | undefined = start; k !== undefined && !seen.has(k); k = at.get(k)) {
      seen.add(k);
      len++;
    }
    if (len % 2 === 0) odd = !odd;
  }
  return odd;
}

/** A step of the 2×2 / 3×3 method: its lesson, what to say, the stickers to ring (indices). */
type Step = { lesson: number; body: string; rings: number[] } | { solved: true };

/**
 * The beginner's method on a 2×2 or 3×3 (or the 3×3 a big cube reduces to), held any way.
 * `even`: the cube came from an even big cube, so a lone flipped edge or two swapped edges can
 * happen (parity) and needs saying.
 */
function smallStep(size: 2 | 3, cube: Sticker[], scheme: Scheme, even: boolean): Step {
  const three = size === 3;
  // white on top for the first layer
  const toWhite = ROTATIONS.find((r) => turnScheme(scheme, r, size).U === "W") ?? [];
  const up = turnCube(cube, toWhite, size);
  const T = turnScheme(scheme, toWhite, size);
  const all = pieces(up);
  const corners = all.filter((pc) => pc.length === 3);
  const edges = all.filter((pc) => pc.length === 2);
  const has = (pc: number[], c: Color) => pc.some((i) => up[i]!.c === c);
  const stickerOf = (pc: number[], c: Color) => pc.filter((i) => up[i]!.c === c);
  // English has a singular: "1 white edge to go: it is ringed."
  const count = (n: number, zh: string, one: string, many: string) => tr(zh, n === 1 ? one : many).replace("N", String(n));

  if (three) {
    const todo = edges.filter((pc) => has(pc, T.U) && !done(up, T, pc));
    if (todo.length) return { lesson: 1, body: count(todo.length, "還差 N 個白色的邊，圈起來的就是。", "1 white edge to go: it is ringed.", "N white edges to go: they are ringed."), rings: todo.flatMap((pc) => stickerOf(pc, T.U)) };
  }
  const whiteCorners = corners.filter((pc) => has(pc, T.U) && !done(up, T, pc));
  if (whiteCorners.length)
    return {
      lesson: three ? 2 : 1,
      body: count(whiteCorners.length, "還差 N 個白色的角，圈起來的就是。", "1 white corner to go: it is ringed.", "N white corners to go: they are ringed."),
      rings: whiteCorners.flatMap((pc) => stickerOf(pc, T.U)),
    };

  // turned over, white down, for the rest
  const down = turnCube(up, ["x2"], size);
  const Td = turnScheme(T, ["x2"], size);
  const Y = Td.U;
  const top = (pc: number[]) => pc.some((i) => down[i]!.p[1] === size - 1);
  const facesUp = (pc: number[]) => pc.some((i) => down[i]!.c === Y && down[i]!.n[1] === 1);

  if (three) {
    const middle = edges.filter((pc) => !has(pc, T.U) && !has(pc, Y) && !done(down, Td, pc));
    if (middle.length) return { lesson: 3, body: count(middle.length, "中層還差 N 個邊，圈起來的就是。", "1 middle edge to go: it is ringed.", "N middle edges to go: they are ringed."), rings: middle.flat() };
    const topEdges = edges.filter(top);
    const upEdges = topEdges.filter(facesUp);
    if (upEdges.length < 4) {
      const where = upEdges.map((pc) => down[pc[0]!]!.p);
      const body =
        upEdges.length % 2 === 1
          ? tr("頂面有一條邊翻反了：這是偶數方塊特有的情況，要用專用公式。", "One top edge is flipped on its own: this only happens on even cubes and takes a special sequence.")
          : upEdges.length === 0
            ? tr("頂面的黃色只有中心一點。", "The top shows just the yellow centre: a dot.")
            : where[0]![0] === -where[1]![0] && where[0]![2] === -where[1]![2]
              ? tr("頂面的黃色是一條線，圈起來的就是。", "The yellow on top is a line: it is ringed.")
              : tr("頂面的黃色是 L 形，圈起來的就是。", "The yellow on top is an L: it is ringed.");
      return { lesson: 4, body, rings: upEdges.flatMap((pc) => pc.filter((i) => down[i]!.n[1] === 1)) };
    }
  }
  const notUp = corners.filter((pc) => top(pc) && !facesUp(pc));
  if (notUp.length)
    return {
      lesson: three ? 5 : 2,
      body: count(notUp.length, "還有 N 個角的黃色沒朝上，圈起來的就是。", "1 corner still has its yellow off the top: it is ringed.", "N corners still have their yellow off the top: they are ringed."),
      rings: notUp.flatMap((pc) => pc.filter((i) => down[i]!.c === Y)),
    };

  // the top layer in place: corners first (with the best turn of the top), then edges
  if (even && oddPermutation(down, Td, corners) !== oddPermutation(down, Td, edges))
    return {
      lesson: 6,
      body: tr("頂層有兩個邊要互換：這是偶數方塊特有的情況，要用專用公式。", "Two top edges need swapping on their own: this only happens on even cubes and takes a special sequence."),
      rings: edges.filter((pc) => top(pc) && !done(down, Td, pc)).flat(),
    };
  const placed = (s: Sticker[], pc: number[]) => pc.map((i) => s[i]!.c).sort().join("") === pc.map((i) => Td[faceOf(s[i]!.n)]).sort().join("");
  let best = { k: 0, s: down, n: -1 };
  for (let k = 0, s = down; k < 4; k++, s = turnCube(s, ["U"], size)) {
    const n = corners.filter((pc) => top(pc) && placed(s, pc)).length;
    if (n > best.n) best = { k, s, n };
  }
  const misplaced = corners.filter((pc) => top(pc) && !placed(best.s, pc));
  if (misplaced.length)
    return {
      lesson: three ? 6 : 3,
      body: count(misplaced.length, "頂層還有 N 個角不在對的位置，圈起來的就是。", "1 top corner is not in its place: it is ringed.", "N top corners are not in their places: they are ringed."),
      rings: misplaced.flat(),
    };
  const edgesLeft = edges.filter((pc) => top(pc) && !done(best.s, Td, pc));
  if (edgesLeft.length)
    return { lesson: 7, body: count(edgesLeft.length, "頂層還差 N 個邊，圈起來的就是。", "1 top edge to go: it is ringed.", "N top edges to go: they are ringed."), rings: edgesLeft.flat() };
  if (best.k) return { lesson: three ? 7 : 3, body: tr("只差把上層轉到對的位置。", "Just turn the top layer into place."), rings: [] };
  return { solved: true };
}

const SOLVED: StudyHint = { title: tr("完成", "Solved"), body: tr("方塊已經解好了。", "The cube is solved."), rings: new Set(), lesson: null };

/** The hint for a study cube of any size, or null when the colours make no sense as a cube. */
export function studyHint(size: number, cube: Sticker[]): StudyHint | null {
  const scheme = schemeOf(size, cube);
  if (!scheme) return null;
  if (size <= 3) {
    const s = smallStep(size as 2 | 3, cube, scheme, false);
    if ("solved" in s) return SOLVED;
    const title = LESSONS[size as 2 | 3][s.lesson]!.title;
    return {
      title: tr(`第 ${s.lesson} 步・${title}`, `Step ${s.lesson} · ${title}`),
      body: s.body,
      rings: new Set(s.rings.map((i) => keyOf(cube[i]!))),
      lesson: { size: size as 2 | 3, index: s.lesson },
    };
  }

  const h = size - 1;
  // 1. centres: every face's inner stickers its colour
  const centres = cube.map((st, i) => ({ st, i })).filter(({ st }) => outer(st.p, h) === 1);
  const wrongCentres = centres.filter(({ st }) => st.c !== scheme[faceOf(st.n)]);
  if (wrongCentres.length) {
    const faces = new Set(wrongCentres.map(({ st }) => faceOf(st.n))).size;
    return {
      title: tr("第 1 步・中心", "Step 1 · Centres"),
      body: tr(`還差 ${faces} 面的中心，圈起來的是放錯面的中心格。`, `${faces} face${faces === 1 ? "" : "s"} of centres to go: the centre pieces on the wrong face are ringed.`),
      rings: new Set(wrongCentres.map(({ st }) => keyOf(st))),
      lesson: null,
    };
  }

  // 2. edges: each edge's pieces paired, one colour along each of its two faces
  const groups = new Map<string, number[]>();
  cube.forEach((st, i) => {
    if (outer(st.p, h) !== 2) return;
    const k = st.p.map((v) => (Math.abs(v) === h ? v : "*")).join(",");
    groups.set(k, [...(groups.get(k) ?? []), i]);
  });
  const unpaired = [...groups.values()].filter((g) => {
    const byFace = new Map<string, Set<Color>>();
    for (const i of g) byFace.set(cube[i]!.n.join(","), (byFace.get(cube[i]!.n.join(",")) ?? new Set()).add(cube[i]!.c));
    return [...byFace.values()].some((cs) => cs.size > 1);
  });
  if (unpaired.length)
    return {
      title: tr("第 2 步・邊塊配對", "Step 2 · Pairing edges"),
      body: tr(`還有 ${unpaired.length} 條邊沒配好，圈起來的就是。`, `${unpaired.length} edge${unpaired.length === 1 ? "" : "s"} still to pair: they are ringed.`),
      rings: new Set(unpaired.flat().map((i) => keyOf(cube[i]!))),
      lesson: null,
    };

  // 3. the 3×3 this reduces to: corners as they are, one piece per edge, centres in their colours
  const inner = layerValues(size)[1]!;
  const small: Sticker[] = [];
  const back: number[][] = [];
  const to3 = (v: number) => (Math.abs(v) === h ? Math.sign(v) * 2 : 0);
  cube.forEach((st, i) => {
    const o = outer(st.p, h);
    if (o === 3) {
      small.push({ p: st.p.map(to3) as Vec, n: st.n, c: st.c });
      back.push([i]);
    } else if (o === 2 && st.p.every((v) => Math.abs(v) === h || v === inner)) {
      const k = st.p.map((v) => (Math.abs(v) === h ? v : "*")).join(",");
      small.push({ p: st.p.map(to3) as Vec, n: st.n, c: st.c });
      back.push(groups.get(k)!.filter((j) => cube[j]!.n.every((v, a) => v === st.n[a])));
    }
  });
  for (const f of FACE_ORDER) {
    const n = FACE_AXES[f].n;
    small.push({ p: n.map((v) => v * 2) as Vec, n: [...n] as Vec, c: scheme[f] });
    back.push(centres.filter(({ st }) => faceOf(st.n) === f).map(({ i }) => i));
  }
  const s = smallStep(3, small, scheme, size % 2 === 0);
  if ("solved" in s) return SOLVED;
  const title = LESSONS[3][s.lesson]!.title;
  return {
    title: tr(`第 3 步・當成 3×3：${title}`, `Step 3 · As a 3×3: ${title}`),
    body: s.body,
    rings: new Set(s.rings.flatMap((i) => back[i]!).map((i) => keyOf(cube[i]!))),
    lesson: null,
  };
}
