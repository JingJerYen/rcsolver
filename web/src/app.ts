import { ApiError, FACES, getHealth, recognize, type Face, type FaceImage, type RecognizeResponse } from "./api.js";
import { STEPS, captureFromFile, captureFromVideo, closeCamera, openCamera, turnsBefore } from "./capture.js";
import { GuideCube } from "./guideCube.js";
import { accuracy, makeState, markBadCells, renderLegend, renderNet, type NetState } from "./net.js";
import { checkFacelets, faceletCell, netToFacelets } from "./cube3.js";
import { solve3, warmUp } from "./solver.js";
import { solve2 } from "./solvers/cube2.js";
import { solve4 } from "./solvers/cube4.js";
import { buildCentreTables } from "./solvers/cube4centers.js";
import { applyAlgorithm, fromNet, isSolved, parseAlgorithm, toNet, type Move } from "./cubeState.js";
import { CubeView } from "./cubeView.js";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

interface Run {
  ts: string;
  size: number;
  model: string;
  mock: boolean;
  ms: number;
  input_tokens: number | null;
  output_tokens: number | null;
  cells: number;
  corrected: number;
  correctedByFace: Record<Face, number>;
  lowConfidence: number;
  lowConfidenceCorrected: number;
  warnings: string[];
}

const RUNS_KEY = "rcsolver.runs";
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

function showScreen(id: (typeof SCREENS)[number]) {
  for (const s of SCREENS) $(s).classList.toggle("hidden", s !== id);
}

function loadRuns(): Run[] {
  try {
    return JSON.parse(localStorage.getItem(RUNS_KEY) ?? "[]") as Run[];
  } catch {
    return [];
  }
}

function saveRuns(runs: Run[]) {
  try {
    localStorage.setItem(RUNS_KEY, JSON.stringify(runs));
  } catch {
    /* storage unavailable: the table still shows this session */
  }
}

function renderRuns() {
  const runs = loadRuns();
  $("historyCount").textContent = runs.length ? `${runs.length}` : "";
  const tbody = $("runs").querySelector("tbody")!;
  tbody.innerHTML = runs
    .slice()
    .reverse()
    .map((r) => {
      const acc = ((1 - r.corrected / r.cells) * 100).toFixed(1);
      const tokens = r.input_tokens == null ? "–" : `${r.input_tokens}+${r.output_tokens}`;
      const hit = r.lowConfidence ? `${r.lowConfidenceCorrected}/${r.lowConfidence}` : "–";
      return `<tr><td>${r.ts.slice(5, 16).replace("T", " ")}</td><td>${r.size}×${r.size}</td><td>${r.mock ? "mock" : r.model}</td><td>${(r.ms / 1000).toFixed(1)}</td><td>${tokens}</td><td>${r.corrected}/${r.cells}</td><td>${acc}%</td><td>${hit}</td></tr>`;
    })
    .join("");
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

function showResult() {
  if (!response) return;
  size = response.size;
  net = makeState(size, response.recognition);
  showScreen("result");
  $("sizeBadge").textContent = `${size}×${size}`;
  $("invalidBadge").classList.add("hidden");
  renderNet($("net"), net, () => {
    markBadCells($("net"), []);
    $("invalidBadge").classList.add("hidden");
    refreshStats();
  });
  const sn = $("sizeNote");
  const mm = response.sizeMismatch;
  sn.classList.toggle("hidden", !mm);
  sn.textContent = mm ? `你選的是 ${mm.requested}×${mm.requested}，照片看起來是 ${mm.detected}×${mm.detected}，已改用 ${mm.detected}×${mm.detected} 辨識。` : "";
  const warn = $("warnings");
  warn.classList.toggle("hidden", response.warnings.length === 0);
  warn.textContent = response.warnings.length ? `顏色數量對不上：${response.warnings.join("；")}。` : "";
  $("notes").innerHTML = response.recognition.notes.map((n) => `<li>${escapeHtml(n)}</li>`).join("");
  $<HTMLButtonElement>("record").disabled = false;
  // Solving covers 2×2, 3×3 and 4×4 so far; other sizes stop at the checked net.
  $("solve").classList.toggle("hidden", !SOLVABLE.includes(size));
  // The 4×4 centre tables take a few seconds: build them while the user checks the net.
  if (size === 4) idle(() => buildCentreTables());
  refreshStats();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function refreshStats() {
  if (!net || !response) return;
  renderLegend($("legend"), net);
  const a = accuracy(net);
  const tokens = response.usage ? `${response.usage.input_tokens} + ${response.usage.output_tokens}` : "–";
  $("stats").innerHTML = [
    stat(`${a.corrected} / ${a.cells}`, "你改了幾格（= AI 讀錯）"),
    stat(`${((1 - a.corrected / a.cells) * 100).toFixed(1)}%`, "每格準確率"),
    stat(`${a.lowConfidenceCorrected} / ${a.lowConfidence}`, "紅框格裡真的錯的"),
    stat(`${(response.ms / 1000).toFixed(1)} s`, `${response.mock ? "mock" : response.model}`),
    stat(tokens, "input + output tokens"),
  ].join("");
}

function stat(value: string, label: string) {
  return `<div class="stat"><b>${value}</b><small>${label}</small></div>`;
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]!);
}

