/**
 * Learning mode on the page: the lesson map, a lesson (watch its formulas, then three practice
 * puzzles on a cube turned by hand) and the stars at the end. Progress stays on this device:
 * a lesson opens once the one before it has a star.
 */
import { CubeView } from "./cubeView.js";
import { applyAlgorithm, parseAlgorithm, parseMove, toNet, type Sticker } from "./cubeState.js";
import { tr } from "./i18n.js";
import { LESSONS, demoStart, hintFor, puzzle, solvedFor, starsFor, type LearnSize, type Lesson } from "./learn.js";
import type { Color } from "./api.js";
import { COLOR_HEX } from "./net.js";
import { twistToken } from "./study.js";

type Screen = "learnMap" | "learnView" | "learnDone";
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (t: string) => t.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const pretty = (seq: string) => seq.replace(/'/g, "′");
const PUZZLES = 3;
const DEMO_MS = 450;
/** A formula key turns at a pace you can follow; a whole-cube turn slower still, so it reads as the cube turning. */
const KEY_MS = 380;
const ROTATE_MS = 600;

/* ---------- progress ---------- */

const PROGRESS_KEY = "rcsolver.learn";
const SIZE_KEY = "rcsolver.learnSize";
type Progress = Record<LearnSize, number[]>;
function loadProgress(): Progress {
  try {
    const p = JSON.parse(localStorage.getItem(PROGRESS_KEY) ?? "{}") as Partial<Record<string, unknown>>;
    const list = (v: unknown) => (Array.isArray(v) ? v.map((n) => (typeof n === "number" ? n : 0)) : []);
    return { 2: list(p[2]), 3: list(p[3]) };
  } catch {
    return { 2: [], 3: [] };
  }
}
function saveStars(size: LearnSize, index: number, stars: number) {
  const p = loadProgress();
  p[size][index] = Math.max(p[size][index] ?? 0, stars);
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(p));
  } catch {
    /* storage unavailable: kept for this visit only */
  }
}
const starsOf = (p: Progress, size: LearnSize, i: number) => p[size][i] ?? 0;
const unlocked = (p: Progress, size: LearnSize, i: number) => i === 0 || starsOf(p, size, i - 1) > 0;
/** The lesson to take next: the first without a star. */
const nextLesson = (p: Progress, size: LearnSize) => {
  const i = LESSONS[size].findIndex((_, k) => starsOf(p, size, k) === 0);
  return i < 0 ? null : i;
};

let mapSize: LearnSize = 3;
try {
  if (localStorage.getItem(SIZE_KEY) === "2") mapSize = 2;
} catch {
  /* storage unavailable */
}
function setMapSize(size: LearnSize) {
  mapSize = size;
  try {
    localStorage.setItem(SIZE_KEY, String(size));
  } catch {
    /* storage unavailable */
  }
}

/** Lessons count from 1 on screen. */
const lessonName = (i: number, l: Lesson) => tr(`第 ${i + 1} 關・${l.title}`, `Lesson ${i + 1} · ${l.title}`);
const STAR = (fill: string, size = 15) =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true"><path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z" fill="${fill}"/></svg>`;
const starsHtml = (n: number, size?: number) => [0, 1, 2].map((k) => STAR(k < n ? "#f4b400" : "#d3dae4", size)).join("");
const LOCK =
  '<span class="lesson-lock" aria-hidden="true"><svg viewBox="0 0 24 24" width="12" height="12"><rect x="5" y="11" width="14" height="10" rx="2" fill="currentColor"/><path d="M8 11V8a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" stroke-width="2.4"/></svg></span>';

/** The map icon: the face this stage finishes, as a small grid. */
function iconHtml(l: Lesson, size: LearnSize, locked: boolean): string {
  if (!l.icon) return '<span class="lesson-letters">R U</span>';
  const cells = [...l.icon].map((ch) => `<i style="background:${locked ? (ch === "." ? "#8f9aa8" : "#c9d1dc") : ch === "." ? "#5b6878" : COLOR_HEX[ch as Color]}"></i>`).join("");
  return `<span class="lesson-grid" style="grid-template-columns:repeat(${size},1fr)">${cells}</span>`;
}

