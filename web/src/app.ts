import { ApiError, FACES, getHealth, recognize, type Face, type FaceImage, type RecognizeResponse } from "./api.js";
import { STEPS, captureFromFile, captureFromVideo, closeCamera, openCamera, turnsBefore } from "./capture.js";
import { GuideCube } from "./guideCube.js";
import { makeState, markBadCells, renderLegend, renderNet, type NetState } from "./net.js";
import { checkFacelets, faceletCell, netToFacelets } from "./cube3.js";
import { solve3, warmUp } from "./solver.js";
import { solve2 } from "./solvers/cube2.js";
import { solve4 } from "./solvers/cube4.js";
import { buildCentreTables } from "./solvers/cube4centers.js";
import { fromFacelets, toFacelets } from "./facelets.js";
import { applyAlgorithm, fromNet, isSolved, parseAlgorithm, toNet, type Move, type Sticker } from "./cubeState.js";
import { CubeView } from "./cubeView.js";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const SCREENS = ["setup", "capture", "review", "result", "solveView"] as const;

/* ---------- saved solves (this browser only, newest first, three at most) ---------- */

interface Save {
  ts: number;
  size: number;
  faces: Record<Face, string[]>;
  moves: string[];
  index: number;
}
const SAVES_KEY = "rcsolver.saves";
const MAX_SAVES = 3;

function loadSaves(): Save[] {
  try {
    const list = JSON.parse(localStorage.getItem(SAVES_KEY) ?? "[]") as Save[];
    return Array.isArray(list) ? list.slice(0, MAX_SAVES) : [];
  } catch {
    return [];
  }
}

function storeSaves(list: Save[]) {
  try {
    localStorage.setItem(SAVES_KEY, JSON.stringify(list.slice(0, MAX_SAVES)));
  } catch {
    /* storage unavailable */
  }
}

/** null = let the model count. After recognition this holds the size the model saw. */
let size: number | null = null;
let stepIndex = 0;
let images: Partial<Record<Face, FaceImage>> = {};
let response: RecognizeResponse | null = null;
let net: NetState | null = null;

const video = $<HTMLVideoElement>("video");
const guide = new GuideCube($<HTMLCanvasElement>("guide"));
const cubeView = new CubeView($<HTMLCanvasElement>("cube"));
const previewView = new CubeView($<HTMLCanvasElement>("preview"));
const miniViews = Array.from(document.querySelectorAll<HTMLCanvasElement>("#saves .mini"), (c) => new CubeView(c));

function renderSaves() {
  const list = loadSaves();
  $("saves").classList.toggle("hidden", list.length === 0);
  document.querySelectorAll<HTMLElement>("#saves .save").forEach((el, i) => {
    const sv = list[i];
    el.classList.toggle("hidden", !sv);
    if (!sv) return;
    el.querySelector(".badge")!.textContent = `${sv.size}×${sv.size} · ${sv.index}/${sv.moves.length}`;
    const start = fromNet(sv.size, sv.faces);
    miniViews[i]!.setState(sv.size, applyAlgorithm(start, parseAlgorithm(sv.moves.slice(0, sv.index).join(" "), sv.size)));
    miniViews[i]!.resetView();
  });
}

function saveCurrent() {
  if (!net) return;
  const entry: Save = { ts: Date.now(), size: net.size, faces: toNet(net.size, startState), moves: moves.map((m) => m.token), index: moveIndex };
  storeSaves([entry, ...loadSaves()]);
  renderSaves();
  const btn = $("save");
  btn.classList.add("ok");
  setTimeout(() => btn.classList.remove("ok"), 1500);
}

function openSave(i: number) {
  const sv = loadSaves()[i];
  if (!sv) return;
  size = sv.size;
  const confidence = Object.fromEntries(FACES.map((f) => [f, Array.from({ length: sv.size }, () => "9".repeat(sv.size))])) as Record<Face, string[]>;
  response = { ok: true, size: sv.size, sizeMismatch: null, recognition: { faces: sv.faces, confidence, notes: [] }, warnings: [], model: "saved", mock: false, ms: 0, usage: null };
  net = makeState(sv.size, response.recognition);
  renderNet($("net"), net, () => undefined);
  moves = parseAlgorithm(sv.moves.join(" "), sv.size);
  startState = fromNet(sv.size, sv.faces);
  moveIndex = Math.min(sv.index, moves.length);
  cubeView.setState(sv.size, applyAlgorithm(startState, moves.slice(0, moveIndex)));
  cubeView.resetView();
  showScreen("solveView");
  renderSolve();
}

