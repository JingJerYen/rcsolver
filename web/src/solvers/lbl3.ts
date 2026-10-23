/**
 * Teaching solver for the 3×3: the beginner's layer-by-layer method, one piece at a time, with
 * the few formulas every tutorial uses. Slower than Kociemba (about 150 moves instead of 20) but
 * every stretch of moves comes with what it does and why, for the guide. White goes to the
 * bottom first; all formulas are then done with the yellow face on top.
 */
import type { Color, Face } from "../api.js";
import { FACE_AXES, applyAlgorithm, applyMove, isSolved, parseAlgorithm, parseMove, fromNet, type Move, type Sticker, type Vec } from "../cubeState.js";
import type { Net } from "./scheme.js";
import type { Segment } from "./segments.js";

export type TeachSegment = Extract<Segment, { kind: "lbl" }>;

const SIDES: Face[] = ["F", "R", "B", "L"];
const N = (f: Face): Vec => FACE_AXES[f].n;
const add = (...vs: Vec[]): Vec => [0, 1, 2].map((i) => vs.reduce((a, v) => a + v[i]!, 0)) as Vec;
const mul = (v: Vec, k: number): Vec => [v[0] * k, v[1] * k, v[2] * k];
const keyOf = (p: Vec, n: Vec) => `${p.join(",")}|${n.join(",")}`;
const NAMES: Record<Color, string> = { W: "白", Y: "黃", R: "紅", O: "橘", G: "綠", B: "藍" };
const name = (cs: Color[]) => cs.map((c) => NAMES[c]).join("");
export const sig = (cs: Color[]) => [...cs].sort().join("");

const RIGHT = "R U R' U'";
const INSERT_RIGHT = "U R U' R' U' F' U F";
const INSERT_LEFT = "U' L' U L U F U' F'";
const CROSS_ALG = "F R U R' U' F'";
const SUNE = "R U R' U R U2 R'";
const CORNER_PERM = "R' F R' B2 R F' R' B2 R2"; // A perm: cycles three top corners, keeps the UFR one and every orientation
const EDGE_PERM = "R U' R U R U R U' R' U' R2";
const U_SETUPS = ["", "U", "U2", "U'"];
const Y_ROTS = ["", "y", "y2", "y'"];

class State {
  private map: Map<string, Color>;
  constructor(readonly stickers: Sticker[]) {
    this.map = new Map(stickers.map((s) => [keyOf(s.p, s.n), s.c]));
  }
  at(p: Vec, n: Vec): Color {
    return this.map.get(keyOf(p, n))!;
  }
  centre(f: Face): Color {
    return this.at(mul(N(f), 2), N(f));
  }
  /** Colours of the edge between faces a and b: [on a, on b]. */
  edge(a: Face, b: Face): [Color, Color] {
    const p = mul(add(N(a), N(b)), 2);
    return [this.at(p, N(a)), this.at(p, N(b))];
  }
  corner(a: Face, b: Face, c: Face): [Color, Color, Color] {
    const p = mul(add(N(a), N(b), N(c)), 2);
    return [this.at(p, N(a)), this.at(p, N(b)), this.at(p, N(c))];
  }
  apply(alg: string): State {
    return alg.trim() ? new State(applyAlgorithm(this.stickers, parseAlgorithm(alg, 3))) : this;
  }
}

const EDGE_POS: [Face, Face][] = [["U", "F"], ["U", "R"], ["U", "B"], ["U", "L"], ["D", "F"], ["D", "R"], ["D", "B"], ["D", "L"], ["F", "R"], ["R", "B"], ["B", "L"], ["L", "F"]];
const CORNER_POS: [Face, Face, Face][] = [["U", "F", "R"], ["U", "R", "B"], ["U", "B", "L"], ["U", "L", "F"], ["D", "F", "R"], ["D", "R", "B"], ["D", "B", "L"], ["D", "L", "F"]];
const SLOTS: [Face, Face][] = [["F", "R"], ["R", "B"], ["B", "L"], ["L", "F"]];

function findEdge(s: State, colours: Color[]): [Face, Face] {
  const want = sig(colours);
  return EDGE_POS.find((pos) => sig(s.edge(...pos)) === want)!;
}
function findCorner(s: State, colours: Color[]): [Face, Face, Face] {
  const want = sig(colours);
  return CORNER_POS.find((pos) => sig(s.corner(...pos)) === want)!;
}
const layerName = (pos: Face[]) => (pos.includes("U") ? "頂層" : pos.includes("D") ? "底層" : "中層");

