/**
 * Learning mode: the beginner's method on a 2×2 and a 3×3, one stage per lesson. This module is
 * the part without the page: the lessons, the checks that tell when a stage is done, and the
 * practice puzzles, each a solved cube taken back through the lesson's own formulas so the
 * stages before it stay done.
 */
import type { Face } from "./api.js";
import { FACE_AXES, FACE_ORDER, applyAlgorithm, fromNet, isSolved, parseAlgorithm, type Sticker, type Vec } from "./cubeState.js";
import { tr } from "./i18n.js";

export type LearnSize = 2 | 3;

/** A formula the lesson teaches: a key in practice and a card to watch. */
export interface Formula {
  name: string;
  seq: string;
}

export interface Lesson {
  title: string;
  /** The map icon: size×size colour letters of the face this stage finishes, "." for grey; null shows "R U". */
  icon: string | null;
  /** Held white face down (from the middle layer on) instead of up. */
  whiteDown: boolean;
  /** What the stage is about, in a sentence or two. */
  intro: string;
  /** The practice instruction, one line. */
  task: string;
  /** What the hint says, beside lighting up the pieces that matter. */
  tip: string;
  formulas: Formula[];
  /** Watch cards: each starts from the cube the formula fixes and plays it. */
  demos: Formula[];
  /** The pieces this stage works on, by their sorted colour letters. */
  pieces: (signature: string) => boolean;
  /** The stage is done. */
  goal: (s: Sticker[], size: number) => boolean;
  /** The earlier stages, which a practice puzzle keeps done. */
  keep?: (s: Sticker[], size: number) => boolean;
  /** Practice puzzle `i` (0–2): moves from solved that undo this stage and keep the earlier ones. */
  setup: (rand: () => number, i: number) => string;
  /** The notation lesson: per puzzle, the moves to copy. */
  copy?: string[][];
}

const WHITE_UP: Record<Face, string> = { U: "W", R: "R", F: "G", D: "Y", L: "O", B: "B" };
// the same cube turned over (z2): white at the bottom, yellow on top
const WHITE_DOWN: Record<Face, string> = { U: "Y", R: "O", F: "G", D: "W", L: "R", B: "B" };

/** The solved cube as a lesson holds it. */
export function solvedFor(size: number, whiteDown: boolean): Sticker[] {
  const scheme = whiteDown ? WHITE_DOWN : WHITE_UP;
  return fromNet(size, Object.fromEntries(FACE_ORDER.map((f) => [f, Array.from({ length: size }, () => scheme[f].repeat(size))])) as Record<Face, string[]>);
}

/* ---------- checks ---------- */

const faceOf = (n: Vec): Face => FACE_ORDER.find((f) => FACE_AXES[f].n.every((v, i) => v === n[i]))!;
const on = (s: Sticker[], f: Face) => s.filter((st) => faceOf(st.n) === f);
const SIDES: Face[] = ["F", "R", "B", "L"];
/** How many coordinates of a cubie are on the outside: 3 corner, 2 edge, 1 centre. */
const outer = (p: Vec, size: number) => p.filter((v) => Math.abs(v) === size - 1).length;

/** The colour a 3×3 face should be: its centre's. A 2×2 has no centres: null, so only sameness counts. */
function centre(s: Sticker[], f: Face, size: number): string | null {
  if (size % 2 === 0) return null;
  return on(s, f).find((st) => outer(st.p, size) === 1)!.c;
}

/** Every sticker in the list is one colour (that colour when given). */
const uniform = (list: Sticker[], colour: string | null) => list.every((st) => st.c === (colour ?? list[0]!.c));

/** The top or bottom layer is done: its face in one colour and each side's row next to it in one colour (the side's centre on a 3×3). */
export function layerDone(s: Sticker[], size: number, face: "U" | "D"): boolean {
  const h = size - 1;
  const y = face === "U" ? h : -h;
  if (!uniform(on(s, face), centre(s, face, size))) return false;
  return SIDES.every((f) => uniform(on(s, f).filter((st) => st.p[1] === y), centre(s, f, size)));
}

/** 3×3: the four edges of the top face are in place, white side up and each matching its side's centre. */
export function crossDone(s: Sticker[]): boolean {
  return s
    .filter((st) => outer(st.p, 3) === 2 && st.p[1] === 2)
    .every((st) => st.c === centre(s, faceOf(st.n), 3));
}