function showScreen(id: (typeof SCREENS)[number]) {
  for (const s of SCREENS) $(s).classList.toggle("hidden", s !== id);
}

/* ---------- capture flow ---------- */

function thumbsHtml(current: number | null): string {
  return STEPS.map((s, i) => {
    const img = images[s.face];
    const cls = `thumb${img ? " ok" : " empty"}${i === current ? " current" : ""}`;
    return `<div class="${cls}">${img ? `<img src="${img.dataUrl}" alt="${s.face}">` : ""}<span>${i + 1}</span></div>`;
  }).join("");
}

function renderStep() {
  const step = STEPS[stepIndex]!;
  $("stepCount").textContent = `${stepIndex + 1} / ${STEPS.length}`;
  guide.show(turnsBefore(stepIndex), { gestures: step.turns, target: step.face });
  $("thumbs").innerHTML = thumbsHtml(stepIndex);
  $<HTMLButtonElement>("redo").disabled = stepIndex === 0;
}

async function startCapture() {
  const picked = $<HTMLSelectElement>("size").value;
  size = picked ? Number(picked) : null;
  $("frame").style.setProperty("--n", String(size ?? 1));
  images = {};
  for (const f of FACES) guide.setPhoto(f, null);
  stepIndex = 0;
  response = null;
  net = null;
  stopPlaying();
  showScreen("capture");
  renderStep();
  $("camError").classList.add("hidden");
  $<HTMLButtonElement>("shoot").disabled = false;
  try {
    await openCamera(video);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    $("camError").textContent = `📷 ✕  ${msg}`;
    $("camError").classList.remove("hidden");
    $<HTMLButtonElement>("shoot").disabled = true;
  }
}

function acceptImage(img: FaceImage) {
  images[STEPS[stepIndex]!.face] = img;
  guide.setPhoto(STEPS[stepIndex]!.face, img.dataUrl);
  if (stepIndex < STEPS.length - 1) {
    stepIndex++;
    renderStep();
  } else {
    finishCapture();
  }
}

function finishCapture() {
  closeCamera(video);
  guide.stop();
  showScreen("review");
  $("reviewThumbs").innerHTML = thumbsHtml(null);
  $("sendStatus").textContent = "";
  $<HTMLButtonElement>("send").disabled = false;
}

function cancelCapture() {
  closeCamera(video);
  guide.stop();
  showScreen("setup");
}

/* ---------- recognition ---------- */

async function send() {
  const faces = images as Record<Face, FaceImage>;
  if (FACES.some((f) => !faces[f])) return;
  $<HTMLButtonElement>("send").disabled = true;
  $("sendStatus").innerHTML = `<span class="spinner"></span>`;
  try {
    response = await recognize(size, faces);
  } catch (err) {
    const msg = err instanceof ApiError ? `${err.message}（${err.code}）` : err instanceof Error ? err.message : String(err);
    $("sendStatus").textContent = `✕ ${msg}`;
    $<HTMLButtonElement>("send").disabled = false;
    return;
  }
  $("sendStatus").textContent = "";
  showResult();
}

function setEditor(open: boolean) {
  $("editor").classList.toggle("hidden", !open);
  $("fix").classList.toggle("on", open);
}