/* ---------- the module ---------- */

let show: (id: Screen | "setup") => void = () => {};
let view: CubeView;

interface Run {
  size: LearnSize;
  index: number;
  lesson: Lesson;
  phase: "watch" | "practice";
  puzzleNo: number;
  start: Sticker[];
  par: number;
  /** Cube after each action, for ⌫. */
  history: Sticker[][];
  /** Notation lesson: how many of the moves to copy are done. */
  copied: number;
  moves: number;
  totalMoves: number;
  totalPar: number;
  hints: number;
}
let run: Run | null = null;
let busy = false;
/**
 * Watch cards play a formula one turn per tap: the card in use and how many of its turns are done.
 * The notation lesson's cards are single turns played on the cube as it is, back to solved with Reset.
 */
let demoCard = 0;
let demoStep = 0;

/** The home card: where learning left off. */
export function renderLearnCard() {
  const p = loadProgress();
  const next = nextLesson(p, mapSize);
  const total = LESSONS[mapSize].length;
  const done = LESSONS[mapSize].filter((_, i) => starsOf(p, mapSize, i) > 0).length;
  $("learnCardTitle").textContent = tr("學會自己解", "Learn to solve it");
  $("learnCardSub").textContent =
    next === null ? tr(`${mapSize}×${mapSize}・全部完成`, `${mapSize}×${mapSize} · all done`) : `${mapSize}×${mapSize}・${lessonName(next, LESSONS[mapSize][next]!)}`;
  $("learnCardBar").style.width = `${Math.round((done / total) * 100)}%`;
}

function renderMap() {
  const p = loadProgress();
  $("learnMapTitle").textContent = tr("學習", "Learn");
  for (const b of $("learnSizes").querySelectorAll<HTMLButtonElement>("button")) b.setAttribute("aria-selected", String(Number(b.dataset.size) === mapSize));
  const next = nextLesson(p, mapSize);
  $("lessonList").innerHTML = LESSONS[mapSize]
    .map((l, i) => {
      const stars = starsOf(p, mapSize, i);
      const locked = !unlocked(p, mapSize, i);
      const current = i === next && !locked;
      // prefixed: a bare "done" would pick up the solve screen's .done block
      const state = locked ? "is-locked" : current ? "is-current" : stars ? "is-done" : "is-open";
      const label = `${lessonName(i, l)}${locked ? tr("（還沒解鎖）", " (locked)") : stars ? tr(`，${stars} 顆星`, `, ${stars} stars`) : ""}`;
      // a finished lesson can be taken again: say so, or its stars read like a closed record
      const extra = stars
        ? `<span class="lesson-stars">${starsHtml(stars)}</span><span class="lesson-start again">${tr("再練", "Again")}</span>`
        : current
          ? `<span class="lesson-start">${tr("開始", "Start")}</span>`
          : "";
      return `<li><button type="button" class="lesson ${state}" data-i="${i}" aria-label="${esc(label)}"${locked ? " disabled" : ""}><span class="lesson-icon">${iconHtml(l, mapSize, locked)}${locked ? LOCK : ""}</span><span class="lesson-name"><b>${esc(l.title)}</b>${extra}</span><span class="lesson-no">${i + 1}</span></button></li>`;
    })
    .join("");
}

export function openLearnMap() {
  renderMap();
  show("learnMap");
}

function setPhase(phase: "watch" | "practice") {
  const r = run!;
  r.phase = phase;
  const watch = phase === "watch";
  $("learnStepWatch").classList.add("on");
  $("learnStepPractice").classList.toggle("on", !watch);
  $("lessonDemos").classList.toggle("hidden", !watch);
  $("lessonGo").classList.toggle("hidden", !watch);
  $("lessonKeys").classList.toggle("hidden", watch);
  $("lessonRestart").classList.toggle("hidden", watch);
  $("learnHint").classList.toggle("hidden", watch);
  $("learnReset").classList.toggle("hidden", !watch || !r.lesson.copy);
  $("learnMoves").classList.toggle("hidden", watch);
  $("lessonTip").classList.add("hidden");
  view.setTwisting(!watch);
}