/** 3×3: the middle layer's edges are in place. */
export function middleDone(s: Sticker[]): boolean {
  return SIDES.every((f) => uniform(on(s, f).filter((st) => st.p[1] === 0), centre(s, f, 3)));
}

const f2l = (s: Sticker[]) => layerDone(s, 3, "D") && middleDone(s);

/** 3×3: the yellow cross on top, the first two layers done. */
export function yellowCross(s: Sticker[]): boolean {
  const top = centre(s, "U", 3);
  return f2l(s) && on(s, "U").every((st) => outer(st.p, 3) !== 2 || st.c === top);
}

/** The top face in one colour with the bottom layer (and on a 3×3 the middle) done. */
export function topFace(s: Sticker[], size: number): boolean {
  return (size === 3 ? f2l(s) : layerDone(s, size, "D")) && uniform(on(s, "U"), centre(s, "U", size));
}

/** 3×3: the top face done and each top corner where it belongs: its side colours are those of the centres beside it. */
export function cornersPlaced(s: Sticker[]): boolean {
  if (!topFace(s, 3)) return false;
  const corners = new Map<string, Sticker[]>();
  for (const st of s) if (outer(st.p, 3) === 3 && st.p[1] === 2) corners.set(st.p.join(","), [...(corners.get(st.p.join(",")) ?? []), st]);
  return [...corners.values()].every((stickers) => {
    const sides = stickers.filter((st) => st.n[1] === 0);
    return sides.map((st) => st.c).sort().join() === sides.map((st) => centre(s, faceOf(st.n), 3)).sort().join();
  });
}

/* ---------- puzzles ---------- */

const pick = <T>(rand: () => number, list: T[]): T => list[Math.floor(rand() * list.length)]!;
const Y = ["", "y", "y2", "y'"];
const YINV = ["", "y'", "y2", "y"];
const U4 = ["", "U", "U2", "U'"];
const D4 = ["", "D", "D2", "D'"];

/** The moves that undo `alg`. */
export function invert(alg: string): string {
  return alg
    .split(/\s+/)
    .filter(Boolean)
    .reverse()
    .map((t) => (t.endsWith("'") ? t.slice(0, -1) : t.endsWith("2") ? t : `${t}'`))
    .join(" ");
}

/** `alg` done at one of the four sides: turn the cube, do it, turn back. */
const aroundY = (rand: () => number, alg: string) => {
  const k = Math.floor(rand() * 4);
  return `${Y[k]} ${alg} ${YINV[k]}`;
};

/** A few random turns, none about the axis of the one before. */
function randomTurns(rand: () => number, count: number, faces = ["U", "D", "R", "L", "F", "B"]): string {
  const axis = (f: string) => "UDRLFB".indexOf(f) >> 1;
  const out: string[] = [];
  let last = -1;
  while (out.length < count) {
    const f = pick(rand, faces);
    if (axis(f) === last) continue;
    last = axis(f);
    out.push(f + pick(rand, ["", "'", "2"]));
  }
  return out.join(" ");
}

/** `n` rounds of `parts`, each round one of them chosen at random. */
const rounds = (rand: () => number, n: number, parts: (() => string)[]) => Array.from({ length: n }, () => pick(rand, parts)()).join(" ");

const INSERT_CORNER = "R' D' R D";
const RIGHT = "U R U' R' U' F' U F";
const LEFT = "U' L' U L U F U' F'";
const CROSS = "F R U R' U' F'";
const SUNE = "R U R' U R U2 R'";
const ANTISUNE = "R' U' R U' R' U2 R";
// a corner 3-cycle that leaves every piece facing the same way, so the yellow face stays
const CORNERS3 = "R' F R' B2 R F' R' B2 R2";
const EDGES3 = "R U' R U R U R U' R' U' R2";
const TPERM = "R U R' U' R' F R2 U' R' U' R U R' F'";

const sig = (len: number, has?: string, hasnt: string[] = []) => (s: string) => s.length === len && (!has || s.includes(has)) && hasnt.every((c) => !s.includes(c));

