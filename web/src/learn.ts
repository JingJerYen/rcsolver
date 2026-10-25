/**
 * Learning mode: the beginner's method on a 2×2 and a 3×3, one stage per lesson. This module is
 * the part without the page: the lessons, the checks that tell when a stage is done, and the
 * practice puzzles, each a solved cube taken back through the lesson's own formulas so the
 * stages before it stay done.
 */
import type { Face } from "./api.js";
import { FACE_AXES, FACE_ORDER, applyAlgorithm, fromNet, isSolved, parseAlgorithm, toNet, type Sticker, type Vec } from "./cubeState.js";
import { tr } from "./i18n.js";

export type LearnSize = 2 | 3;

/** A step of a practice puzzle's solution: a lesson formula, by index, or a single turn. */
export type PracticeStep = number | string;

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
  formulas: Formula[];
  /** Watch cards: each starts from the cube the formula fixes and plays it. */
  demos: Formula[];
  /** The pieces this stage works on, by their sorted colour letters. */
  pieces: (signature: string) => boolean;
  /** The stage is done. */
  goal: (s: Sticker[], size: number) => boolean;
  /** The earlier stages, which a practice puzzle keeps done. */
  keep?: (s: Sticker[], size: number) => boolean;
  /**
   * The three practice puzzles, each written as its solution: formulas (by index) and the turns
   * that line them up. The puzzle is that solution undone, and the hint walks it. The first is
   * the watch card's own cube; the others ask for the formula twice, or for one turn first to
   * line it up, or for the other side.
   */
  practice: PracticeStep[][];
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

/** The moves that undo `alg`. */
export function invert(alg: string): string {
  return alg
    .split(/\s+/)
    .filter(Boolean)
    .reverse()
    .map((t) => (t.endsWith("'") ? t.slice(0, -1) : t.endsWith("2") ? t : `${t}'`))
    .join(" ");
}

const INSERT_CORNER = "R' D' R D";
const RIGHT = "U R U' R' U' F' U F";
const LEFT = "U' L' U L U F U' F'";
const CROSS = "F R U R' U' F'";
const SUNE = "R U R' U R U2 R'";
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
  formulas: [],
  demos: ["R", "R'", "U", "U'", "F", "F'"].map((m) => ({ name: m.replace("'", "′"), seq: m })),
  pieces: () => true,
  goal: (s) => isSolved(s),
  practice: [],
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
    formulas: [],
    demos: [{ name: tr("翻上來", "Bring up"), seq: "F2" }],
    pieces: sig(2, "W"),
    goal: (s) => crossDone(s),
    practice: [["F2"], ["R2"], ["L2", "F2"]],
  },
  {
    title: tr("底層", "First layer"),
    icon: "WWWWWWWWW",
    whiteDown: false,
    intro: tr("把白色角塊轉到它要去的位置正下方，重複「插角」直到它歸位、白色朝上。", "Turn a white corner to just below where it belongs, then repeat Insert until it is in, white side up."),
    task: tr("把白色那一層完成", "Finish the white layer"),
    formulas: [{ name: tr("插角", "Insert"), seq: INSERT_CORNER }],
    demos: [{ name: tr("插角", "Insert"), seq: INSERT_CORNER }],
    pieces: sig(3, "W"),
    goal: (s) => layerDone(s, 3, "U"),
    keep: (s) => crossDone(s),
    practice: [[0], [0, 0], ["D'", 0]],
  },
  {
    title: tr("中層", "Middle layer"),
    icon: "...GGGGGG",
    whiteDown: true,
    intro: tr("翻過來，白色朝下。頂層的邊轉到和側面中心同色的位置，看它要往右還是往左，用對應的公式放進中層。", "Turn it over, white down. Line a top edge up with its side centre, see whether it goes right or left, and use that formula."),
    task: tr("把中層四個邊放好", "Fill the middle layer"),
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
    practice: [[0], [1], ["U'", 0]],
  },
  {
    title: tr("黃色十字", "Yellow cross"),
    icon: ".Y.YYY.Y.",
    whiteDown: true,
    intro: tr("上面看到黃色的點、L 形或一條線：放好方向再按「十字」，一次一次變成十字。", "On top you see a dot, an L or a line of yellow: hold it the right way and press Cross until it becomes a cross."),
    task: tr("做出黃色十字", "Make the yellow cross"),
    formulas: [{ name: tr("十字", "Cross"), seq: CROSS }],
    demos: [{ name: tr("十字", "Cross"), seq: CROSS }],
    pieces: sig(2, "Y"),
    goal: (s) => yellowCross(s),
    keep: (s) => f2l(s),
    practice: [[0], ["U'", 0], [0, 0]],
  },
  {
    title: tr("黃色面", "Yellow face"),
    icon: "YYYYYYYYY",
    whiteDown: true,
    intro: tr("用「小魚」把黃色的角翻上來，一次一次直到整面黃。", "Use Fish to turn the yellow corners up, again and again until the whole face is yellow."),
    task: tr("讓上面全部變黃", "Make the top all yellow"),
    formulas: [{ name: tr("小魚", "Fish"), seq: SUNE }],
    demos: [{ name: tr("小魚", "Fish"), seq: SUNE }],
    pieces: sig(3, "Y"),
    goal: (s) => topFace(s, 3),
    keep: (s) => yellowCross(s),
    practice: [[0], ["U'", 0], [0, 0]],
  },
  {
    title: tr("頂層角", "Top corners"),
    icon: "Y.Y...Y.Y",
    whiteDown: true,
    intro: tr("把四個頂層角換到正確的位置（顏色和旁邊兩個中心一樣），先不管邊。", "Move the four top corners to their places (their colours match the two centres beside them); the edges come next."),
    task: tr("把頂層四個角放對位置", "Put the top corners in place"),
    formulas: [{ name: tr("換角", "Swap"), seq: CORNERS3 }],
    demos: [{ name: tr("換角", "Swap"), seq: CORNERS3 }],
    pieces: sig(3, "Y"),
    goal: (s) => cornersPlaced(s),
    keep: (s) => topFace(s, 3),
    practice: [[0], [0, 0], ["y", 0, "y'"]],
  },
  {
    title: tr("頂層邊・完成", "Top edges, done"),
    icon: "YYYYYYYYY",
    whiteDown: true,
    intro: tr("最後把頂層的邊換到對的位置，整顆就完成了。", "Last, move the top edges to their places and the cube is solved."),
    task: tr("把方塊完成", "Solve the cube"),
    formulas: [{ name: tr("換邊", "Edges"), seq: EDGES3 }],
    demos: [{ name: tr("換邊", "Edges"), seq: EDGES3 }],
    pieces: sig(2, "Y"),
    goal: (s) => isSolved(s),
    keep: (s) => cornersPlaced(s),
    practice: [[0], [0, 0], ["y", 0, "y'"]],
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
    formulas: [{ name: tr("插角", "Insert"), seq: INSERT_CORNER }],
    demos: [{ name: tr("插角", "Insert"), seq: INSERT_CORNER }],
    pieces: sig(3, "W"),
    goal: (s, size) => layerDone(s, size, "U"),
    practice: [[0], [0, 0], ["D'", 0]],
  },
  {
    title: tr("黃色面", "Yellow face"),
    icon: "YYYY",
    whiteDown: true,
    intro: tr("翻過來，白色朝下。用「小魚」把黃色的角翻上來，直到上面全黃。", "Turn it over, white down. Use Fish to turn the yellow corners up until the top is all yellow."),
    task: tr("讓上面全部變黃", "Make the top all yellow"),
    formulas: [{ name: tr("小魚", "Fish"), seq: SUNE }],
    demos: [{ name: tr("小魚", "Fish"), seq: SUNE }],
    pieces: sig(3, "Y"),
    goal: (s, size) => topFace(s, size),
    keep: (s, size) => layerDone(s, size, "D"),
    practice: [[0], ["U'", 0], [0, 0]],
  },
  {
    title: tr("頂層角・完成", "Top corners, done"),
    icon: "YYYY",
    whiteDown: true,
    intro: tr("最後把頂層的角換到對的位置，整顆就完成了。", "Last, move the top corners to their places and the cube is solved."),
    task: tr("把方塊完成", "Solve the cube"),
    formulas: [{ name: tr("換角", "Swap"), seq: TPERM }],
    demos: [{ name: tr("換角", "Swap"), seq: TPERM }],
    pieces: () => true,
    goal: (s) => isSolved(s),
    keep: (s, size) => topFace(s, size),
    practice: [[0], ["U'", 0], ["y", 0, "y'"]],
  },
];

