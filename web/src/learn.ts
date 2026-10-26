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
  /** When to use it: how the cube should look, in a sentence. */
  when?: string;
  /**
   * What the cube shows about that: "moves" draws an arrow from each piece of the stage to where
   * the formula sends it; "swap" also rings the stage's top pieces that stay (where to hold them);
   * "pattern" rings the top colour on the top layer, the shape to look for.
   */
  look?: "moves" | "swap" | "pattern";
}

/** A watch card: a formula played once, from a cube it may not finish in one go. */
export interface Demo extends Formula {
  /** Which case of the formula this card shows, under its name: "L shape", "No fish". */
  case?: string;
  /** What finishes the stage after this card's press: the cube starts from these undone too. */
  rest?: string;
  /** The notation lesson: the turn in words, shown in place of its moves. */
  meaning?: string;
}

const FACE_NAMES: Record<string, [string, string]> = { R: ["右", "right"], L: ["左", "left"], U: ["上", "up"], D: ["下", "down"], F: ["前", "front"], B: ["後", "back"] };
/** Where to look from to see a turn's face: the left face from the left, the bottom from below, the back from behind. */
export const sideOf = (move: string): "right" | "left" | "below" | "back" => ({ L: "left", D: "below", B: "back" })[move[0]!] as "left" | "below" | "back" ?? "right";

