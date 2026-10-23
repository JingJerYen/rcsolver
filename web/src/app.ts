import { ApiError, FACES, getHealth, recognize, type Face, type FaceImage, type RecognizeResponse } from "./api.js";
import { STEPS, captureFromFile, captureFromVideo, closeCamera, openCamera, turnsBefore } from "./capture.js";
import { GuideCube } from "./guideCube.js";
import { drawPhotoTips } from "./photoTips.js";
import { accuracy, makeState, markBadCells, renderLegend, renderNet, type NetState } from "./net.js";
import { renderFaceZoom } from "./faceZoom.js";
import { solveAsync, warmAsync } from "./solveClient.js";
import type { Cell, Segment, SolveMode } from "./solveAny.js";
import { chipsFor, describe, focusKeys, segmentAt } from "./guide.js";
import { fromFacelets } from "./facelets.js";
import { decodeShare, encodeShare } from "./share.js";
import { applyAlgorithm, fromNet, isSolved, parseAlgorithm, parseMove, toNet, type Move, type Sticker } from "./cubeState.js";
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
  /** What each stretch of the moves does, when the moves came from our solver. */
  segments?: Segment[];
  /** Solved with the teaching method (3×3 layer by layer). */
  teach?: boolean;
  /** Name the user gave it; without one the card shows when it was saved. */
  title?: string;
}
const SAVES_KEY = "rcsolver.saves";

/** "10/23 18:30"; a save from another year shows just its date, "2025/5/2", to fit on the card. */
function savedAt(ts: number): string {
  const d = new Date(ts);
  const two = (n: number) => String(n).padStart(2, "0");
  if (d.getFullYear() !== new Date().getFullYear()) return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
  return `${d.getMonth() + 1}/${d.getDate()} ${two(d.getHours())}:${two(d.getMinutes())}`;
}