function recordRun() {
  if (!net || !response) return;
  const a = accuracy(net);
  const run: Run = {
    ts: new Date().toISOString(),
    size: response.size,
    model: response.model,
    mock: response.mock,
    ms: response.ms,
    input_tokens: response.usage?.input_tokens ?? null,
    output_tokens: response.usage?.output_tokens ?? null,
    ...a,
    warnings: response.warnings,
  };
  saveRuns([...loadRuns(), run]);
  renderRuns();
  $<HTMLButtonElement>("record").disabled = true;
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

function renderSolve() {
  const done = moveIndex >= moves.length;
  $("progress").textContent = `${moveIndex} / ${moves.length}`;
  $("bar").style.width = `${moves.length ? (moveIndex / moves.length) * 100 : 100}%`;
  $("move").textContent = done ? "" : pretty(moves[moveIndex]!.token);
  $<HTMLButtonElement>("prev").disabled = moveIndex === 0 || cubeView.animating;
  $<HTMLButtonElement>("next").disabled = done || cubeView.animating;
  $<HTMLButtonElement>("play").disabled = done;
  $("done").classList.toggle("hidden", !done);
  $("playIcon").classList.toggle("hidden", playing);
  $("pauseIcon").classList.toggle("hidden", !playing);
  if (done && !isSolved(cubeView.getState())) $("move").textContent = "?";
}

async function step(delta: 1 | -1) {
  if (cubeView.animating) return;
  const target = moveIndex + delta;
  if (target < 0 || target > moves.length) return;
  const mv = moves[delta === 1 ? moveIndex : moveIndex - 1]!;
  $("move").textContent = pretty(mv.token);
  renderSolve();
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
$("record").onclick = recordRun;
$("solve").onclick = startSolve;
$("closeSolve").onclick = () => {
  stopPlaying();
  showScreen("result");
};
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
$("copyRuns").onclick = async () => {
  const text = JSON.stringify(loadRuns(), null, 2);
  try {
    await navigator.clipboard.writeText(text);
    $("copyRuns").textContent = "已複製";
    setTimeout(() => ($("copyRuns").textContent = "複製紀錄 JSON"), 1500);
  } catch {
    prompt("複製下面的內容：", text);
  }
};
$("clearRuns").onclick = () => {
  if (loadRuns().length && confirm("確定清除所有實驗紀錄？")) {
    saveRuns([]);
    renderRuns();
  }
};

renderRuns();
getHealth()
  .then((h) => {
    const el = $("health");
    el.textContent = h.mock ? `MOCK (${h.mockReason})` : `${h.model} · ${h.dailyUsed}/${h.dailyLimit}`;
    el.classList.toggle("bad", h.mock);
  })
  .catch(() => {
    $("health").textContent = "✕ server";
    $("health").classList.add("bad");
  });
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