const notation = (size: number): Lesson => ({
  title: tr("認識轉法", "Turns and their names"),
  icon: null,
  whiteDown: false,
  intro: tr(
    "每一面用一個字母代表：R 右、L 左、U 上、D 下、F 前、B 後。R 是從右邊看順時針轉一下，R′ 是逆時針，R2 是轉兩下。",
    "Each face has a letter: R right, L left, U up, D down, F front, B back. R turns the right face clockwise as you look at it, R′ anticlockwise, R2 twice.",
  ),
  task: tr("照著轉：", "Turn: "),
  tip: tr("用手指拖那一面，順時針就是從那一面看過去的時鐘方向。", "Drag that face; clockwise is as a clock seen from that side."),
  formulas: [],
  demos: ["R", "R'", "U", "U'", "F", "F'"].map((m) => ({ name: m.replace("'", "′"), seq: m })),
  pieces: () => true,
  goal: (s) => isSolved(s),
  setup: () => "",
  copy:
    size === 2
      ? [
          ["R", "U", "R'"],
          ["U'", "F", "R2"],
          ["F'", "U2", "R"],
        ]
      : [
          ["R", "U", "R'"],
          ["U'", "F", "R2"],
          ["L", "F'", "U2"],
        ],
});

const LESSONS_3: Lesson[] = [
  notation(3),
  {
    title: tr("白色十字", "White cross"),
    icon: ".W.WWW.W.",
    whiteDown: false,
    intro: tr("白色中心朝上。把四個白色邊塊轉到上面，而且每塊側面的顏色要和旁邊的中心一樣。", "White centre on top. Bring the four white edges up, each with its side colour matching the centre beside it."),
    task: tr("做出白色十字", "Make the white cross"),
    tip: tr("先找一個白色邊塊，把它轉到和它側面同色的中心下方，再把那一面轉兩下翻上來。", "Find a white edge, turn it under the centre of its side colour, then turn that face twice to bring it up."),
    formulas: [],
    demos: [{ name: tr("翻上來", "Bring up"), seq: "F2" }],
    pieces: sig(2, "W"),
    goal: (s) => crossDone(s),
    setup: (rand, i) => randomTurns(rand, [3, 5, 7][i]!),
  },
  {
    title: tr("底層", "First layer"),
    icon: "WWWWWWWWW",
    whiteDown: false,
    intro: tr("把白色角塊轉到它要去的位置正下方，重複「插角」直到它歸位、白色朝上。", "Turn a white corner to just below where it belongs, then repeat Insert until it is in, white side up."),
    task: tr("把白色那一層完成", "Finish the white layer"),
    tip: tr("角塊在右前下方時按「插角」，可能要按好幾次；位置不對就先轉下層。", "With the corner at front right, bottom, press Insert, maybe several times; if it is not there, turn the bottom layer first."),
    formulas: [{ name: tr("插角", "Insert"), seq: INSERT_CORNER }],
    demos: [{ name: tr("插角", "Insert"), seq: INSERT_CORNER }],
    pieces: sig(3, "W"),
    goal: (s) => layerDone(s, 3, "U"),
    keep: (s) => crossDone(s),
    setup: (rand, i) => rounds(rand, 2 + i, [() => aroundY(rand, `${pick(rand, D4)} ${invert(INSERT_CORNER)}`)]),
  },
  {
    title: tr("中層", "Middle layer"),
    icon: "...GGGGGG",
    whiteDown: true,
    intro: tr("翻過來，白色朝下。頂層的邊轉到和側面中心同色的位置，看它要往右還是往左，用對應的公式放進中層。", "Turn it over, white down. Line a top edge up with its side centre, see whether it goes right or left, and use that formula."),
    task: tr("把中層四個邊放好", "Fill the middle layer"),
    tip: tr("找一個沒有黃色的頂層邊，轉上層讓它的前面顏色對到前面中心；它的上面顏色在右邊就「往右」，在左邊就「往左」。", "Find a top edge with no yellow; turn the top until its front colour matches the front centre. If its top colour is the right centre's, use Right, else Left."),
    formulas: [
      { name: tr("往右", "Right"), seq: RIGHT },
      { name: tr("往左", "Left"), seq: LEFT },
    ],
    demos: [
      { name: tr("往右", "Right"), seq: RIGHT },
      { name: tr("往左", "Left"), seq: LEFT },
    ],
    pieces: sig(2, undefined, ["W", "Y"]),
    goal: (s) => f2l(s),
    keep: (s) => layerDone(s, 3, "D"),
    setup: (rand, i) => rounds(rand, 2 + i, [() => aroundY(rand, `${pick(rand, U4)} ${invert(pick(rand, [RIGHT, LEFT]))}`)]),
  },
  {
    title: tr("黃色十字", "Yellow cross"),
    icon: ".Y.YYY.Y.",
    whiteDown: true,
    intro: tr("上面看到黃色的點、L 形或一條線：放好方向再按「十字」，一次一次變成十字。", "On top you see a dot, an L or a line of yellow: hold it the right way and press Cross until it becomes a cross."),
    task: tr("做出黃色十字", "Make the yellow cross"),
    tip: tr("一條線要橫放；L 形要放在左上角（後面和左邊）；只有一點就直接按。", "Hold a line left to right; an L at the back left; with just a dot, press it straight away."),
    formulas: [{ name: tr("十字", "Cross"), seq: CROSS }],
    demos: [{ name: tr("十字", "Cross"), seq: CROSS }],
    pieces: sig(2, "Y"),
    goal: (s) => yellowCross(s),
    keep: (s) => f2l(s),
    setup: (rand, i) => rounds(rand, 1 + i, [() => `${pick(rand, U4)} ${invert(CROSS)}`, () => `${pick(rand, U4)} ${SUNE}`]),
  },
  {
    title: tr("黃色面", "Yellow face"),
    icon: "YYYYYYYYY",
    whiteDown: true,
    intro: tr("用「小魚」把黃色的角翻上來，一次一次直到整面黃。", "Use Fish to turn the yellow corners up, again and again until the whole face is yellow."),
    task: tr("讓上面全部變黃", "Make the top all yellow"),
    tip: tr("只有一個角是黃的（像小魚）：把它放在左前方再按；其他情況讓左前角的黃色朝左再按。", "With one yellow corner (a fish), put it front left and press; otherwise turn the top so the front-left corner's yellow faces left, then press."),
    formulas: [{ name: tr("小魚", "Fish"), seq: SUNE }],
    demos: [{ name: tr("小魚", "Fish"), seq: SUNE }],
    pieces: sig(3, "Y"),
    goal: (s) => topFace(s, 3),
    keep: (s) => yellowCross(s),
    setup: (rand, i) => rounds(rand, 1 + i, [() => `${pick(rand, U4)} ${SUNE}`, () => `${pick(rand, U4)} ${ANTISUNE}`]),
  },
  {
    title: tr("頂層角", "Top corners"),
    icon: "Y.Y...Y.Y",
    whiteDown: true,
    intro: tr("把四個頂層角換到正確的位置（顏色和旁邊兩個中心一樣），先不管邊。", "Move the four top corners to their places (their colours match the two centres beside them); the edges come next."),
    task: tr("把頂層四個角放對位置", "Put the top corners in place"),
    tip: tr("轉上層找一個已經在對的位置的角，把它放在左前方再按「換角」，可能要按兩次。", "Turn the top to find a corner already in place, keep it front left and press Swap, maybe twice."),
    formulas: [{ name: tr("換角", "Swap"), seq: CORNERS3 }],
    demos: [{ name: tr("換角", "Swap"), seq: CORNERS3 }],
    pieces: sig(3, "Y"),
    goal: (s) => cornersPlaced(s),
    keep: (s) => topFace(s, 3),
    setup: (rand, i) => rounds(rand, 1 + Math.min(i, 1), [() => aroundY(rand, pick(rand, [CORNERS3, invert(CORNERS3)]))]),
  },
  {
    title: tr("頂層邊・完成", "Top edges, done"),
    icon: "YYYYYYYYY",
    whiteDown: true,
    intro: tr("最後把頂層的邊換到對的位置，整顆就完成了。", "Last, move the top edges to their places and the cube is solved."),
    task: tr("把方塊完成", "Solve the cube"),
    tip: tr("有一面整排都對的話，把它放在後面再按「換邊」，可能要按兩次。", "If one side's top row is all right, hold it at the back and press Edges, maybe twice."),
    formulas: [{ name: tr("換邊", "Edges"), seq: EDGES3 }],
    demos: [{ name: tr("換邊", "Edges"), seq: EDGES3 }],
    pieces: sig(2, "Y"),
    goal: (s) => isSolved(s),
    keep: (s) => cornersPlaced(s),
    setup: (rand) => aroundY(rand, pick(rand, [EDGES3, invert(EDGES3)])),
  },
];

