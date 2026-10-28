/**
 * Speed mode: the phone held sideways, both hands on the screen. The left side only turns the view
 * (all the way round, no angle limits); the right side only turns layers, by dragging a sticker.
 * Scramble → 15 s to look → the clock starts on the first turn and stops when the cube is solved.
 */
import { FACES, type Face } from "./api.js";
import { CubeView } from "./cubeView.js";
import { applyAlgorithm, fromNet, isSolved, parseAlgorithm, type Sticker } from "./cubeState.js";
import { tr } from "./i18n.js";
import { scrambleTokens } from "./study.js";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const SIZES = [2, 3, 4, 5];
const INSPECT_MS = 15000;
const SIZE_KEY = "rcsolver.speedSize";
const recordsKey = (n: number) => `rcsolver.speed.${n}`;

interface Solve {
  ms: number;
  moves: number;
  ts: number;
}

type Phase = "idle" | "inspect" | "solving" | "done";

let view: CubeView | null = null;
let size = 3;
let phase: Phase = "idle";
let inspectAt = 0;
let startAt = 0;
/** When the finger went down on the sticker of the turn that may start the clock. */
let pressAt = 0;
let moves = 0;
let tick = 0;

const COLORS: Record<Face, string> = { U: "W", R: "R", F: "G", D: "Y", L: "O", B: "B" };

function solved(n: number): Sticker[] {
  return fromNet(n, Object.fromEntries(FACES.map((f) => [f, Array.from({ length: n }, () => COLORS[f].repeat(n))])) as Record<Face, string[]>);
}

export function loadRecords(n: number): Solve[] {
  try {
    const list = JSON.parse(localStorage.getItem(recordsKey(n)) ?? "[]");
    return Array.isArray(list) ? list.filter((r) => typeof r?.ms === "number") : [];
  } catch {
    return [];
  }
}

function saveRecord(n: number, r: Solve) {
  try {
    localStorage.setItem(recordsKey(n), JSON.stringify([r, ...loadRecords(n)].slice(0, 100)));
  } catch {
    // private mode: the time is still shown, just not kept
  }
}