export interface TeachResult {
  moves: string[];
  segments: TeachSegment[];
}

/** Why the last teaching solve gave up (for tests and logs). */
export let lastTeachFailure = "";

export function solveTeach3(net: Net): TeachResult | null {
  lastTeachFailure = "";
  try {
    return teach(net);
  } catch (err) {
    if (err instanceof TeachError) {
      lastTeachFailure = err.message;
      return null;
    }
    throw err;
  }
}

class TeachError extends Error {}
const fail = (where: string): never => {
  throw new TeachError(where);
};

function teach(net: Net): TeachResult {
  let s = new State(fromNet(3, net));
  const moves: string[] = [];
  const segments: TeachSegment[] = [];
  const solved: string[] = []; // signatures of pieces placed so far (for the colour focus)
  const step = (stage: number, alg: string, title: string, body: string, formula?: string, current?: Color[]) => {
    const tokens = alg.split(/\s+/).filter(Boolean);
    if (!tokens.length) return;
    const from = moves.length;
    s = s.apply(alg);
    moves.push(...tokens);
    const pieces = stage <= 2 ? [...solved, ...(current ? [sig(current)] : [])] : null;
    segments.push({ kind: "lbl", from, to: moves.length, stage, title, body, ...(formula ? { alg: formula } : {}), pieces });
  };

  if (isSolved(s.stickers)) return { moves, segments };

  // 0. white centre to the bottom
  const bottomColour: Color = "W";
  if (s.centre("D") !== bottomColour) {
    const rot = ["x", "x'", "x2", "z", "z'"].find((r) => s.apply(r).centre("D") === bottomColour);
    if (!rot) fail("orient");
    step(0, rot ?? "", "先把白色轉到下面", "整顆方塊轉一下，讓白色中心朝下、黃色中心朝上。接下來所有公式都以這個方向做。");
  }
  const bottom = s.centre("D");
  const top = s.centre("U");

  // 1. bottom cross
  const crossOk = (st: State, f: Face) => sig(st.edge("D", f)) === sig([bottom, st.centre(f)]) && st.edge("D", f)[0] === bottom;
  const crossDone: Face[] = [];
  for (const f of SIDES) {
    const colours: Color[] = [bottom, s.centre(f)];
    const ok = (st: State) => crossOk(st, f);
    const keep = (st: State) => crossDone.every((g) => crossOk(st, g));
    if (!ok(s)) {
      const where = layerName(findEdge(s, colours));
      let alg = search(s.stickers, 5, (st) => ok(st) && keep(st));
      if (alg === null) {
        // bring it to the top with white up, then drop it in: always short
        const up = search(s.stickers, 3, (st) => keep(st) && SIDES.some((g) => sig(st.edge("U", g)) === sig(colours) && st.edge("U", g)[0] === bottom)) ?? fail("cross");
        let st = s.apply(up);
        const turn = U_SETUPS.find((u) => sig(st.apply(u).edge("U", f)) === sig(colours))!;
        st = st.apply(turn);
        alg = [up, turn, `${f}2`].filter(Boolean).join(" ");
      }
      step(1, alg, `底層十字：${name(colours)}邊塊`, `${name(colours)}邊塊目前在${where}。把它放到底面、${NAMES[s.centre(f)]}色中心的正下方，白色朝下。`, undefined, colours);
    }
    crossDone.push(f);
    solved.push(sig(colours));
  }
  if (!SIDES.every((f) => crossOk(s, f))) fail("cross incomplete");

  // 2. bottom corners
  for (let guard = 0; guard < 12; guard++) {
    const target = SLOTS.map(([a, b]) => [bottom, s.centre(a), s.centre(b)] as Color[]).find((cs, i) => {
      const [a, b] = SLOTS[i]!;
      const c = s.corner("D", a, b);
      return !(c[0] === bottom && c[1] === s.centre(a) && c[2] === s.centre(b));
    });
    if (!target) break;
    const pos = findCorner(s, target);
    if (pos[0] === "D") {
      // stuck in the bottom layer: lift it out with the right-hand formula at its slot
      const rot = Y_ROTS.find((r) => sig(s.apply(r).corner("D", "F", "R")) === sig(target))!;
      step(2, `${rot} ${RIGHT}`, `底層角塊：${name(target)}`, `${name(target)}角塊卡在底層的錯誤位置。把那個位置轉到右前方，做一次右手公式把它拿上來。`, `右手公式 ${RIGHT}`, target);
      continue;
    }
    const rot = Y_ROTS.find((r) => {
      const st = s.apply(r);
      return st.centre("F") === target[1] && st.centre("R") === target[2];
    })!;
    let st = s.apply(rot);
    const turn = U_SETUPS.find((u) => sig(st.apply(u).corner("U", "F", "R")) === sig(target))!;
    st = st.apply(turn);
    let reps = 0;
    while (reps < 6) {
      st = st.apply(RIGHT);
      reps++;
      const c = st.corner("D", "F", "R");
      if (c[0] === bottom && c[1] === st.centre("F") && c[2] === st.centre("R")) break;
    }
    if (reps >= 6) fail("corner reps");
    step(2, [rot, turn, ...Array(reps).fill(RIGHT)].filter(Boolean).join(" "), `底層角塊：${name(target)}`, `把目標位置轉到右前方，${name(target)}角塊轉到它的正上方，右手公式重複 ${reps} 次，直到白色朝下、顏色對齊。`, `右手公式 ${RIGHT}`, target);
    solved.push(sig(target));
  }
  if (!SLOTS.every(([a, b]) => s.corner("D", a, b)[0] === bottom && s.corner("D", a, b)[1] === s.centre(a) && s.corner("D", a, b)[2] === s.centre(b))) fail("corners incomplete");

  // 3. middle edges
  for (let guard = 0; guard < 12; guard++) {
    const target = SLOTS.map(([a, b]) => [s.centre(a), s.centre(b)] as Color[]).find((cs, i) => {
      const [a, b] = SLOTS[i]!;
      const e = s.edge(a, b);
      return !(e[0] === s.centre(a) && e[1] === s.centre(b));
    });
    if (!target) break;
    const pos = findEdge(s, target);
    if (pos[0] !== "U") {
      const rot = Y_ROTS.find((r) => sig(s.apply(r).edge("F", "R")) === sig(target))!;
      step(3, `${rot} ${INSERT_RIGHT}`, `中層邊塊：${name(target)}`, `${name(target)}邊塊在中層但位置或方向不對。把它轉到右前方，做一次右插入公式把它換上頂層。`, `右插入 ${INSERT_RIGHT}`, target);
      continue;
    }
    const [, sideFace] = pos;
    const sideColour = s.edge("U", sideFace)[1];
    const topColour = s.edge("U", sideFace)[0];
    const rot = Y_ROTS.find((r) => s.apply(r).centre("F") === sideColour)!;
    let st = s.apply(rot);
    const turn = U_SETUPS.find((u) => sig(st.apply(u).edge("U", "F")) === sig(target) && st.apply(u).edge("U", "F")[1] === sideColour)!;
    st = st.apply(turn);
    const right = st.centre("R") === topColour;
    step(3, [rot, turn, right ? INSERT_RIGHT : INSERT_LEFT].filter(Boolean).join(" "), `中層邊塊：${name(target)}`, `把${NAMES[sideColour]}色轉到前面對齊中心，${name(target)}邊塊移到前面正上方；它的另一色（${NAMES[topColour]}）在${right ? "右" : "左"}邊，所以用${right ? "右" : "左"}插入公式。`, `${right ? "右插入 " + INSERT_RIGHT : "左插入 " + INSERT_LEFT}`, target);
    solved.push(sig(target));
  }
  if (!SLOTS.every(([a, b]) => s.edge(a, b)[0] === s.centre(a) && s.edge(a, b)[1] === s.centre(b))) fail("middle incomplete");

  // 4. top cross
  {
    const edgesUp = (st: State) => SIDES.filter((f) => st.edge("U", f)[0] === top).length;
    const plan = plan2(s, CROSS_ALG, 3, (st) => edgesUp(st) === 4) ?? fail("top cross");
    for (const { setup, before } of plan) {
      const n = edgesUp(before);
      const shape = n === 0 ? "只有中心一點" : SIDES.some((f, i) => before.edge("U", f)[0] === top && before.edge("U", SIDES[(i + 2) % 4]!)[0] === top) ? "一條線" : "L 形";
      step(4, `${setup} ${CROSS_ALG}`, "頂層十字", `現在頂面是「${shape}」。${n === 0 ? "直接做十字公式。" : shape === "一條線" ? "把線轉成橫的再做公式。" : "把 L 轉到左上角（九點鐘方向）再做公式。"}`, `十字公式 ${CROSS_ALG}`);
    }
  }

  // 5. top face
  {
    const cornersUp = (st: State) => SLOTS.filter(([a, b]) => st.corner("U", a, b)[0] === top).length;
    const plan = plan2(s, SUNE, 4, (st) => cornersUp(st) === 4) ?? fail("top face");
    plan.forEach(({ setup, before }, i) => {
      step(5, `${setup} ${SUNE}`, "頂面全黃", `${cornersUp(before)} 個角已經朝上。調整頂層方向後做 Sune 公式${plan.length > 1 ? `（第 ${i + 1}／${plan.length} 次）` : ""}，黃色會一次翻上來一些。`, `Sune ${SUNE}`);
    });
  }

  // 6. top corners into place
  {
    const placed = (st: State) => SLOTS.every(([a, b]) => sig(st.corner("U", a, b)) === sig([top, st.centre(a), st.centre(b)]));
    const plan = plan2(s, CORNER_PERM, 3, (st) => U_SETUPS.some((u) => placed(st.apply(u)))) ?? fail("corner perm");
    plan.forEach(({ setup }, i) => {
      step(6, `${setup} ${CORNER_PERM}`, "頂層角塊歸位", `找已經在正確位置的角（它的三個顏色和旁邊兩個中心都對得上），轉到右前方，做 A 公式讓另外三個角輪換、黃面不變${plan.length > 1 ? `（第 ${i + 1}／${plan.length} 次）` : ""}。`, `A 公式 ${CORNER_PERM}`);
    });
    const fix = U_SETUPS.find((u) => placed(s.apply(u)))!;
    if (fix) step(6, fix, "頂層角塊歸位", "轉動頂層，讓每個角的顏色對齊旁邊的中心。");
  }

  // 7. top edges into place
  {
    const plan = plan2(s, EDGE_PERM, 3, (st) => U_SETUPS.some((u) => isSolved(st.apply(u).stickers))) ?? fail("edge perm");
    plan.forEach(({ setup }, i) => {
      step(7, `${setup} ${EDGE_PERM}`, "頂層邊塊歸位", `把已經對的邊（如果有）轉到後面，做邊塊換位公式讓其他三條邊輪換${plan.length > 1 ? `（第 ${i + 1}／${plan.length} 次）` : ""}。`, `邊塊換位 ${EDGE_PERM}`);
    });
    const fix = U_SETUPS.find((u) => isSolved(s.apply(u).stickers))!;
    if (fix) step(7, fix, "完成", "最後轉一下頂層，全部對齊。");
  }
  if (!isSolved(s.stickers)) fail("unsolved");
  return { moves, segments };
}