const LESSONS_2: Lesson[] = [
  notation(2),
  {
    title: tr("底層", "First layer"),
    icon: "WWWW",
    whiteDown: false,
    intro: tr("把四個白色角塊轉到上面，而且每一側上排的兩格要同色。角塊在右前下方時用「插角」把它送上去。", "Bring the four white corners to the top, with the two stickers of each side's top row matching. With a corner at front right, bottom, Insert sends it up."),
    task: tr("把白色那一層完成", "Finish the white layer"),
    tip: tr("先放好一個白角當基準；下一個角轉到它要去的位置正下方，重複「插角」。", "Place one white corner first; turn the next one to just below where it belongs and repeat Insert."),
    formulas: [{ name: tr("插角", "Insert"), seq: INSERT_CORNER }],
    demos: [{ name: tr("插角", "Insert"), seq: INSERT_CORNER }],
    pieces: sig(3, "W"),
    goal: (s, size) => layerDone(s, size, "U"),
    setup: (rand, i) => randomTurns(rand, [3, 4, 6][i]!, ["U", "R", "F", "D"]),
  },
  {
    title: tr("黃色面", "Yellow face"),
    icon: "YYYY",
    whiteDown: true,
    intro: tr("翻過來，白色朝下。用「小魚」把黃色的角翻上來，直到上面全黃。", "Turn it over, white down. Use Fish to turn the yellow corners up until the top is all yellow."),
    task: tr("讓上面全部變黃", "Make the top all yellow"),
    tip: tr("只有一個角是黃的：把它放在左前方再按；其他情況讓左前角的黃色朝左再按。", "With one yellow corner, put it front left and press; otherwise turn the top so the front-left corner's yellow faces left, then press."),
    formulas: [{ name: tr("小魚", "Fish"), seq: SUNE }],
    demos: [{ name: tr("小魚", "Fish"), seq: SUNE }],
    pieces: sig(3, "Y"),
    goal: (s, size) => topFace(s, size),
    keep: (s, size) => layerDone(s, size, "D"),
    setup: (rand, i) => rounds(rand, 1 + i, [() => `${pick(rand, U4)} ${SUNE}`, () => `${pick(rand, U4)} ${ANTISUNE}`]),
  },
  {
    title: tr("頂層角・完成", "Top corners, done"),
    icon: "YYYY",
    whiteDown: true,
    intro: tr("最後把頂層的角換到對的位置，整顆就完成了。", "Last, move the top corners to their places and the cube is solved."),
    task: tr("把方塊完成", "Solve the cube"),
    tip: tr("找一側上排兩格同色的（像一對車燈），把它放在後面再按「換角」。", "Find a side whose two top stickers match (headlights), hold it at the back and press Swap."),
    formulas: [{ name: tr("換角", "Swap"), seq: TPERM }],
    demos: [{ name: tr("換角", "Swap"), seq: TPERM }],
    pieces: () => true,
    goal: (s) => isSolved(s),
    keep: (s, size) => topFace(s, size),
    setup: (rand) => `${aroundY(rand, TPERM)} ${pick(rand, U4)}`,
  },
];