/** m:ss.cc */
export function clock(ms: number): string {
  const cs = Math.floor(ms / 10);
  const s = Math.floor(cs / 100);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}.${String(cs % 100).padStart(2, "0")}`;
}

/** The average of the latest five, the best and the worst left out (as cubers count it), or null. */
export function averageOf5(records: Solve[]): number | null {
  if (records.length < 5) return null;
  const five = records.slice(0, 5).map((r) => r.ms).sort((a, b) => a - b);
  return (five[1]! + five[2]! + five[3]!) / 3;
}

const best = (records: Solve[]) => (records.length ? Math.min(...records.map((r) => r.ms)) : null);

/** The home card's line: how it's played, and the best time on 3×3 once there is one. */
export function renderSpeedCard() {
  $("speedCardTitle").textContent = tr("速轉計時", "Speed solve");
  const b = best(loadRecords(3));
  const how = tr("橫拿手機・雙手轉", "Phone sideways · two hands");
  $("speedCardSub").textContent = b === null ? how : `${how}・${tr("最佳", "best")} ${clock(b)}`;
}

function setPhase(p: Phase) {
  phase = p;
  $("speed").dataset.phase = p;
  render();
}

function render() {
  const now = performance.now();
  const big = $("speedTime");
  const note = $("speedNote");
  if (phase === "idle") {
    big.textContent = clock(0);
    note.textContent = "";
  } else if (phase === "inspect") {
    big.textContent = String(Math.max(0, Math.ceil((INSPECT_MS - (now - inspectAt)) / 1000)));
    note.textContent = tr("觀察・轉第一下開始計時", "Inspect · first turn starts the clock");
  } else if (phase === "solving") {
    big.textContent = clock(now - startAt);
    note.textContent = tr(`${moves} 步`, `${moves} ${moves === 1 ? "move" : "moves"}`);
  }
  $("speedSize").textContent = `${size}×${size}`;
}

function loop() {
  cancelAnimationFrame(tick);
  if (phase !== "inspect" && phase !== "solving") return;
  if (phase === "inspect" && performance.now() - inspectAt >= INSPECT_MS) startClock(inspectAt + INSPECT_MS);
  render();
  tick = requestAnimationFrame(loop);
}

function startClock(at: number) {
  startAt = at;
  moves = 0;
  setPhase("solving");
}

function reset(n: number) {
  size = n;
  try {
    localStorage.setItem(SIZE_KEY, String(n));
  } catch {
    // not kept: 3×3 next time
  }
  view!.setState(n, solved(n));
  setPhase("idle");
  loop();
}

function scramble(tokens = scrambleTokens(size).join(" ")) {
  view!.setState(size, applyAlgorithm(solved(size), parseAlgorithm(tokens, size)));
  view!.resetView();
  inspectAt = performance.now();
  setPhase("inspect");
  loop();
}

function finish() {
  const ms = performance.now() - startAt;
  const before = best(loadRecords(size));
  saveRecord(size, { ms, moves, ts: Date.now() });
  setPhase("done");
  cancelAnimationFrame(tick);
  $("speedResultTime").textContent = clock(ms);
  $("speedResultBadge").textContent = before === null || ms < before ? tr("新紀錄", "New best") : tr("復原了", "Solved");
  const tps = moves / (ms / 1000);
  $("speedResultMoves").textContent = tr(`${moves} 步・每秒 ${tps.toFixed(1)} 步`, `${moves} moves · ${tps.toFixed(1)} per second`);
  renderRecords();
  renderSpeedCard();
}

function renderRecords() {
  const records = loadRecords(size);
  const b = best(records);
  $("speedRecordsTitle").textContent = tr(`最近成績・${size}×${size}`, `Recent · ${size}×${size}`);
  $("speedRecordList").innerHTML = records
    .slice(0, 5)
    .map((r, i) => `<li><span>${tr(`第 ${records.length - i} 次`, `#${records.length - i}`)}</span><b class="${r.ms === b ? "best" : ""}">${clock(r.ms)}</b></li>`)
    .join("");
  const ao5 = averageOf5(records);
  $("speedBest").textContent = `${tr("最佳", "Best")} ${b === null ? "—" : clock(b)}`;
  $("speedAvg").textContent = `${tr("5 次平均", "Avg of 5")} ${ao5 === null ? "—" : clock(ao5)}`;
}

/** The left pad: one finger turns the cube, two twist it round on the screen. */
function bindPad(pad: HTMLElement) {
  const fingers = new Map<number, { x: number; y: number }>();
  const angle = () => {
    const [a, b] = [...fingers.values()];
    return Math.atan2(b!.y - a!.y, b!.x - a!.x);
  };
  pad.addEventListener("pointerdown", (e) => {
    if ((e.target as HTMLElement).closest("button") || fingers.size >= 2) return;
    pad.setPointerCapture(e.pointerId);
    fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  });
  pad.addEventListener("pointermove", (e) => {
    const was = fingers.get(e.pointerId);
    if (!was) return;
    if (fingers.size === 1) {
      view!.turnView(e.clientX - was.x, e.clientY - was.y);
      fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      return;
    }
    const before = angle();
    fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    let d = angle() - before;
    if (d > Math.PI) d -= 2 * Math.PI;
    if (d < -Math.PI) d += 2 * Math.PI;
    view!.rollView(d);
  });
  const lift = (e: PointerEvent) => fingers.delete(e.pointerId);
  pad.addEventListener("pointerup", lift);
  pad.addEventListener("pointercancel", lift);
}

export function openSpeed() {
  const root = $("speed");
  root.classList.remove("hidden");
  document.documentElement.classList.add("speed-open");
  if (!view) {
    view = new CubeView($<HTMLCanvasElement>("speedCube"));
    view.setFreeView(true);
    view.setTwisting(true);
    view.viewDrag = false;
    view.showArrows = false;
    view.canTwist = () => {
      if (phase === "done") return false;
      pressAt = performance.now();
      return true;
    };
    view.onTwist = () => {
      if (phase === "inspect") startClock(pressAt);
      if (phase !== "solving") return;
      moves++;
      if (isSolved(view!.getState())) finish();
      else render();
    };
    bindPad($("speedPad"));
  }
  let n = 3;
  try {
    n = Number(localStorage.getItem(SIZE_KEY)) || 3;
  } catch {
    // 3×3
  }
  reset(SIZES.includes(n) ? n : 3);
}

function closeSpeed() {
  cancelAnimationFrame(tick);
  phase = "idle";
  $("speed").classList.add("hidden");
  document.documentElement.classList.remove("speed-open");
  renderSpeedCard();
}

export function initSpeed() {
  $("speedCard").onclick = openSpeed;
  for (const id of ["speedClose", "speedClose2"]) $(id).onclick = closeSpeed;
  $("speedScramble").onclick = () => scramble();
  $("speedAgain").onclick = () => scramble();
  $("speedSize").onclick = () => reset(SIZES[(SIZES.indexOf(size) + 1) % SIZES.length]!);
  $("speedScramble").textContent = tr("打亂", "Scramble");
  $("speedAgain").textContent = tr("再來一次", "Again");
  $("speedPadTitle").textContent = tr("拖這裡轉視角", "Drag here to turn the view");
  $("speedRotateTitle").textContent = tr("把手機轉成橫向", "Turn your phone sideways");
  $("speedRotateSub").textContent = tr("左手轉視角，右手轉方塊", "Left hand turns the view, right hand turns the cube");
  renderSpeedCard();
}

/** Hooks for the end-to-end test: a known scramble, and where a sticker is drawn. */
export const speedTest = {
  scramble: (tokens: string) => scramble(tokens),
  stickerPoint: (key: string) => view!.pointOf(key),
  get phase() {
    return phase;
  },
  get moves() {
    return moves;
  },
};