function showResult() {
  if (!response) return;
  size = response.size;
  net = makeState(size, response.recognition);
  showScreen("result");
  $("sizeBadge").textContent = `${size}×${size}`;
  $("invalidBadge").classList.add("hidden");
  setEditor(false);
  previewView.setState(size, fromNet(size, net.current));
  previewView.resetView();
  renderNet($("net"), net, () => {
    markBadCells($("net"), []);
    $("invalidBadge").classList.add("hidden");
    if (net) previewView.setState(net.size, fromNet(net.size, net.current));
    if (net) renderLegend($("legend"), net);
  });
  renderLegend($("legend"), net);
  // a colour count that is off means at least one sticker is wrong: open the editor straight away
  if (response.warnings.length) setEditor(true);
  // Solving covers 2×2, 3×3 and 4×4 so far; other sizes stop at the checked net.
  $("solve").classList.toggle("hidden", !SOLVABLE.includes(size));
  // The 4×4 centre tables take a few seconds: build them while the user checks the net.
  if (size === 4) idle(() => buildCentreTables());
  window.scrollTo({ top: 0, behavior: "smooth" });
}

/* ---------- solving ---------- */

let moves: Move[] = [];
let moveIndex = 0;
/** Cube as it was read, so any step can be reached by replaying the moves before it. */
let startState: Sticker[] = [];
let playing = false;
let playTimer = 0;
let turnMs = 900;
let playGapMs = 700;
const SOLVABLE = [2, 3, 4];
const idle = window.requestIdleCallback ?? ((cb: () => void) => setTimeout(cb, 300));

function fail(badCells: { face: Face; row: number; col: number }[]) {
  markBadCells($("net"), badCells);
  $("invalidBadge").classList.remove("hidden");
  setEditor(true);
  const card = $("result");
  card.classList.remove("shake");
  void card.offsetWidth;
  card.classList.add("shake");
  return null;
}

/** Validate the checked net and solve it; on failure mark what is wrong and shake. */
function trySolve(): string[] | null {
  if (!net) return null;
  const n = net.current;
  let solution: string[];
  if (net.size === 3) {
    const conv = netToFacelets(n);
    if (!conv) return fail(FACES.map((face) => ({ face, row: 1, col: 1 })));
    const v = checkFacelets(conv.facelets);
    if (!v.ok) return fail(v.badFacelets.map(faceletCell));
    try {
      solution = solve3(conv.facelets);
    } catch {
      return fail([]);
    }
  } else if (net.size === 2) {
    const r = solve2(n);
    if (!r.ok) return fail(r.badFacelets.map((i) => ({ face: FACES[Math.floor(i / 4)]!, row: Math.floor((i % 4) / 2), col: i % 2 })));
    solution = r.moves;
  } else if (net.size === 4) {
    const r = solve4(n);
    if (!r.ok) return fail(r.badCells);
    solution = r.moves;
  } else {
    return null;
  }
  // Belt and braces: replay the solution on our own model before showing it.
  if (!isSolved(applyAlgorithm(fromNet(net.size, n), parseAlgorithm(solution.join(" "), net.size)))) return fail([]);
  return solution;
}

function startSolve() {
  if (!net) return;
  const btn = $<HTMLButtonElement>("solve");
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner"></span>`;
  // let the spinner paint before the (possibly multi-second) solve runs
  setTimeout(() => {
    const solution = trySolve();
    btn.disabled = false;
    btn.textContent = "Go";
    if (!solution || !net) return;
    moves = parseAlgorithm(solution.join(" "), net.size);
    moveIndex = 0;
    startState = fromNet(net.size, net.current);
    cubeView.setState(net.size, startState);
    cubeView.resetView();
    showScreen("solveView");
    renderSolve();
  }, 40);
}

/** R → R, R' → R′, 2R → 2R (inner slice), Rw → Rw (two layers). */
function pretty(token: string) {
  return token.replace("'", "′");
}

function showMove(mv: Move | null) {
  $("move").textContent = mv ? pretty(mv.token) : "";
  $("angle").textContent = mv ? (Math.abs(mv.q) === 2 ? "180°" : "90°") : "";
}

/** Jump straight to step `index` (0 = as read), without animation. */
function jumpTo(index: number) {
  if (!net || cubeView.animating) return;
  stopPlaying();
  moveIndex = Math.max(0, Math.min(moves.length, index));
  cubeView.setState(net.size, applyAlgorithm(startState, moves.slice(0, moveIndex)));
  renderSolve();
}