export const LESSONS: Record<LearnSize, Lesson[]> = { 2: LESSONS_2, 3: LESSONS_3 };

/** The moves of a step of a practice solution. */
const stepMoves = (lesson: Lesson, step: PracticeStep) => (typeof step === "number" ? lesson.formulas[step]!.seq : step);

/** Practice puzzle `i`: the cube to start from (its solution undone) and a move target with some room. */
export function puzzle(size: LearnSize, index: number, i: number): { start: Sticker[]; par: number } {
  const lesson = LESSONS[size][index]!;
  const solution = lesson.practice[i]!.map((st) => stepMoves(lesson, st)).join(" ");
  const turns = solution.split(/\s+/).filter((t) => t && !/^[xyz]/.test(t)).length;
  return { start: applyAlgorithm(solvedFor(size, lesson.whiteDown), parseAlgorithm(invert(solution), size)), par: turns + 4 };
}

/** What the hint points at: a formula key, a single turn, or ⌫ when the cube has left the way. */
export type Hint = { formula: number } | { turn: string } | { undo: true };

/**
 * The hint for practice puzzle `i`: find the cube on the puzzle's written solution and give the
 * next step. Between steps that is the next formula or lining-up turn; part way through a formula
 * turned by hand, its next turn. A cube that is on neither has wandered off: take a move back.
 */
export function hintFor(size: LearnSize, index: number, i: number, cube: Sticker[]): Hint {
  const lesson = LESSONS[size][index]!;
  const key = (s: Sticker[]) => JSON.stringify(toNet(size, s));
  const now = key(cube);
  let s = puzzle(size, index, i).start;
  for (const step of lesson.practice[i]!) {
    if (key(s) === now) return typeof step === "number" ? { formula: step } : { turn: step };
    const moves = stepMoves(lesson, step).split(" ");
    for (let j = 0; j < moves.length; j++) {
      s = applyAlgorithm(s, parseAlgorithm(moves[j]!, size));
      if (j < moves.length - 1 && key(s) === now) return { turn: moves[j + 1]! };
    }
  }
  return { undo: true };
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