/** Only the pieces this stage works on keep their colours, and the centres, which say where they go. */
function focusLesson(on: boolean) {
  const r = run!;
  if (!on || r.lesson.copy) return view.setFocus(null);
  const pieces = new Set<string>();
  const solved = solvedFor(r.size, r.lesson.whiteDown);
  const byPiece = new Map<string, string[]>();
  for (const s of solved) byPiece.set(s.p.join(","), [...(byPiece.get(s.p.join(",")) ?? []), s.c]);
  for (const cols of byPiece.values()) {
    const sig = cols.sort().join("");
    if (sig.length === 1 || r.lesson.pieces(sig)) pieces.add(sig);
  }
  view.setFocus({ pieces });
}

function openLesson(size: LearnSize, index: number) {
  const lesson = LESSONS[size][index]!;
  run = { size, index, lesson, phase: "watch", puzzleNo: 0, start: [], par: 0, history: [], copied: 0, moves: 0, totalMoves: 0, totalPar: 0, hints: 0 };
  $("lessonTitle").textContent = lessonName(index, lesson);
  $("lessonCount").textContent = "";
  $("lessonText").textContent = lesson.intro;
  $("lessonGo").textContent = tr("我會了，去練習", "Got it, let me try");
  setPhase("watch");
  demoCard = 0;
  demoStep = 0;
  $("learnResetLabel").textContent = tr("重設", "Reset");
  renderDemos();
  // the notation lesson starts from the solved cube; a formula's card from the cube it fixes
  const first = lesson.demos[0];
  view.setState(size, first && !lesson.copy ? demoStart(size, index, first.seq) : solvedFor(size, lesson.whiteDown));
  view.resetView();
  focusLesson(true);
  show("learnView");
}

const PLAY_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M8 5l11 7-11 7z" fill="currentColor"/></svg>';
const RESET_ICON =
  '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M4 12a8 8 0 1 0 2.3-5.7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="M4 4v5h5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/** The watch cards: the card in use shows its turns done and the next one; once all are done its button resets. */
function renderDemos() {
  const r = run!;
  $("lessonDemos").innerHTML = r.lesson.demos
    .map((d, i) => {
      const moves = d.seq.split(" ");
      const active = !r.lesson.copy && i === demoCard;
      const done = active && demoStep >= moves.length;
      const seq = moves.map((m, k) => `<span class="${active && k < demoStep ? "is-done" : active && k === demoStep ? "is-next" : ""}">${esc(pretty(m))}</span>`).join(" ");
      const label = done ? tr(`重設${d.name}`, `Reset ${d.name}`) : tr(`${d.name}：下一步`, `${d.name}: next turn`);
      return `<div class="lesson-demo${active ? " active" : ""}"><span class="lesson-demo-name">${esc(d.name)}</span><code>${seq}</code><button type="button" class="lesson-play${done ? " reset" : ""}" data-demo="${i}" aria-label="${esc(label)}">${done ? RESET_ICON : PLAY_ICON}</button></div>`;
    })
    .join("");
}

/** Turn through a sequence on the lesson cube. */
/** Bumped by "start again" to stop a sequence that is still turning. */
let playGen = 0;
/** Turn through a sequence on the lesson cube; the number of turns, or null when stopped part way. */
async function play(seq: string, ms: number): Promise<number | null> {
  const r = run!;
  const gen = playGen;
  let turns = 0;
  for (const t of seq.split(/\s+/).filter(Boolean)) {
    if (gen !== playGen) return null;
    await view.animate(parseMove(t, r.size), 1, /^[xyz]/.test(t) ? Math.max(ms, ROTATE_MS) : ms);
    if (!/^[xyz]/.test(t)) turns++;
  }
  return gen === playGen ? turns : null;
}