function loadSaves(): Save[] {
  try {
    const list = JSON.parse(localStorage.getItem(SAVES_KEY) ?? "[]") as Save[];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function storeSaves(list: Save[]) {
  try {
    localStorage.setItem(SAVES_KEY, JSON.stringify(list));
  } catch {
    /* storage unavailable */
  }
}

/**
 * A short link that opens this page on the same cube and step. The solvers are deterministic, so
 * the moves ride along only when they differ from what the solver gives for this cube.
 */
async function shareLink(sv: Save): Promise<string> {
  const mode: SolveMode = sv.teach ? "teach" : "fast";
  const own = sv.moves.length ? await computeSolution(sv.size, sv.faces, mode) : null;
  const same = own !== null && own.length === sv.moves.length && own.every((t, i) => t === sv.moves[i]);
  const token = encodeShare({ size: sv.size, faces: sv.faces, index: sv.index, ...(same ? {} : { moves: sv.moves }), ...(sv.teach ? { teach: true } : {}) });
  return `${location.origin}${location.pathname}?openExternalBrowser=1#z=${token}`;
}

async function copyText(text: string, btn: HTMLElement) {
  try {
    await navigator.clipboard.writeText(text);
    btn.classList.add("ok");
    setTimeout(() => btn.classList.remove("ok"), 1500);
  } catch {
    prompt("", text);
  }
}

/** null = let the model count. After recognition this holds the size the model saw. */
let size: number | null = null;
let stepIndex = 0;
let images: Partial<Record<Face, FaceImage>> = {};
/** Faces the model could not see a cube in; shown red on the review thumbnails. */
let badFaces: Face[] = [];
/** Re-shooting one face from the review screen instead of running the whole sequence. */
let singleShot = false;
let response: RecognizeResponse | null = null;
let net: NetState | null = null;

const video = $<HTMLVideoElement>("video");
/**
 * In-app browsers (LINE, Facebook, Instagram…) refuse the live camera. The shutter then opens the
 * phone's own camera app through a file input instead, so every face can still be taken in place.
 */
let nativeCamera = false;

async function startPreview() {
  $("camError").classList.add("hidden");
  nativeCamera = false;
  try {
    await openCamera(video);
  } catch (err) {
    console.warn("live camera unavailable, using the camera app", err);
    nativeCamera = true;
    $("camError").classList.remove("hidden");
  }
}
const guide = new GuideCube($<HTMLCanvasElement>("guide"));
const cubeView = new CubeView($<HTMLCanvasElement>("cube"));
const previewView = new CubeView($<HTMLCanvasElement>("preview"));
let miniViews: CubeView[] = [];

/* ---------- empty-state hero: a 4×4 that keeps turning while the camera drifts ---------- */
const heroView = new CubeView($<HTMLCanvasElement>("heroCube"));
heroView.showArrows = false;
let heroOn = false;
let heroTimer = 0;
const HERO_TOKENS = ["U", "U'", "R", "R'", "F", "F'", "D", "L'", "B", "2U", "2U'", "2R", "2R'", "2F", "Rw", "Rw'", "Uw", "Fw'"];

function heroLoop() {
  if (!heroOn) return;
  const tok = HERO_TOKENS[Math.floor(Math.random() * HERO_TOKENS.length)]!;
  void heroView.animate(parseMove(tok, 4), 1, 650).then(() => {
    heroTimer = window.setTimeout(heroLoop, 250);
  });
}

function setHero(on: boolean) {
  $("hero").classList.toggle("hidden", !on);
  if (on === heroOn) return;
  heroOn = on;
  clearTimeout(heroTimer);
  if (on) {
    const colors: Record<Face, string> = { U: "W", R: "R", F: "G", D: "Y", L: "O", B: "B" };
    const solved = Object.fromEntries(FACES.map((f) => [f, Array.from({ length: 4 }, () => colors[f].repeat(4))])) as Record<Face, string[]>;
    heroView.setState(4, applyAlgorithm(fromNet(4, solved), parseAlgorithm("R 2U F' Rw2 D 2L' B U2 2F R'", 4)));
    heroView.resetView();
    heroView.orbit(0.0045);
    heroLoop();
  } else {
    heroView.orbit(0);
  }
}
const SHARE_ICON = `<svg viewBox="0 0 24 24" width="18" height="18"><circle cx="18" cy="5" r="2.5" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="6" cy="12" r="2.5" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="18" cy="19" r="2.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8.2 10.8l7.6-4.6M8.2 13.2l7.6 4.6" stroke="currentColor" stroke-width="2"/></svg>`;

function renderSaves() {
  const list = loadSaves();
  const root = $("saves");
  for (const v of miniViews) v.destroy();
  miniViews = [];
  root.innerHTML = "";
  root.classList.toggle("hidden", list.length === 0);
  setHero(list.length === 0);
  list.forEach((sv, i) => {
    const el = document.createElement("div");
    el.className = "save";
    el.innerHTML = `<canvas class="mini"></canvas><button type="button" class="save-title" aria-label="改標題"><span></span></button><span class="badge">${sv.size}×${sv.size} · ${sv.index}/${sv.moves.length}</span><button class="icon-btn share" aria-label="分享">${SHARE_ICON}</button><button class="del" aria-label="刪除">✕</button>`;
    el.querySelector(".save-title span")!.textContent = sv.title ?? savedAt(sv.ts);
    root.appendChild(el);
    const view = new CubeView(el.querySelector("canvas")!);
    miniViews.push(view);
    const start = fromNet(sv.size, sv.faces);
    view.setState(sv.size, applyAlgorithm(start, parseAlgorithm(sv.moves.slice(0, sv.index).join(" "), sv.size)));
    view.resetView();
    el.onclick = (e) => {
      const t = e.target as HTMLElement;
      if (t.closest(".del")) {
        const cur = loadSaves();
        cur.splice(i, 1);
        storeSaves(cur);
        renderSaves();
      } else if (t.closest(".save-title")) {
        renameSave(sv.ts);
      } else if (t.closest(".share")) {
        void shareLink(sv).then((link) => copyText(link, t.closest(".share") as HTMLElement));
      } else {
        openSave(i);
      }
    };
  });
}

/* Renaming a save: a dialog with a full-size input, since a 16px field does not fit on a card and a smaller one makes iOS zoom in. */
const titleDialog = $<HTMLDialogElement>("titleDialog");
const titleInput = $<HTMLInputElement>("titleInput");
let renaming = 0;

function renameSave(ts: number) {
  const sv = loadSaves().find((s) => s.ts === ts);
  if (!sv) return;
  renaming = ts;
  titleInput.value = sv.title ?? savedAt(sv.ts);
  titleInput.placeholder = savedAt(sv.ts);
  titleDialog.showModal();
  titleInput.select();
}

titleDialog.querySelector("form")!.onsubmit = () => {
  const list = loadSaves();
  const sv = list.find((s) => s.ts === renaming);
  if (!sv) return;
  const title = titleInput.value.trim();
  // cleared, or left at the time: go back to showing the time
  if (title && title !== savedAt(sv.ts)) sv.title = title;
  else delete sv.title;
  storeSaves(list);
  renderSaves();
};
$("titleCancel").onclick = () => titleDialog.close();

function saveCurrent() {
  if (!net) return;
  const entry: Save = { ts: Date.now(), size: net.size, faces: toNet(net.size, startState), moves: moves.map((m) => m.token), index: moveIndex, ...(segments ? { segments } : {}), ...(solveMode === "teach" ? { teach: true } : {}) };
  storeSaves([entry, ...loadSaves()]);
  renderSaves();
  const btn = $("save");
  btn.classList.add("ok");
  setTimeout(() => btn.classList.remove("ok"), 1500);
}

function openSave(i: number) {
  const sv = loadSaves()[i];
  if (sv) openSaved(sv);
}

/** Show a saved or shared solve at its step (or just the cube when it has no solution yet). */
function openSaved(sv: Save) {
  size = sv.size;
  images = {}; // photos from an earlier capture belong to another cube
  const confidence = Object.fromEntries(FACES.map((f) => [f, Array.from({ length: sv.size }, () => "9".repeat(sv.size))])) as Record<Face, string[]>;
  response = { ok: true, size: sv.size, sizeMismatch: null, recognition: { faces: sv.faces, confidence, notes: [] }, warnings: [], model: "saved", mock: false, ms: 0, usage: null };
  if (!sv.moves.length) {
    showResult();
    return;
  }
  net = makeState(sv.size, response.recognition);
  renderNet($("net"), net);
  moves = parseAlgorithm(sv.moves.join(" "), sv.size);
  segments = sv.segments ?? null;
  solveMode = sv.teach ? "teach" : "fast";
  if (sv.teach) guideOn = true;
  startState = fromNet(sv.size, sv.faces);
  moveIndex = Math.min(sv.index, moves.length);
  shownIndex = Math.max(0, Math.min(moves.length - 1, moveIndex - 1));
  cubeView.setState(sv.size, applyAlgorithm(startState, moves.slice(0, moveIndex)));
  cubeView.resetView();
  showScreen("solveView");
  renderSolve();
}

function showScreen(id: (typeof SCREENS)[number]) {
  for (const s of SCREENS) $(s).classList.toggle("hidden", s !== id);
  // the paste-a-state button lives in the header and only matters on the start screen
  $("import").classList.toggle("hidden", id !== "setup");
  setHero(id === "setup" && loadSaves().length === 0);
}

/* ---------- capture flow ---------- */

function thumbsHtml(current: number | null): string {
  return STEPS.map((s, i) => {
    const img = images[s.face];
    const bad = badFaces.includes(s.face);
    const cls = `thumb${img && !bad ? " ok" : img ? "" : " empty"}${bad ? " bad" : ""}${i === current ? " current" : ""}`;
    return `<div class="${cls}">${img ? `<img src="${img.dataUrl}" alt="${s.face}">` : ""}<span>${i + 1}</span></div>`;
  }).join("");
}

function renderStep() {
  const step = STEPS[stepIndex]!;
  // re-shooting one face: the corner button is a plain cancel back to the photos, not "home"
  $("cancelHome").classList.toggle("hidden", singleShot);
  $("cancelX").classList.toggle("hidden", !singleShot);
  $("stepCount").textContent = `${stepIndex + 1} / ${STEPS.length}`;
  guide.show(turnsBefore(stepIndex), { gestures: step.turns, target: step.face });
  $("thumbs").innerHTML = thumbsHtml(stepIndex);
  $<HTMLButtonElement>("redo").disabled = stepIndex === 0;
}

async function startCapture() {
  size = null; // the model counts the stickers itself
  images = {};
  badFaces = [];
  singleShot = false;
  for (const f of FACES) guide.setPhoto(f, null);
  stepIndex = 0;
  response = null;
  net = null;
  stopPlaying();
  showScreen("capture");
  renderStep();
  if (!tipsSeen()) showTips();
  await startPreview();
}

/* The wordless "how to shoot" card: once on the first capture, then behind the "?" button. */
const TIPS_KEY = "rcsolver.photoTips";
const tipsDialog = $<HTMLDialogElement>("tipsDialog");

function tipsSeen(): boolean {
  try {
    return localStorage.getItem(TIPS_KEY) === "1";
  } catch {
    return false;
  }
}

function showTips() {
  tipsDialog.showModal();
  drawPhotoTips(tipsDialog);
}

tipsDialog.addEventListener("close", () => {
  try {
    localStorage.setItem(TIPS_KEY, "1");
  } catch {
    /* private mode: the card just shows again next time */
  }
});

function acceptImage(img: FaceImage) {
  const face = STEPS[stepIndex]!.face;
  images[face] = img;
  guide.setPhoto(face, img.dataUrl);
  badFaces = badFaces.filter((f) => f !== face);
  if (singleShot) {
    finishCapture();
    return;
  }
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
  singleShot = false;
  showScreen("review");
  $("reviewThumbs").innerHTML = thumbsHtml(null);
  $("sendError").classList.toggle("hidden", !badFaces.length);
  $<HTMLButtonElement>("send").disabled = false;
}

/** Re-shoot just one face, then come back to the review screen. */
async function recapture(index: number) {
  singleShot = true;
  stepIndex = index;
  showScreen("capture");
  renderStep();
  $<HTMLButtonElement>("redo").disabled = true;
  await startPreview();
}

function cancelCapture() {
  closeCamera(video);
  guide.stop();
  if (singleShot) {
    finishCapture();
    return;
  }
  showScreen("setup");
}

/* ---------- recognition ---------- */

async function send() {
  const faces = images as Record<Face, FaceImage>;
  if (FACES.some((f) => !faces[f])) return;
  $<HTMLButtonElement>("send").disabled = true;
  $("sendError").classList.add("hidden");
  $("sendStatus").innerHTML = `<span class="spinner"></span>`;
  try {
    response = await recognize(size, faces);
  } catch (err) {
    // Any failure shows the same wordless warning and a shake; photos without a cube are also
    // marked, and tapping one re-shoots that face. The detail goes to the console only.
    if (err instanceof ApiError && err.code === "NO_CUBE") badFaces = err.faces.length ? err.faces : [...FACES];
    else console.error("recognize failed", err);
    $("reviewThumbs").innerHTML = thumbsHtml(null);
    $("sendStatus").textContent = "";
    $("sendError").classList.remove("hidden");
    const card = $("review");
    card.classList.remove("shake");
    void card.offsetWidth;
    card.classList.add("shake");
    $<HTMLButtonElement>("send").disabled = false;
    return;
  }
  $("sendStatus").textContent = "";
  showResult();
}

function onNetEdited() {
  if (!net) return;
  markBadCells($("net"), []);
  $("invalidBadge").classList.add("hidden");
  previewView.setState(net.size, fromNet(net.size, net.current));
  renderLegend($("legend"), net);
  $<HTMLButtonElement>("resetNet").disabled = accuracy(net).corrected === 0;
}

/** Put every sticker back to what the model read. */
function resetNet() {
  if (!net) return;
  for (const f of FACES) net.current[f] = [...net.original[f]];
  renderEditor();
  onNetEdited();
}

/** The face opened up for fixing, or null for the whole net. */
let zoomFace: Face | null = null;

function renderEditor() {
  if (!net) return;
  $("net").classList.toggle("hidden", zoomFace !== null);
  $("zoom").classList.toggle("hidden", zoomFace === null);
  const open = (f: Face | null) => {
    zoomFace = f;
    renderEditor();
  };
  if (zoomFace) {
    renderFaceZoom($("zoom"), net, { face: zoomFace, photo: images[zoomFace]?.dataUrl, onChange: onNetEdited, onFace: open, onBack: () => open(null) });
  } else {
    renderNet($("net"), net, open);
  }
}

function setEditor(open: boolean) {
  $("editor").classList.toggle("hidden", !open);
  $("fix").classList.toggle("on", open);
}

function showResult() {
  if (!response) return;
  const n = response.size;
  size = n;
  net = makeState(n, response.recognition);
  showScreen("result");
  $("sizeBadge").textContent = `${size}×${size}`;
  $("invalidBadge").classList.add("hidden");
  setEditor(false);
  previewView.setState(size, fromNet(size, net.current));
  previewView.resetView();
  zoomFace = null;
  renderEditor();
  renderLegend($("legend"), net);
  $<HTMLButtonElement>("resetNet").disabled = true;
  // a colour count that is off means at least one sticker is wrong: open the editor straight away
  if (response.warnings.length) setEditor(true);
  $("solve").classList.toggle("hidden", !SOLVABLE.includes(size));
  $("teach").classList.toggle("hidden", size !== 3);
  // The 4×4 centre tables take a few seconds to build and the bigger cubes fetch theirs: start now.
  idle(() => warmAsync(n));
  window.scrollTo({ top: 0, behavior: "smooth" });
}

/* ---------- solving ---------- */

let moves: Move[] = [];
let moveIndex = 0;
/** Cube as it was read, so any step can be reached by replaying the moves before it. */
let startState: Sticker[] = [];
let playing = false;
let playTimer = 0;
let turnMs = 1200;
/** Stages of the current solution (null when the moves did not come from our solver). */
let segments: Segment[] | null = null;
let solveMode: SolveMode = "fast";
/** Auto-play stops when this index is reached (the formula replay in the guide). */
let playUntil: number | null = null;
const GUIDE_KEY = "rcsolver.guide";
let guideOn = false;
try {
  guideOn = localStorage.getItem(GUIDE_KEY) === "1";
} catch {
  /* storage unavailable */
}
/** Move shown in the label, counter and sequence: the one being turned, which stays until the next turn starts. */
let shownIndex = 0;
/** Pause between moves during auto-play: a small button cycles through a few choices, remembered on this device. */
const GAP_KEY = "rcsolver.gap";
const GAP_CHOICES = [1000, 2000, 3000, 5000];
let playGapMs = 3000;
try {
  const saved = Number(localStorage.getItem(GAP_KEY));
  if (GAP_CHOICES.includes(saved)) playGapMs = saved;
} catch {
  /* storage unavailable */
}
function renderPace() {
  $("paceValue").textContent = `${playGapMs / 1000}s`;
}
const SOLVABLE = [2, 3, 4, 5, 6, 7];
const idle = window.requestIdleCallback ?? ((cb: () => void) => setTimeout(cb, 300));

function fail(badCells: { face: Face; row: number; col: number }[]) {
  // the impossible cells are marked on the whole net
  zoomFace = null;
  renderEditor();
  markBadCells($("net"), badCells);
  $("invalidBadge").classList.remove("hidden");
  setEditor(true);
  const card = $("result");
  card.classList.remove("shake");
  void card.offsetWidth;
  card.classList.add("shake");
  return null;
}

/* ---------- busy overlay: shown while a solve runs off the main thread ---------- */

function setBusy(on: boolean, fraction = 0) {
  $("busy").classList.toggle("hidden", !on);
  const bar = $("busyBar");
  // table loading reports real progress; the solve itself has none, so the bar then slides
  bar.classList.toggle("indeterminate", fraction >= 1);
  bar.style.width = `${Math.round(Math.min(fraction, 1) * 100)}%`;
}

async function computeSolution(size: number, n: Record<Face, string[]>, mode: SolveMode = "fast"): Promise<string[] | null> {
  const r = await solveAsync(size, n, undefined, mode);
  return r.ok ? r.moves : null;
}

/** Validate the checked net and solve it; on failure mark what is wrong and shake. */
async function trySolve(mode: SolveMode, onProgress?: (f: number) => void): Promise<{ moves: string[]; segments: Segment[] } | null> {
  if (!net) return null;
  const r = await solveAsync(net.size, net.current, onProgress, mode);
  return r.ok ? { moves: r.moves, segments: r.segments } : fail(r.badCells);
}

function startSolve(mode: SolveMode = "fast") {
  if (!net) return;
  const btn = $<HTMLButtonElement>("solve");
  btn.disabled = true;
  $<HTMLButtonElement>("teach").disabled = true;
  btn.innerHTML = `<span class="spinner"></span>`;
  setBusy(true);
  void (async () => {
    const solution = await trySolve(mode, (f) => setBusy(true, f));
    setBusy(false);
    btn.disabled = false;
    $<HTMLButtonElement>("teach").disabled = false;
    btn.textContent = "Go";
    if (!solution || !net) return;
    moves = parseAlgorithm(solution.moves.join(" "), net.size);
    segments = solution.segments;
    solveMode = mode;
    // the teaching solve is all about the explanations: open the guide with it
    if (mode === "teach") guideOn = true;
    moveIndex = 0;
    shownIndex = 0;
    startState = fromNet(net.size, net.current);
    cubeView.setState(net.size, startState);
    cubeView.resetView();
    showScreen("solveView");
    renderSolve();
  })();
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
function jumpTo(index: number, show = index) {
  if (!net || cubeView.animating) return;
  stopPlaying();
  moveIndex = Math.max(0, Math.min(moves.length, index));
  shownIndex = Math.max(0, Math.min(moves.length - 1, show));
  cubeView.setState(net.size, applyAlgorithm(startState, moves.slice(0, moveIndex)));
  renderSolve();
}

/** The whole solution as tokens: done ones green, the next one highlighted and scrolled into view. Tap one to jump there. */
function renderSequence() {
  const seq = $("sequence");
  seq.innerHTML = moves.map((m, i) => `<span class="token${i === shownIndex ? " next" : i < moveIndex ? " done" : ""}" data-i="${i}">${pretty(m.token)}</span>`).join("");
  const next = seq.querySelector<HTMLElement>(".token.next") ?? seq.lastElementChild;
  if (next instanceof HTMLElement) seq.scrollTo({ left: next.offsetLeft - seq.offsetLeft - seq.clientWidth / 2 + next.offsetWidth / 2, behavior: "smooth" });
}

function renderSolve() {
  const done = moveIndex >= moves.length;
  $("progress").textContent = `${moves.length ? shownIndex + 1 : 0} / ${moves.length}`;
  const slider = $<HTMLInputElement>("slider");
  slider.max = String(moves.length);
  slider.value = String(moveIndex);
  slider.style.setProperty("--p", `${moves.length ? (moveIndex / moves.length) * 100 : 100}%`);
  showMove(moves[shownIndex] ?? null);
  renderSequence();
  renderGuide();
  $<HTMLButtonElement>("prev").disabled = moveIndex === 0 || cubeView.animating;
  $<HTMLButtonElement>("next").disabled = done || cubeView.animating;
  $<HTMLButtonElement>("play").disabled = done;
  $("done").classList.toggle("hidden", !done);
  $("playIcon").classList.toggle("hidden", playing);
  $("pauseIcon").classList.toggle("hidden", !playing);
  if (done && !isSolved(cubeView.getState())) $("move").textContent = "?";
}

const CHIP_ICONS: Record<Segment["kind"], string> = {
  centres: `<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><rect x="8.5" y="8.5" width="7" height="7" fill="currentColor"/></svg>`,
  edges: `<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><rect x="9" y="3" width="6" height="5" fill="currentColor"/><rect x="9" y="16" width="6" height="5" fill="currentColor"/><rect x="3" y="9" width="5" height="6" fill="currentColor"/><rect x="16" y="9" width="5" height="6" fill="currentColor"/></svg>`,
  parity: `<svg viewBox="0 0 24 24"><path d="M4 9h13l-3-3M20 15H7l3 3" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  cube3: `<span>3×3</span>`,
  optimal: `<svg viewBox="0 0 24 24"><path d="M13 2L4 14h7l-1 8 9-12h-7z" fill="currentColor"/></svg>`,
  lbl: "", // teaching stages show their number instead
};

/**
 * Guide mode, behind the "?" button on the cube: stage chips, the cube with only this stage's
 * pieces in colour, and the explanation for the move being shown. Off by default.
 */
function renderGuide() {
  const row = $("stagesRow");
  const btn = $("guideBtn");
  btn.classList.toggle("hidden", !segments);
  btn.classList.toggle("on", guideOn);
  if (!segments || !net || !guideOn) {
    row.classList.add("hidden");
    $("guideText").classList.add("hidden");
    cubeView.setFocus(null);
    return;
  }
  row.classList.remove("hidden");
  const chips = chipsFor(segments);
  const at = Math.min(shownIndex, Math.max(0, moves.length - 1));
  $("stages").innerHTML = chips
    .map((c, i) => {
      const done = moveIndex >= c.to;
      const current = at >= c.from && at < c.to;
      const p = Math.max(0, Math.min(1, (moveIndex - c.from) / (c.to - c.from)));
      const icon = c.kind === "lbl" ? `<span>${c.stage}</span>` : CHIP_ICONS[c.kind];
      return `<button class="chip${done ? " complete" : ""}${current ? " current" : ""}" data-i="${i}" style="--p:${Math.round(p * 100)}%">${icon}</button>`;
    })
    .join("");
  const seg = segmentAt(segments, at);
  // only the pieces this stage works on keep their colours; the rest go grey
  if (seg?.kind === "lbl") cubeView.setFocus(seg.pieces ? { pieces: new Set(seg.pieces) } : null);
  else {
    const keys = focusKeys(seg, net.size);
    cubeView.setFocus(keys ? { keys } : null);
  }
  const text = $("guideText");
  text.classList.toggle("hidden", !seg);
  if (seg) {
    const d = describe(seg, net.size);
    $("guideTitle").textContent = d.title;
    $("guideBody").textContent = d.body;
    $("guideAlg").textContent = d.alg ?? "";
    $("guideAlgRow").classList.toggle("hidden", !d.alg);
  }
}

/** Watch the current formula again: back to the start of this segment, then play to its end. */
function replaySegment() {
  if (!segments || cubeView.animating) return;
  const seg = segmentAt(segments, Math.min(shownIndex, Math.max(0, moves.length - 1)));
  if (!seg) return;
  jumpTo(seg.from, seg.from);
  playUntil = seg.to;
  playing = true;
  renderSolve();
  void step(1);
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
  shownIndex = delta === 1 ? moveIndex : moveIndex - 1;
  const mv = moves[shownIndex]!;
  renderSolve();
  await cubeView.animate(mv, delta, Math.abs(mv.q) === 2 ? turnMs * 1.4 : turnMs);
  moveIndex = target;
  renderSolve();
  if (playing) {
    if (moveIndex >= moves.length || (playUntil !== null && moveIndex >= playUntil)) stopPlaying();
    else playTimer = window.setTimeout(() => void step(1), playGapMs);
  }
}

function stopPlaying() {
  playing = false;
  playUntil = null;
  clearTimeout(playTimer);
  if (!$("solveView").classList.contains("hidden")) renderSolve();
}

/* ---------- wiring ---------- */

$("start").onclick = () => void startCapture();
$("cancel").onclick = cancelCapture;
$("tips").onclick = showTips;
$("shoot").onclick = () => {
  if (nativeCamera) {
    $<HTMLInputElement>("fileCapture").click();
    return;
  }
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
const onFilePicked = async (e: Event) => {
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
$<HTMLInputElement>("file").onchange = onFilePicked;
$<HTMLInputElement>("fileCapture").onchange = onFilePicked;
$("send").onclick = () => void send();
$("homeReview").onclick = () => showScreen("setup");
$("homeResult").onclick = () => showScreen("setup");
$("reviewThumbs").onclick = (e) => {
  const el = (e.target as HTMLElement).closest(".thumb");
  if (!el) return;
  const i = Array.from($("reviewThumbs").children).indexOf(el);
  if (i >= 0) void recapture(i);
};
$("retake").onclick = () => void startCapture();
$("again").onclick = () => void startCapture();
$("solve").onclick = () => startSolve("fast");
$("teach").onclick = () => startSolve("teach");
$("replayAlg").onclick = replaySegment;
$("fix").onclick = () => setEditor($("editor").classList.contains("hidden"));
$("shareResult").onclick = () => {
  if (!net) return;
  const sv: Save = { ts: Date.now(), size: net.size, faces: net.current, moves: [], index: 0 };
  void shareLink(sv).then((link) => copyText(link, $("shareResult")));
};
$("resetNet").onclick = resetNet;
/** The import dialog takes a facelet string or a shared link; the clipboard is offered as a starting point. */
const importDialog = $<HTMLDialogElement>("importDialog");
const importText = $<HTMLTextAreaElement>("importText");
$("import").onclick = async () => {
  $("importError").classList.add("hidden");
  importText.value = "";
  try {
    const clip = (await navigator.clipboard.readText()).trim();
    if (clip && (clip.includes("#s=") || clip.includes("#z=") || fromFacelets(clip))) importText.value = clip;
  } catch {
    /* no clipboard access: the user pastes by hand */
  }
  importDialog.showModal();
  importText.focus();
};
$("importCancel").onclick = () => importDialog.close();
$("importDialog").querySelector("form")!.onsubmit = (e) => {
  e.preventDefault();
  const text = importText.value.trim();
  // a shared link: take the state (and solution) out of its hash
  const hash = text.includes("#") ? text.slice(text.indexOf("#") + 1) : "";
  const q = new URLSearchParams(hash);
  // a shared link (compact z token or the older s/m/i form) goes through the link opener
  const isLink = q.get("z") ? decodeShare(q.get("z")!) !== null : q.get("s") ? fromFacelets(q.get("s")!) !== null : false;
  if (isLink) {
    importDialog.close();
    location.hash = hash;
    void openSharedLink();
    return;
  }
  const parsed = fromFacelets(text);
  if (!parsed) {
    $("importError").classList.remove("hidden");
    return;
  }
  importDialog.close();
  const confidence = Object.fromEntries(FACES.map((f) => [f, Array.from({ length: parsed.size }, () => "9".repeat(parsed.size))])) as Record<Face, string[]>;
  response = { ok: true, size: parsed.size, sizeMismatch: null, recognition: { faces: parsed.net, confidence, notes: [] }, warnings: [], model: "import", mock: false, ms: 0, usage: null };
  showResult();
};
$("closeSolve").onclick = homeFromSolve;
$("next").onclick = () => {
  stopPlaying();
  void step(1);
};
$<HTMLInputElement>("slider").oninput = (e) => {
  const v = Number((e.target as HTMLInputElement).value);
  if (cubeView.animating) {
    (e.target as HTMLInputElement).value = String(moveIndex);
    return;
  }
  jumpTo(v, Math.max(0, v - 1));
};
$("stages").onclick = (e) => {
  const chip = (e.target as HTMLElement).closest<HTMLElement>(".chip");
  if (!chip || !segments) return;
  const c = chipsFor(segments)[Number(chip.dataset.i)];
  if (c) jumpTo(c.from, c.from);
};
$("guideBtn").onclick = () => {
  guideOn = !guideOn;
  try {
    localStorage.setItem(GUIDE_KEY, guideOn ? "1" : "0");
  } catch {
    /* storage unavailable */
  }
  renderGuide();
};
$("pace").onclick = () => {
  playGapMs = GAP_CHOICES[(GAP_CHOICES.indexOf(playGapMs) + 1) % GAP_CHOICES.length]!;
  renderPace();
  try {
    localStorage.setItem(GAP_KEY, String(playGapMs));
  } catch {
    /* storage unavailable */
  }
};
renderPace();
$("save").onclick = saveCurrent;
$("shareSolve").onclick = () => {
  if (!net) return;
  const sv: Save = { ts: Date.now(), size: net.size, faces: toNet(net.size, startState), moves: moves.map((m) => m.token), index: moveIndex, ...(solveMode === "teach" ? { teach: true } : {}) };
  void shareLink(sv).then((link) => copyText(link, $("shareSolve")));
};
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
$("copySeq").onclick = () => copyText(moves.map((m) => m.token).join(" "), $("copySeq"));
// A shared link carries the cube (s), its solution (m) and the step reached (i) in the hash.
async function openSharedLink() {
  const q = new URLSearchParams(location.hash.slice(1));
  const z = q.get("z") ? decodeShare(q.get("z")!) : null;
  if (z) {
    stopPlaying();
    // no moves in the token: the solver reproduces them (the same solution the sender had)
    let moves = z.moves;
    let segs: Segment[] | undefined;
    if (!moves) {
      setBusy(true);
      const r = await solveAsync(z.size, z.faces, (f) => setBusy(true, f), z.teach ? "teach" : "fast");
      setBusy(false);
      moves = r.ok ? r.moves : [];
      if (r.ok) segs = r.segments;
    }
    openSaved({ ts: Date.now(), size: z.size, faces: z.faces, moves, index: z.index, ...(segs ? { segments: segs } : {}), ...(z.teach ? { teach: true } : {}) });
    history.replaceState(null, "", location.pathname);
    return;
  }
  const parsed = q.get("s") ? fromFacelets(q.get("s")!) : null;
  if (!parsed) return;
  const tokens = (q.get("m") ?? "").split(/\s+/).filter(Boolean);
  let ok = true;
  try {
    parseAlgorithm(tokens.join(" "), parsed.size);
  } catch {
    ok = false;
  }
  stopPlaying();
  openSaved({ ts: Date.now(), size: parsed.size, faces: parsed.net, moves: ok ? tokens : [], index: Number(q.get("i") ?? 0) || 0 });
  history.replaceState(null, "", location.pathname);
}
// LINE's in-app browser has no live camera, but it opens any link carrying this flag in the
// phone's real browser: send ourselves there once, keeping the shared cube in the hash.
if (/\bLine\//i.test(navigator.userAgent) && !location.search.includes("openExternalBrowser")) {
  location.replace(`${location.pathname}?openExternalBrowser=1${location.hash}`);
}
showScreen("setup");
void openSharedLink();
window.addEventListener("hashchange", () => void openSharedLink());
getHealth()
  .then((h) => $("mock").classList.toggle("hidden", !h.mock))
  .catch(() => undefined);
// Start the solver worker and its 3×3 tables while the user is busy taking photos.
idle(() => warmAsync(3));

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