/** The whole solution as tokens: done ones green, the next one highlighted and scrolled into view. Tap one to jump there. */
function renderSequence() {
  const seq = $("sequence");
  seq.innerHTML = moves.map((m, i) => `<span class="token${i < moveIndex ? " done" : i === moveIndex ? " next" : ""}" data-i="${i}">${pretty(m.token)}</span>`).join("");
  seq.querySelector(".token.next")?.scrollIntoView({ block: "nearest" });
}

function renderSolve() {
  const done = moveIndex >= moves.length;
  $("progress").textContent = `${moveIndex} / ${moves.length}`;
  $("bar").style.width = `${moves.length ? (moveIndex / moves.length) * 100 : 100}%`;
  showMove(done ? null : moves[moveIndex]!);
  renderSequence();
  $<HTMLButtonElement>("prev").disabled = moveIndex === 0 || cubeView.animating;
  $<HTMLButtonElement>("rewind").disabled = moveIndex === 0 || cubeView.animating;
  $<HTMLButtonElement>("next").disabled = done || cubeView.animating;
  $<HTMLButtonElement>("play").disabled = done;
  $("done").classList.toggle("hidden", !done);
  $("playIcon").classList.toggle("hidden", playing);
  $("pauseIcon").classList.toggle("hidden", !playing);
  if (done && !isSolved(cubeView.getState())) $("move").textContent = "?";
}

/** A home tap while solving needs a second tap within 3 s, so a stray touch does not throw the solve away. */
let homeArmed = 0;
function homeFromSolve() {
  const btn = $("closeSolve");
  if (Date.now() - homeArmed < 3000) {
    btn.classList.remove("confirm");
    homeArmed = 0;
    stopPlaying();
    showScreen("setup");
    return;
  }
  homeArmed = Date.now();
  btn.classList.add("confirm");
  setTimeout(() => {
    if (Date.now() - homeArmed >= 2900) btn.classList.remove("confirm");
  }, 3000);
}

async function step(delta: 1 | -1) {
  if (cubeView.animating) return;
  const target = moveIndex + delta;
  if (target < 0 || target > moves.length) return;
  const mv = moves[delta === 1 ? moveIndex : moveIndex - 1]!;
  renderSolve();
  showMove(mv);
  await cubeView.animate(mv, delta, turnMs);
  moveIndex = target;
  renderSolve();
  if (playing) {
    if (moveIndex >= moves.length) stopPlaying();
    else playTimer = window.setTimeout(() => void step(1), playGapMs);
  }
}

function stopPlaying() {
  playing = false;
  clearTimeout(playTimer);
  if (!$("solveView").classList.contains("hidden")) renderSolve();
}

/* ---------- wiring ---------- */