/** Light the key the hint points at: a formula, y / y′ for a whole-cube turn (a drag turns layers only), or ⌫. */
function lightKey(seq: string | "undo" | null) {
  const want = seq && /^y/.test(seq) ? (seq === "y'" ? "y'" : "y") : seq;
  for (const k of $("lessonKeys").querySelectorAll<HTMLElement>("button")) k.classList.toggle("hint-key", (k.dataset.undo !== undefined ? "undo" : k.dataset.seq) === want);
}

function renderCopy() {
  const r = run!;
  const moves = r.lesson.copy![r.puzzleNo]!;
  $("lessonText").innerHTML = `${esc(r.lesson.task)}${moves.map((m, i) => `<span class="copy-move${i < r.copied ? " done" : i === r.copied ? " next" : ""}">${esc(pretty(m))}</span>`).join("")}`;
}

function renderKeys() {
  const r = run!;
  const keys = r.lesson.copy
    ? []
    : [
        ...r.lesson.formulas.map((f) => `<button type="button" class="k macro" data-seq="${esc(f.seq)}" aria-label="${esc(`${f.name}: ${pretty(f.seq)}`)}">${esc(f.name)}</button>`),
        `<button type="button" class="k" data-seq="y'" aria-label="${tr("整顆往右轉", "Turn the whole cube right")}">y′</button>`,
        `<button type="button" class="k" data-seq="y" aria-label="${tr("整顆往左轉", "Turn the whole cube left")}">y</button>`,
      ];
  keys.push(
    `<button type="button" class="k del" data-undo aria-label="${tr("撤回一步", "Take back")}"><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M9 5h11a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H9l-6-7z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M12 9.5l5 5M17 9.5l-5 5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button>`,
  );
  $("lessonKeys").innerHTML = keys.join("");
}

function renderMoves() {
  $("learnMoves").textContent = tr(`已轉 ${run!.moves} 步`, `${run!.moves} moves`);
}

function startPuzzle(k: number) {
  const r = run!;
  r.puzzleNo = k;
  if (r.lesson.copy) {
    r.start = solvedFor(r.size, false);
    r.par = r.lesson.copy[k]!.length;
  } else {
    const p = puzzle(r.size, r.index, k);
    r.start = p.start;
    r.par = p.par;
  }
  r.history = [r.start];
  r.copied = 0;
  r.moves = 0;
  setPhase("practice");
  $("lessonCount").textContent = tr(`練習 ${k + 1} / ${PUZZLES}`, `Practice ${k + 1} / ${PUZZLES}`);
  $("lessonRestart").textContent = tr("重來這一題", "Start this one again");
  $("learnHintLabel").textContent = tr("提示", "Hint");
  if (r.lesson.copy) renderCopy();
  else $("lessonText").textContent = r.lesson.task;
  renderKeys();
  renderMoves();
  view.setPreview(null);
  view.setState(r.size, r.start);
  view.resetView();
  focusLesson(false);
}

const same = (size: number, a: Sticker[], b: Sticker[]) => JSON.stringify(toNet(size, a)) === JSON.stringify(toNet(size, b));

/** After each turn, key or hand: count it, keep it for ⌫, and see whether the puzzle is done. */
function afterMove(turns: number) {
  const r = run!;
  r.moves += turns;
  renderMoves();
  $("lessonTip").classList.add("hidden");
  view.setPreview(null);
  lightKey(null);
  const now = view.getState();
  if (r.lesson.copy) {
    const moves = r.lesson.copy[r.puzzleNo]!;
    const want = applyAlgorithm(r.start, parseAlgorithm(moves.slice(0, r.copied + 1).join(" "), r.size));
    if (!same(r.size, now, want)) {
      // not the move asked for: show it, then put it back
      busy = true;
      $("lessonTip").textContent = tr(`不是這個，再試一次：${pretty(moves[r.copied]!)}`, `Not that one, try again: ${pretty(moves[r.copied]!)}`);
      $("lessonTip").classList.remove("hidden");
      setTimeout(() => {
        view.setState(r.size, r.history[r.history.length - 1]!);
        busy = false;
      }, 600);
      return;
    }
    r.copied++;
    r.history.push(now);
    renderCopy();
    if (r.copied === moves.length) void solved();
    return;
  }
  r.history.push(now);
  if (r.lesson.goal(now, r.size)) void solved();
}

