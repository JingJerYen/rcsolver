import { ApiError, FACES, getHealth, recognize, type Face, type FaceImage, type RecognizeResponse } from "./api.js";
import { STEPS, captureFromFile, captureFromVideo, closeCamera, openCamera, turnsBefore } from "./capture.js";
import { GuideCube } from "./guideCube.js";
import { makeState, markBadCells, renderLegend, renderNet, type NetState } from "./net.js";
import { checkFacelets, faceletCell, netToFacelets } from "./cube3.js";
import { solve3, warmUp } from "./solver.js";
import { solve2 } from "./solvers/cube2.js";
import { solve4 } from "./solvers/cube4.js";
import { buildCentreTables } from "./solvers/cube4centers.js";
import { applyAlgorithm, fromNet, isSolved, parseAlgorithm, toNet, type Move } from "./cubeState.js";
import { CubeView } from "./cubeView.js";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const SCREENS = ["setup", "capture", "review", "result", "solveView"] as const;

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
    cubeView.setState(net.size, fromNet(net.size, net.current));
    cubeView.resetView();
    showScreen("solveView");
    renderSolve();
  }, 40);
}

/** R → R, R' → R′, 2R → 2R (inner slice), Rw → Rw (two layers). */
function pretty(token: string) {
  return token.replace("'", "′");
}

/**
 * Layer strip: one box per layer along the turn axis, the moving ones lit, laid out the way the
 * cube is seen: U above D, L left of R, F left of B, with the face letters at the two ends.
 */
function renderStrip(mv: Move | null) {
  const strip = $("strip");
  if (!mv || !net) {
    strip.innerHTML = "";
    return;
  }
  const n = net.size;
  const ends = mv.axis === 1 ? ["U", "D"] : mv.axis === 0 ? ["L", "R"] : ["F", "B"];
  // first box = U (+y) on top, L (-x) on the left, F (+z) on the left
  const first = mv.axis === 0 ? -1 : 1;
  const boxes: string[] = [];
  for (let i = 0; i < n; i++) {
    const coord = first * (n - 1 - 2 * i);
    boxes.push(`<i class="${mv.layers.includes(coord) ? "on" : ""}"></i>`);
  }
  strip.className = `strip ${mv.axis === 1 ? "" : "h"}`;
  strip.innerHTML = `<b>${ends[0]}</b>${boxes.join("")}<b>${ends[1]}</b>`;
}

function showMove(mv: Move | null) {
  $("move").textContent = mv ? pretty(mv.token) : "";
  $("angle").textContent = mv ? (Math.abs(mv.q) === 2 ? "180°" : "90°") : "";
  renderStrip(mv);
}

function renderSolve() {
  const done = moveIndex >= moves.length;
  $("progress").textContent = `${moveIndex} / ${moves.length}`;
  $("bar").style.width = `${moves.length ? (moveIndex / moves.length) * 100 : 100}%`;
  showMove(done ? null : moves[moveIndex]!);
  $<HTMLButtonElement>("prev").disabled = moveIndex === 0 || cubeView.animating;
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
$("closeSolve").onclick = homeFromSolve;
$("next").onclick = () => {
  stopPlaying();
  void step(1);
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