$("start").onclick = () => void startCapture();
$("cancel").onclick = cancelCapture;
$("shoot").onclick = () => {
  try {
    acceptImage(captureFromVideo(video));
  } catch (err) {
    alert(err instanceof Error ? err.message : String(err));
  }
};
$("redo").onclick = () => {
  if (stepIndex > 0) {
    stepIndex--;
    delete images[STEPS[stepIndex]!.face];
    guide.setPhoto(STEPS[stepIndex]!.face, null);
    renderStep();
  }
};
$<HTMLInputElement>("file").onchange = async (e) => {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  try {
    acceptImage(await captureFromFile(file));
  } catch (err) {
    alert(err instanceof Error ? err.message : String(err));
  }
};
$("send").onclick = () => void send();
$("retake").onclick = () => void startCapture();
$("again").onclick = () => void startCapture();
$("solve").onclick = startSolve;
$("fix").onclick = () => setEditor($("editor").classList.contains("hidden"));
$("copyState").onclick = async () => {
  if (!net) return;
  // face letters when the stickers map to faces, otherwise the raw colour letters
  const text = toFacelets(net.current, net.size) ?? FACES.map((f) => net!.current[f].join("")).join("");
  const btn = $("copyState");
  try {
    await navigator.clipboard.writeText(text);
    btn.classList.add("ok");
    setTimeout(() => btn.classList.remove("ok"), 1500);
  } catch {
    prompt("", text);
  }
};
$("import").onclick = () => {
  const text = prompt("", "");
  if (!text) return;
  const parsed = fromFacelets(text);
  if (!parsed) {
    const btn = $("import");
    btn.classList.add("confirm");
    setTimeout(() => btn.classList.remove("confirm"), 1200);
    return;
  }
  const confidence = Object.fromEntries(FACES.map((f) => [f, Array.from({ length: parsed.size }, () => "9".repeat(parsed.size))])) as Record<Face, string[]>;
  response = { ok: true, size: parsed.size, sizeMismatch: null, recognition: { faces: parsed.net, confidence, notes: [] }, warnings: [], model: "import", mock: false, ms: 0, usage: null };
  showResult();
};
$("closeSolve").onclick = homeFromSolve;
$("next").onclick = () => {
  stopPlaying();
  void step(1);
};
$("rewind").onclick = () => jumpTo(0);
$("save").onclick = saveCurrent;
document.querySelectorAll<HTMLElement>("#saves .save").forEach((el, i) => {
  el.onclick = (e) => {
    if ((e.target as HTMLElement).classList.contains("del")) {
      const list = loadSaves();
      list.splice(i, 1);
      storeSaves(list);
      renderSaves();
      return;
    }
    openSave(i);
  };
});
renderSaves();
$("sequence").onclick = (e) => {
  const t = (e.target as HTMLElement).closest(".token") as HTMLElement | null;
  if (t?.dataset.i) jumpTo(Number(t.dataset.i));
};
$("prev").onclick = () => {
  stopPlaying();
  void step(-1);
};
$("play").onclick = () => {
  if (playing) {
    stopPlaying();
    return;
  }
  playing = true;
  renderSolve();
  void step(1);
};
$("restart").onclick = () => void startCapture();
$("copySeq").onclick = async () => {
  const text = moves.map((m) => m.token).join(" ");
  const btn = $("copySeq");
  try {
    await navigator.clipboard.writeText(text);
    btn.classList.add("ok");
    setTimeout(() => btn.classList.remove("ok"), 1500);
  } catch {
    prompt("", text);
  }
};
getHealth()
  .then((h) => $("mock").classList.toggle("hidden", !h.mock))
  .catch(() => undefined);
// Build the solver tables while the user is busy taking photos.
(window.requestIdleCallback ?? ((cb: () => void) => setTimeout(cb, 500)))(() => warmUp());

/** Hooks for the end-to-end test: feed a recognised net without the camera. */
(window as unknown as { rcsolverTest: unknown }).rcsolverTest = {
  showNet(s: number, r: RecognizeResponse["recognition"]) {
    response = { ok: true, size: s, sizeMismatch: null, recognition: r, warnings: [], model: "test", mock: true, ms: 0, usage: null };
    showResult();
  },
  get moves() {
    return moves.map((m) => m.token);
  },
  get moveIndex() {
    return moveIndex;
  },
  get solved() {
    return isSolved(cubeView.getState());
  },
  setSpeed(turn: number, gap: number) {
    turnMs = turn;
    playGapMs = gap;
  },
  /** A random scramble of the given size as a fake recognition result. */
  scramble(s: number, seed: number) {
    const colors: Record<Face, string> = { U: "W", R: "R", F: "G", D: "Y", L: "O", B: "B" };
    const solved = Object.fromEntries(FACES.map((f) => [f, Array.from({ length: s }, () => colors[f].repeat(s))])) as Record<Face, string[]>;
    let x = seed >>> 0 || 1;
    const rand = () => (x = (x * 1664525 + 1013904223) >>> 0) / 2 ** 32;
    const faces = ["U", "R", "F", "D", "L", "B"];
    const tokens: string[] = [];
    for (let i = 0; i < 40; i++) {
      const f = faces[Math.floor(rand() * 6)]!;
      const layer = s >= 4 && rand() < 0.4 ? "2" : "";
      tokens.push(`${layer}${f}${["", "'", "2"][Math.floor(rand() * 3)]}`);
    }
    const cube = applyAlgorithm(fromNet(s, solved), parseAlgorithm(tokens.join(" "), s));
    const net = toNet(s, cube);
    const confidence = Object.fromEntries(FACES.map((f) => [f, Array.from({ length: s }, () => "9".repeat(s))])) as Record<Face, string[]>;
    return { size: s, recognition: { faces: net, confidence, notes: [] } };
  },
};