async function solved() {
  const r = run!;
  busy = true;
  r.totalMoves += r.moves;
  r.totalPar += r.par;
  const ok = $("learnOk");
  ok.classList.remove("hidden");
  navigator.vibrate?.(40);
  await new Promise((done) => setTimeout(done, 900));
  ok.classList.add("hidden");
  busy = false;
  if (run !== r) return;
  if (r.puzzleNo + 1 < PUZZLES) startPuzzle(r.puzzleNo + 1);
  else finish();
}

function finish() {
  const r = run!;
  const stars = starsFor(r.hints, r.totalMoves, r.totalPar);
  saveStars(r.size, r.index, stars);
  $("doneStars").innerHTML = [0, 1, 2].map((k) => STAR(k < stars ? "#f4b400" : "#d3dae4", k === 1 ? 84 : 64)).join("");
  $("doneStars").setAttribute("aria-label", tr(`拿到 ${stars} 顆星，共 3 顆`, `${stars} of 3 stars`));
  $("doneTitle").textContent = tr(`第 ${r.index + 1} 關過關！`, `Lesson ${r.index + 1} done!`);
  const stat = (value: string, label: string) => `<div><b>${esc(value)}</b><span>${esc(label)}</span></div>`;
  $("doneStats").innerHTML = [
    stat(`${PUZZLES}/${PUZZLES}`, tr("練習題", "Puzzles")),
    stat(String(r.hints), tr("用提示", "Hints")),
    stat(`${r.totalMoves}/${r.totalPar}`, tr("步數／目標", "Moves / target")),
  ].join("");
  const next = LESSONS[r.size][r.index + 1];
  $("doneNext").classList.toggle("hidden", !next);
  if (next) $("doneNext").innerHTML = `<span>${tr("解鎖下一關", "Next up")}</span><b>${esc(lessonName(r.index + 1, next))}</b>`;
  $("doneNextBtn").textContent = next ? tr("下一關", "Next lesson") : tr("回地圖", "Back to the map");
  $("doneAgain").textContent = tr("再練一次", "Practise again");
  $("doneMap").textContent = tr("回地圖", "Back to the map");
  view.setTwisting(false);
  show("learnDone");
}