/**
 * Shortest sequence of (U setup, formula) applications, at most `depth` deep, reaching `goal`.
 */
function plan2(start: State, alg: string, depth: number, goal: (st: State) => boolean): { setup: string; before: State }[] | null {
  if (goal(start)) return [];
  type Node = { st: State; path: { setup: string; before: State }[] };
  let frontier: Node[] = [{ st: start, path: [] }];
  for (let d = 1; d <= depth; d++) {
    const next: Node[] = [];
    for (const node of frontier) {
      for (const setup of U_SETUPS) {
        const st = node.st.apply(`${setup} ${alg}`);
        const path = [...node.path, { setup, before: node.st }];
        if (goal(st)) return path;
        next.push({ st, path });
      }
    }
    frontier = next;
  }
  return null;
}

const OUTER = ["U", "U'", "U2", "R", "R'", "R2", "F", "F'", "F2", "D", "D'", "D2", "L", "L'", "L2", "B", "B'", "B2"];
let OUTER_MOVES: Move[] | null = null;

/** Iterative deepening over outer moves for the shortest sequence (≤ maxDepth) whose result satisfies `goal`. */
function search(stickers: Sticker[], maxDepth: number, goal: (st: State) => boolean): string | null {
  const movesParsed = (OUTER_MOVES ??= OUTER.map((t) => parseMove(t, 3)));
  if (goal(new State(stickers))) return "";
  const path: string[] = [];
  const dfs = (cur: Sticker[], depth: number, lastFace: string): boolean => {
    if (depth === 0) return goal(new State(cur));
    for (let i = 0; i < movesParsed.length; i++) {
      const mv = movesParsed[i]!;
      if (mv.face === lastFace) continue;
      path.push(OUTER[i]!);
      if (dfs(applyMove(cur, mv), depth - 1, mv.face)) return true;
      path.pop();
    }
    return false;
  };
  for (let d = 1; d <= maxDepth; d++) if (dfs(stickers, d, "")) return path.join(" ");
  return null;
}