/** A turn's face in a word, for the notation lesson: R → 右. */
export const faceName = (move: string) => {
  const [zh, en] = FACE_NAMES[move[0]!] ?? [move, move];
  return tr(zh, en);
};
/** A turn in a few words, for the notation lesson: R → 右・順時針, R′ → 右・逆時針, R2 → 右・轉兩下. */
function turnWords(move: string): string {
  const [zh, en] = FACE_NAMES[move[0]!] ?? [move, move];
  return move.endsWith("'") ? tr(`${zh}・逆時針`, `${en}, anticlockwise`) : move.endsWith("2") ? tr(`${zh}・轉兩下`, `${en}, twice`) : tr(`${zh}・順時針`, `${en}, clockwise`);
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
  /** Watch cards: each starts from a cube the formula is used on and plays it once. */
  demos: Demo[];
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

const F_INSERT: Formula = {
  name: tr("插角", "Insert"),
  seq: INSERT_CORNER,
  when: tr("白角在它的位置正下方（右前下）就按，白色朝上為止可能要按好幾次。", "With the white corner right below its place (front right, bottom). It may take a few presses until white is on top."),
  look: "moves",
};
const F_RIGHT: Formula = {
  name: tr("往右", "Right"),
  seq: RIGHT,
  when: tr("頂層的邊前面顏色對到前面中心，上面顏色是右邊中心的顏色。", "The top edge's front colour matches the front centre, and its top colour is the right centre's."),
  look: "moves",
};
const F_LEFT: Formula = {
  name: tr("往左", "Left"),
  seq: LEFT,
  when: tr("頂層的邊前面顏色對到前面中心，上面顏色是左邊中心的顏色。", "The top edge's front colour matches the front centre, and its top colour is the left centre's."),
  look: "moves",
};
const F_CROSS: Formula = {
  name: tr("十字", "Cross"),
  seq: CROSS,
  when: tr("黃色一條線要橫放；L 形放在左後方；只有中心一點就直接按。", "Hold a yellow line left to right, an L at the back left; with just the centre, press it straight away."),
  look: "pattern",
};
// one card per shape on top; each press turns a shape into the next: dot, L, line, cross
const CROSS_CARDS: Demo[] = [
  { ...F_CROSS, case: tr("一條線", "Line"), when: tr("黃色一條線：轉成橫放再按，就變成十字。", "A yellow line: hold it left to right and press; it becomes the cross.") },
  { ...F_CROSS, case: tr("L 形", "L shape"), rest: CROSS, when: tr("L 形：轉到左後方再按，會變成橫的一條線。", "An L: turn it to the back left and press; it becomes a line across.") },
  { ...F_CROSS, case: tr("一點", "Dot"), rest: `U2 ${CROSS} ${CROSS}`, when: tr("只有中心一點：直接按，會變成 L 形。", "Just the centre: press it as it is; it becomes an L.") },
];
const F_FISH: Formula = {
  name: tr("小魚", "Fish"),
  seq: SUNE,
  when: tr("只有一個角黃色朝上（小魚的頭）時，把它放在左前方。", "With one corner yellow side up (the fish's head), put it at the front left."),
  look: "pattern",
};
// Fish alone does every top: without a fish, one press held the right way makes one
const FISH_CARDS: Demo[] = [
  {
    ...F_FISH,
    case: tr("有小魚", "A fish"),
    when: tr("只有一個角黃色朝上（小魚的頭）：把它放在左前方再按。按完又是一條小魚的話，再擺一次、再按。", "One corner yellow side up (the fish's head): put it at the front left and press. If another fish appears, do the same again."),
  },
  {
    ...F_FISH,
    case: tr("沒有小魚", "No fish"),
    rest: SUNE,
    when: tr("沒有角朝上：讓左前角的黃色朝左邊再按。兩個角朝上：讓左前角的黃色朝前面再按。按完就會變成小魚。", "No corner yellow side up: turn the top until the front-left corner's yellow faces left, then press. Two up: its yellow facing front. Either way a fish appears."),
  },
];
const F_CORNERS: Formula = {
  name: tr("換角", "Swap"),
  seq: CORNERS3,
  when: tr("已經在對的位置的那個角放在左前方，其他三個會照箭頭輪換。", "Keep the corner that is already in place at the front left; the other three go round as the arrows show."),
  look: "swap",
};
const F_EDGES: Formula = {
  name: tr("換邊", "Edges"),
  seq: EDGES3,
  when: tr("已經整排對的那一面放在後面，其他三個邊會照箭頭輪換。", "Keep the side whose top row is all right at the back; the other three edges go round as the arrows show."),
  look: "swap",
};
const F_TPERM: Formula = {
  name: tr("換角", "Swap"),
  seq: TPERM,
  when: tr("上排兩格同色的那一面（像一對車燈）放在左邊，右邊兩個角會互換。", "Hold the side whose two top stickers match (headlights) on the left; the two right corners swap."),
  look: "swap",
};

const sig = (len: number, has?: string, hasnt: string[] = []) => (s: string) => s.length === len && (!has || s.includes(has)) && hasnt.every((c) => !s.includes(c));

const notation = (size: number): Lesson => ({
  title: tr("認識轉法", "Turns and their names"),
  icon: null,
  whiteDown: false,
  intro: tr(
    "每一面用一個字母代表，加 ′ 是反方向，加 2 是轉兩下。",
    "Each face has a letter; ′ turns it the other way, 2 turns it twice.",
  ),
  task: tr("照著轉：", "Turn: "),
  formulas: [],
  // each card: the letter and the turn in a few words; ′ and 2 shown once, on R, then every face
  demos: ["R", "R'", "R2", "L", "U", "D", "F", "B"].map((m) => ({ name: m.replace("'", "′"), seq: m, meaning: turnWords(m) })),
  pieces: () => true,
  goal: (s) => isSolved(s),
  practice: [],
  copy:
    size === 2
      ? [
          ["R", "U", "R'"],
          ["U'", "F", "R2"],
          ["L", "D'", "B"],
        ]
      : [
          ["R", "U", "R'"],
          ["U'", "F", "R2"],
          ["L", "D'", "B"],
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
    demos: [{ name: tr("翻上來", "Bring up"), seq: "F2", when: tr("白色邊塊在底層：轉到它側面顏色的中心下方，再把那一面轉兩下。", "A white edge in the bottom layer: turn it under the centre of its side colour, then turn that face twice."), look: "moves" }],
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
    formulas: [F_INSERT],
    demos: [F_INSERT],
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
    formulas: [F_RIGHT, F_LEFT],
    demos: [F_RIGHT, F_LEFT],
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
    formulas: [F_CROSS],
    demos: CROSS_CARDS,
    pieces: sig(2, "Y"),
    goal: (s) => yellowCross(s),
    keep: (s) => f2l(s),
    // a line, an L to turn into place first, a dot
    practice: [[0], ["U'", 0, 0], [0, "U2", 0, 0]],
  },
  {
    title: tr("黃色面", "Yellow face"),
    icon: "YYYYYYYYY",
    whiteDown: true,
    intro: tr("用「小魚」把黃色的角翻上來，一次一次直到整面黃。", "Use Fish to turn the yellow corners up, again and again until the whole face is yellow."),
    task: tr("讓上面全部變黃", "Make the top all yellow"),
    formulas: [F_FISH],
    demos: FISH_CARDS,
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
    formulas: [F_CORNERS],
    demos: [F_CORNERS],
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
    formulas: [F_EDGES],
    demos: [F_EDGES],
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
    formulas: [F_INSERT],
    demos: [F_INSERT],
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
    formulas: [F_FISH],
    demos: FISH_CARDS,
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
    formulas: [F_TPERM],
    demos: [F_TPERM],
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

/** Arrows by cubie position, rings by sticker key, and the side to look from to see them. */
export interface Guides {
  arrows: [Vec, Vec][];
  rings: Set<string>;
  side: "right" | "left";
}

/** What the cube shows about using `formula` on `cube`. */
export function guidesFor(size: LearnSize, index: number, formula: Formula, cube: Sticker[]): Guides | null {
  const lesson = LESSONS[size][index]!;
  if (!formula.look) return null;
  const h = size - 1;
  const after = applyAlgorithm(cube, parseAlgorithm(formula.seq, size));
  // the stickers of each piece, by index (turns keep the order), and the piece's colour letters
  const pieces = new Map<string, number[]>();
  cube.forEach((st, i) => pieces.set(st.p.join(","), [...(pieces.get(st.p.join(",")) ?? []), i]));
  const arrows: [Vec, Vec][] = [];
  const rings = new Set<string>();
  const key = (st: Sticker) => `${st.p.join(",")}|${st.n.join(",")}`;
  const top = solvedFor(size, lesson.whiteDown).find((st) => st.n[1] === 1)!.c;
  for (const idx of pieces.values()) {
    const at = cube[idx[0]!]!.p;
    if (!lesson.pieces(idx.map((i) => cube[i]!.c).sort().join(""))) continue;
    const to = after[idx[0]!]!.p;
    const moves = to.some((v, k) => v !== at[k]);
    if (formula.look === "pattern") {
      // the top colour on the top layer: on top for edges (the cross's shape), on any side for
      // corners (which way the fish's corners face)
      if (at[1] === h) for (const i of idx) if (cube[i]!.c === top && (idx.length === 3 || cube[i]!.n[1] === 1)) rings.add(key(cube[i]!));
    } else if (moves) arrows.push([at, to]);
    else if (formula.look === "swap" && at[1] === h) for (const i of idx) rings.add(key(cube[i]!));
  }
  // a pattern reads from the middle: ring the top centre too (odd cubes have one)
  if (formula.look === "pattern" && size % 2 === 1) {
    const centre = cube.find((st) => st.n[1] === 1 && st.p[0] === 0 && st.p[2] === 0);
    if (centre) rings.add(key(centre));
  }
  // a pattern held by the front-left corner's yellow facing left (Fish without a fish) is seen from the left
  const side = formula.look === "pattern" && rings.has(`${-h},${h},${h}|-1,0,0`) ? "left" : "right";
  return { arrows, rings, side };
}

/** Where a watch card starts: the solved cube with the card's press and what follows it undone. */
export function demoStart(size: LearnSize, index: number, demo: Demo): Sticker[] {
  const lesson = LESSONS[size][index]!;
  return applyAlgorithm(solvedFor(size, lesson.whiteDown), parseAlgorithm(invert(`${demo.seq} ${demo.rest ?? ""}`), size));
}

/** Stars for a finished lesson: 1 for finishing, 1 more with no hints, 1 more within the move target. */
export function starsFor(hints: number, moves: number, par: number): number {
  return 1 + (hints === 0 ? 1 : 0) + (moves <= par ? 1 : 0);
}