export function initLearn(showScreen: (id: Screen | "setup") => void) {
  show = showScreen;
  view = new CubeView($<HTMLCanvasElement>("learnCube"));
  view.canTwist = () => run?.phase === "practice" && !busy;
  view.onTwist = (axis, layer, quarters) => {
    if (!run || run.phase !== "practice") return;
    const token = twistToken(run.size, axis, layer, quarters);
    if (token) afterMove(1);
  };

  $("learnCard").onclick = openLearnMap;
  $("learnSizes").onclick = (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-size]");
    if (!b) return;
    setMapSize(Number(b.dataset.size) as LearnSize);
    renderMap();
  };
  $("lessonList").onclick = (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-i]");
    if (b && !b.disabled) openLesson(mapSize, Number(b.dataset.i));
  };
  $("learnBack").onclick = openLearnMap;
  $("lessonDemos").onclick = async (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-demo]");
    if (!b || !run || busy || view.animating) return;
    const r = run;
    const i = Number(b.dataset.demo);
    const demo = r.lesson.demos[i]!;
    // the notation lesson: that one turn, on the cube as it is
    if (r.lesson.copy) {
      busy = true;
      await play(demo.seq, DEMO_MS);
      busy = false;
      return;
    }
    const moves = demo.seq.split(" ");
    if (i !== demoCard || demoStep >= moves.length) {
      // another card, or this one done: set its starting cube out, ready for the first tap
      demoCard = i;
      demoStep = 0;
      view.setState(r.size, demoStart(r.size, r.index, demo.seq));
      renderDemos();
      return;
    }
    // one turn per tap
    busy = true;
    await play(moves[demoStep]!, DEMO_MS);
    demoStep++;
    busy = false;
    renderDemos();
  };
  // the notation lesson only: back to the solved cube
  $("learnReset").onclick = () => {
    if (!run || busy || view.animating) return;
    view.setState(run.size, solvedFor(run.size, run.lesson.whiteDown));
  };
  $("lessonGo").onclick = () => run && startPuzzle(0);
  $("lessonKeys").onclick = async (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("button");
    const r = run;
    if (!b || !r || r.phase !== "practice" || busy || view.animating) return;
    if (b.dataset.undo !== undefined) {
      if (r.history.length < 2) return;
      r.history.pop();
      view.setPreview(null);
      lightKey(null);
      view.setState(r.size, r.history[r.history.length - 1]!);
      if (r.lesson.copy) {
        r.copied = Math.max(0, r.copied - 1);
        renderCopy();
      }
      return;
    }
    busy = true;
    const turns = await play(b.dataset.seq!, KEY_MS);
    if (turns === null) return; // "start again" took over
    busy = false;
    afterMove(turns);
  };
  // start this puzzle again whatever is going on: stop a sequence part way, then put back the
  // cube, the view and the counter (the turns already made still count toward the stars)
  $("lessonRestart").onclick = async () => {
    const r = run;
    if (!r || r.phase !== "practice") return;
    playGen++;
    busy = true;
    for (let i = 0; view.animating && i < 50; i++) await new Promise((done) => setTimeout(done, 20));
    if (run !== r) return;
    r.totalMoves += r.moves;
    r.moves = 0;
    r.history = [r.start];
    r.copied = 0;
    view.setPreview(null);
    lightKey(null);
    view.setState(r.size, r.start);
    view.resetView();
    $("lessonTip").classList.add("hidden");
    renderMoves();
    if (r.lesson.copy) renderCopy();
    busy = false;
  };
  $("learnHint").onclick = () => {
    const r = run;
    if (!r || r.phase !== "practice" || busy || view.animating) return;
    // no words: the next step of this puzzle's written solution. A formula lights its key; a
    // turn is outlined on the cube with its arrow (y / y′ light up too); off the way, ⌫ lights up.
    const hint = r.lesson.copy ? { turn: r.lesson.copy[r.puzzleNo]![r.copied]! } : hintFor(r.size, r.index, r.puzzleNo, view.getState());
    r.hints++;
    view.setPreview("turn" in hint ? parseMove(hint.turn, r.size) : null);
    lightKey("formula" in hint ? r.lesson.formulas[hint.formula]!.seq : "turn" in hint ? hint.turn : "undo");
  };
  $("doneNextBtn").onclick = () => {
    const r = run;
    if (r && LESSONS[r.size][r.index + 1]) openLesson(r.size, r.index + 1);
    else openLearnMap();
  };
  $("doneAgain").onclick = () => run && openLesson(run.size, run.index);
  $("doneMap").onclick = openLearnMap;
  renderLearnCard();
}

/** For the end-to-end test: turn the lesson cube as a hand turn would, or put it right. */
export const learnTest = {
  async turn(token: string) {
    if (!run || run.phase !== "practice" || busy) return;
    busy = true;
    const turns = await play(token, 60);
    busy = false;
    if (turns !== null) afterMove(turns);
  },
  solve() {
    if (run) view.setState(run.size, solvedFor(run.size, run.lesson.whiteDown));
  },
  point: (key: string) => view.pointOf(key),
  /** The turn the hint would show now. */
  /** What the hint would point at now: a formula's name, a turn, or "undo". */
  hint: () => {
    if (!run || run.lesson.copy) return null;
    const h = hintFor(run.size, run.index, run.puzzleNo, view.getState());
    return "formula" in h ? run.lesson.formulas[h.formula]!.name : "turn" in h ? h.turn : "undo";
  },
  get state() {
    return run && { size: run.size, index: run.index, phase: run.phase, puzzleNo: run.puzzleNo, copied: run.copied, moves: run.moves, hints: run.hints };
  },
};