export const LESSONS: Record<LearnSize, Lesson[]> = { 2: LESSONS_2, 3: LESSONS_3 };

/** A practice puzzle: the cube to start from, and roughly how many moves a good solve takes. */
export function puzzle(size: LearnSize, index: number, i: number, rand: () => number = Math.random): { start: Sticker[]; par: number } {
  const lesson = LESSONS[size][index]!;
  const solved = solvedFor(size, lesson.whiteDown);
  for (let tries = 0; tries < 50; tries++) {
    const alg = lesson.setup(rand, i).trim();
    const start = alg ? applyAlgorithm(solved, parseAlgorithm(alg, size)) : solved;
    if (alg && (lesson.goal(start, size) || (lesson.keep && !lesson.keep(start, size)))) continue;
    const moves = alg.split(/\s+/).filter((t) => t && !/^[xyz]/.test(t)).length;
    return { start, par: Math.max(8, Math.round(moves * 2)) };
  }
  throw new Error(`no puzzle for lesson ${size}×${size} #${index}`);
}

/** Where a watch card starts: the solved cube with the formula undone, so playing it puts things right. */
export function demoStart(size: LearnSize, index: number, seq: string): Sticker[] {
  const lesson = LESSONS[size][index]!;
  return applyAlgorithm(solvedFor(size, lesson.whiteDown), parseAlgorithm(invert(seq), size));
}

/** Stars for a finished lesson: 1 for finishing, 1 more with no hints, 1 more within the move target. */
export function starsFor(hints: number, moves: number, par: number): number {
  return 1 + (hints === 0 ? 1 : 0) + (moves <= par ? 1 : 0);
}
