import { ApiError, FACES, askMacro, getHealth, recognize, type Face, type FaceImage, type RecognizeResponse } from "./api.js";
import { STEPS, captureFromFile, captureFromVideo, closeCamera, openCamera, turnsBefore } from "./capture.js";
import { GuideCube } from "./guideCube.js";
import { drawPhotoTips, speakPhotoTip, stopPhotoTip } from "./photoTips.js";
import { UNKNOWN, accuracy, blankRecognition, makeState, markBadCells, renderLegend, renderNet, unknownCount, type NetState } from "./net.js";
import { renderFaceZoom } from "./faceZoom.js";
import { localizePage, tr } from "./i18n.js";
import { deltaTurn, describeMark, keypadHtml, pushMove, readMoves, scrambleTokens, setWheelStudy, studyMove, tokenize, tokensThrough, twistToken, wheelScrambleTokens } from "./study.js";
import { solveAsync, warmAsync } from "./solveClient.js";
import type { Cell, Segment } from "./solveAny.js";
import { chipsFor, describe, focusKeys, segmentAt } from "./guide.js";
import { fromFacelets } from "./facelets.js";
import { decodeShare, encodeShare } from "./share.js";
import { applyAlgorithm, centreTurns, fromNet, isSolved, parseAlgorithm, parseMove, pointCentres, rotateVec, toNet, wedgeNet, withCentreTurns, withWheels, type Move, type Sticker, type Vec } from "./cubeState.js";
import { CubeView } from "./cubeView.js";
import { runTour } from "./tour.js";
import { axisLabels, initLearn, learnTest, openLessonFrom, renderLearnCard } from "./learnView.js";
import { studyHint } from "./hint.js";
import { initSpeed, renderSpeedCard, speedTest } from "./speedView.js";
import { initHoverTips } from "./hoverTips.js";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
localizePage(document);
initHoverTips(document);
$("sendErrorText").textContent = tr("格式不正確，請重新拍照。", "Invalid format. Please retake the photos.");
$("aiFailTitle").textContent = tr("AI 暫時無法辨識", "The AI can't read the photos right now");
$("aiFailText").textContent = tr("選方塊大小，接著照著照片自己填顏色。", "Pick the cube size, then fill in the colours from your photos.");
$("aiRetry").textContent = tr("再試一次 AI", "Try the AI again");
$("leaveTitle").textContent = tr("回到首頁？", "Back to the home page?");
$("leaveCancel").textContent = tr("取消", "Cancel");
$("leaveGo").textContent = tr("回首頁", "Go home");
$("manualNote").textContent = tr("AI 暫時無法辨識。點一面放大，照著照片填顏色。", "The AI couldn't read the photos. Tap a face and fill in the colours from its photo.");

const SCREENS = ["setup", "capture", "review", "result", "solveView", "learnMap", "learnView", "learnDone"] as const;

/* ---------- saved solves (this browser only, newest first, three at most) ---------- */

interface Save {
  ts: number;
  size: number;
  faces: Record<Face, string[]>;
  moves: string[];
  index: number;
  /** What each stretch of the moves does, when the moves came from our solver. */
  segments?: Segment[];
  /** Saved from the teaching mode that was removed: its stage notes are no longer shown. */
  teach?: boolean;
  /** Name the user gave it; without one the card shows when it was saved. */
  title?: string;
  /** A study of the 3×3 whose centres have arrows: where each centre's arrow pointed at the start (centreTurns). */
  centres?: number[];
  /** A study of the 2×2 Magic Wheel: its wedges' colours at the start, as a net (`faces` holds the corners). */
  wheels?: Record<Face, string[]>;
  /** A study: `faces` is where it started, `moves` everything typed (kept as typed), `index` the step shown. */
  study?: boolean;
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
/** A link that opens a fresh study of this cube. */
function shareLink(size: number, faces: Record<Face, string[]>): string {
  const token = encodeShare({ size, faces, index: 0 });
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
    // a Magic Wheel's moves read as wheel turns (u d r l f b), only while reading its own
    setWheelStudy(!!sv.wheels);
    const done = readMoves(sv.moves, sv.size).moves;
    setWheelStudy(studying && studyWheel);
    // sharing happens inside a save, so the card only opens, renames and deletes
    el.innerHTML = `<canvas class="mini"></canvas><div class="save-text"><button type="button" class="save-title" aria-label="${tr("改標題", "Rename")}"><span></span></button><span class="badge">${sv.size}×${sv.size} · ${sv.index}/${done.length}</span></div><button class="del" aria-label="${tr("刪除", "Delete")}">✕</button>${sv.study ? `<span class="save-kind"><svg viewBox="0 0 24 24" width="14" height="14"><path d="M12 6l7 3.8v7.6L12 21l-7-3.6V9.8z" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"/><path d="M5 9.8l7 3.7 7-3.7M12 13.5V21" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"/></svg></span>` : ""}`;
    el.querySelector(".save-title span")!.textContent = sv.title ?? savedAt(sv.ts);
    root.appendChild(el);
    const view = new CubeView(el.querySelector("canvas")!);
    miniViews.push(view);
    const plain = fromNet(sv.size, sv.faces);
    const start = sv.wheels ? withWheels(sv.size, plain, sv.wheels) : sv.centres ? withCentreTurns(sv.size, plain, sv.centres) : plain;
    view.setState(sv.size, applyAlgorithm(start, done.slice(0, sv.index)));
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
  const entry: Save = studying
    ? { ts: Date.now(), size: net.size, faces: toNet(net.size, startState), moves: studyTokens, index: moveIndex, study: true, ...(studyArrows ? { centres: centreTurns(net.size, startState) } : {}), ...(studyWheel ? { wheels: wedgeNet(net.size, startState) } : {}) }
    : { ts: Date.now(), size: net.size, faces: toNet(net.size, startState), moves: moves.map((m) => m.token), index: moveIndex, ...(segments ? { segments } : {}) };
  storeSaves([entry, ...loadSaves()]);
  renderSaves();
  savedKey = progressKey();
  const btn = $("save");
  btn.classList.add("ok");
  setTimeout(() => btn.classList.remove("ok"), 1500);
}

function openSave(i: number) {
  const sv = loadSaves()[i];
  if (sv) openSaved(sv);
}

/** What a save would hold now; leaving needs no confirmation while it matches the last save. */
let savedKey = "";
function progressKey(): string {
  if (!net) return "";
  return JSON.stringify([studying, net.size, toNet(net.size, startState), studyArrows && centreTurns(net.size, startState), studyWheel && wedgeNet(net.size, startState), studying ? studyTokens : moves.map((m) => m.token), moveIndex]);
}
/** The same for the result screen: a saved cube opened before it was solved, as long as it is unchanged. */
function resultKey(): string {
  return net ? JSON.stringify(["result", net.current]) : "";
}

/** Show a saved or shared solve at its step (or just the cube when it has no solution yet). */
function openSaved(sv: Save) {
  if (sv.study) {
    openStudy(sv);
    return;
  }
  setStudying(false);
  studyFrom = null;
  size = sv.size;
  images = {}; // photos from an earlier capture belong to another cube
  const confidence = Object.fromEntries(FACES.map((f) => [f, Array.from({ length: sv.size }, () => "9".repeat(sv.size))])) as Record<Face, string[]>;
  response = { ok: true, size: sv.size, sizeMismatch: null, recognition: { faces: sv.faces, confidence, notes: [] }, warnings: [], model: "saved", mock: false, ms: 0, usage: null };
  if (!sv.moves.length) {
    showResult();
    savedKey = resultKey();
    return;
  }
  net = makeState(sv.size, response.recognition);
  renderNet($("net"), net);
  moves = parseAlgorithm(sv.moves.join(" "), sv.size);
  // an old teaching save keeps its moves; the stage notes went with the teaching mode
  segments = sv.teach ? null : (sv.segments ?? null);
  startState = fromNet(sv.size, sv.faces);
  moveIndex = Math.min(sv.index, moves.length);
  shownIndex = Math.max(0, Math.min(moves.length - 1, moveIndex - 1));
  cubeView.setState(sv.size, applyAlgorithm(startState, moves.slice(0, moveIndex)));
  cubeView.resetView();
  showScreen("solveView");
  renderSolve();
  savedKey = progressKey();
}

function showScreen(id: (typeof SCREENS)[number]) {
  for (const s of SCREENS) $(s).classList.toggle("hidden", s !== id);
  // lowercase letters are wheel turns only on a Magic Wheel study's own screen
  setWheelStudy(id === "solveView" && studying && studyWheel);
  // one home button in the header serves every screen but the home screen itself
  const home = $("home");
  home.classList.toggle("hidden", id === "setup");
  home.classList.remove("confirm");
  $("homeIcon").classList.remove("hidden");
  $("homeX").classList.add("hidden");
  setHero(id === "setup" && loadSaves().length === 0);
  if (id === "setup") {
    renderLearnCard();
    renderSpeedCard();
  }
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
  $("homeIcon").classList.toggle("hidden", singleShot);
  $("homeX").classList.toggle("hidden", !singleShot);
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
  speakPhotoTip();
}

tipsDialog.addEventListener("close", () => {
  stopPhotoTip();
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
  setBusy(true);
  try {
    response = await recognize(size, faces);
  } catch (err) {
    setBusy(false);
    $<HTMLButtonElement>("send").disabled = false;
    if (!(err instanceof ApiError && err.code === "NO_CUBE")) {
      // The photos are fine but the AI could not be used: pick the size and fill the colours in by hand.
      console.error("recognize failed", err);
      openSizePicker("manual");
      return;
    }
    // Photos without a cube are marked with the wordless warning and a shake; tapping one re-shoots that face.
    badFaces = err.faces.length ? err.faces : [...FACES];
    $("reviewThumbs").innerHTML = thumbsHtml(null);
    $("sendError").classList.remove("hidden");
    const card = $("review");
    card.classList.remove("shake");
    void card.offsetWidth;
    card.classList.add("shake");
    return;
  }
  setBusy(false);
  showResult();
}

function onNetEdited() {
  if (!net) return;
  markBadCells($("net"), []);
  $("invalidBadge").classList.add("hidden");
  previewView.setState(net.size, fromNet(net.size, net.current));
  renderLegend($("legend"), net);
  $<HTMLButtonElement>("resetNet").disabled = accuracy(net).corrected === 0 && unknownCount(net.current) === unknownCount(net.original);
  renderFill();
}

/** Colours filled in by hand: the count so far, and no solving or sharing until every sticker has one. */
let manualFill = false;
function renderFill() {
  if (!net) return;
  const total = 6 * net.size * net.size;
  const left = unknownCount(net.current);
  const count = $("fillCount");
  count.classList.toggle("hidden", !manualFill);
  count.classList.toggle("filled", left === 0);
  count.innerHTML = `${left === 0 ? '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>' : ""}${tr("已填", "Filled")} <b>${total - left} / ${total}</b>`;
  for (const id of ["solve", "shareResult"]) $<HTMLButtonElement>(id).disabled = left > 0;
}

/** The AI could not be used: an empty net of the picked size, filled in by hand from the photos. */
function startManual(n: number) {
  response = { ok: true, size: n, sizeMismatch: null, recognition: blankRecognition(n), warnings: [], model: "manual", mock: false, ms: 0, usage: null };
  showResult();
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
  manualFill = unknownCount(net.current) > 0;
  $("manualNote").classList.toggle("hidden", !manualFill);
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
  if (response.warnings.length || manualFill) setEditor(true);
  renderFill();
  $("solve").classList.toggle("hidden", !SOLVABLE.includes(size));
  // The 4×4 centre tables take a few seconds to build and the bigger cubes fetch theirs: start now.
  idle(() => warmAsync(n));
  window.scrollTo({ top: 0, behavior: "smooth" });
}

/* ---------- solving ---------- */

let moves: Move[] = [];
let moveIndex = 0;
/** The study hint on show: the step, shown move and moves it was worked out for (any change puts it away). */
let hintShownAt: string | null = null;
/** Cube as it was read, so any step can be reached by replaying the moves before it. */
let startState: Sticker[] = [];
let playing = false;
let playTimer = 0;
let turnMs = 1200;
/** Stages of the current solution (null when the moves did not come from our solver). */
let segments: Segment[] | null = null;
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

/* ---------- busy overlay: one large spinner for every wait (the AI reading the photos, a solve) ---------- */

function setBusy(on: boolean) {
  $("busy").classList.toggle("hidden", !on);
}

/** Validate the checked net and solve it; on failure mark what is wrong and shake. */
async function trySolve(): Promise<{ moves: string[]; segments: Segment[] } | null> {
  if (!net) return null;
  const blank = FACES.flatMap((face) => net!.current[face].flatMap((line, row) => [...line].flatMap((ch, col) => (ch === UNKNOWN ? [{ face, row, col }] : []))));
  if (blank.length) return fail(blank);
  const r = await solveAsync(net.size, net.current);
  return r.ok ? { moves: r.moves, segments: r.segments } : fail(r.badCells);
}

function startSolve() {
  if (!net) return;
  const btn = $<HTMLButtonElement>("solve");
  btn.disabled = true;
  setBusy(true);
  void (async () => {
    const solution = await trySolve();
    setBusy(false);
    btn.disabled = false;
    if (!solution || !net) return;
    moves = parseAlgorithm(solution.moves.join(" "), net.size);
    segments = solution.segments;
    moveIndex = 0;
    shownIndex = 0;
    startState = fromNet(net.size, net.current);
    setStudying(false);
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
  if (hintShownAt !== null && (!studying || hintMark() !== hintShownAt)) clearStudyHint();
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
  // a study sequence may end anywhere; only a solution that does not solve is a "?"
  if (done && !studying && !isSolved(cubeView.getState())) $("move").textContent = "?";
  renderDelTag();
}

const CHIP_ICONS: Record<Segment["kind"], string> = {
  centres: `<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><rect x="8.5" y="8.5" width="7" height="7" fill="currentColor"/></svg>`,
  edges: `<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><rect x="9" y="3" width="6" height="5" fill="currentColor"/><rect x="9" y="16" width="6" height="5" fill="currentColor"/><rect x="3" y="9" width="5" height="6" fill="currentColor"/><rect x="16" y="9" width="5" height="6" fill="currentColor"/></svg>`,
  parity: `<svg viewBox="0 0 24 24"><path d="M4 9h13l-3-3M20 15H7l3 3" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  cube3: `<span>3×3</span>`,
  optimal: `<svg viewBox="0 0 24 24"><path d="M13 2L4 14h7l-1 8 9-12h-7z" fill="currentColor"/></svg>`,
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
      return `<button class="chip${done ? " complete" : ""}${current ? " current" : ""}" data-i="${i}" style="--p:${Math.round(p * 100)}%">${CHIP_ICONS[c.kind]}</button>`;
    })
    .join("");
  const seg = segmentAt(segments, at);
  // only the pieces this stage works on keep their colours; the rest go grey
  const keys = focusKeys(seg, net.size);
  cubeView.setFocus(keys ? { keys } : null);
  const text = $("guideText");
  text.classList.toggle("hidden", !seg);
  if (seg) {
    const d = describe(seg, net.size);
    $("guideTitle").textContent = d.title;
    $("guideBody").textContent = d.body;
  }
}

/** One move forward or back; `fast` turns at twice the speed (a whole sequence from a key). */
async function step(delta: 1 | -1, fast = false) {
  if (cubeView.animating) return;
  const target = moveIndex + delta;
  if (target < 0 || target > moves.length) return;
  shownIndex = delta === 1 ? moveIndex : moveIndex - 1;
  const mv = moves[shownIndex]!;
  renderSolve();
  const ms = (Math.abs(mv.q) === 2 ? turnMs * 1.4 : turnMs) * (fast ? 0.5 : 1);
  await cubeView.animate(mv, delta, ms);
  if (studyDirty) {
    // the moves were edited during this turn: land on the new end instead
    studyDirty = false;
    jumpTo(moves.length, Math.max(0, moves.length - 1));
    return;
  }
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

/* ---------- study mode: the solve screen driven by the user's own moves ---------- */

let studying = false;
/** Everything typed, including tokens that are not moves (those are skipped and the field turns red). */
let studyTokens: string[] = [];
let studyDepth = 1;
let studyWide = false;
/** An edit arrived while a turn was animating: jump to the new end once it finishes. */
let studyDirty = false;
/**
 * Custom sequences added at the end, newest last. One counts only while its tokens are still where
 * they were put; the one that ends the moves is what ⌫ deletes whole, and a key after it does not
 * merge into its last move.
 */
let macroRuns: { name: string; start: number; tokens: string[] }[] = [];

/** The custom sequence that ends the moves, if any (dropping any no longer intact). */
function lastRun() {
  macroRuns = macroRuns.filter((r) => r.tokens.every((t, i) => studyTokens[r.start + i] === t));
  const r = macroRuns[macroRuns.length - 1];
  return r && r.start + r.tokens.length === studyTokens.length ? r : null;
}

/** A key or hand turn added at the end: merged into the last move, unless that ends a custom sequence. */
function addToken(token: string): string[] {
  return lastRun() ? [...studyTokens, token] : pushMove(studyTokens, token);
}

/** ⌫'s tag: the custom sequence it would delete whole. */
function renderDelTag() {
  const run = studying ? lastRun() : null;
  $("studyDelTag").textContent = run?.name ?? "";
  $("studyDelTag").classList.toggle("hidden", !run);
}
/** Study mode's eye: only the pieces carrying a mark in colour. Separate from guide mode's switch. */
let markedOnly = false;
function setMarkedOnly(on: boolean) {
  markedOnly = on;
  const btn = $("studyFocusBtn");
  btn.classList.toggle("on", on);
  btn.setAttribute("aria-pressed", String(on));
  cubeView.setMarkedOnly(on);
}

/** The solve a study was opened from, to go back to exactly as it was (the study's own moves are dropped). */
let studyFrom: { net: NetState; start: Sticker[]; moves: Move[]; segments: Segment[] | null; index: number } | null = null;
const STUDY_COLORS: Record<Face, string> = { U: "W", R: "R", F: "G", D: "Y", L: "O", B: "B" };

function solvedState(n: number): Sticker[] {
  return fromNet(n, Object.fromEntries(FACES.map((f) => [f, Array.from({ length: n }, () => STUDY_COLORS[f].repeat(n))])) as Record<Face, string[]>);
}

/** A net state for `stickers`, so saving, sharing and solving work on it like on a read cube. */
function netFor(n: number, stickers: Sticker[]): NetState {
  const faces = toNet(n, stickers);
  const confidence = Object.fromEntries(FACES.map((f) => [f, Array.from({ length: n }, () => "9".repeat(n))])) as Record<Face, string[]>;
  return makeState(n, { faces, confidence, notes: [] });
}

function setStudying(on: boolean) {
  studying = on;
  if (hintShownAt !== null) clearStudyHint();
  $("solveView").classList.toggle("study", on);
  // tapping a sticker marks it in study mode; every new study starts without marks
  cubeView.setMarking(on);
  cubeView.clearMarks();
  setTwistOn(twistOn);
  $("viewHome").setAttribute("aria-label", on ? tr("轉回正面（長按打亂）", "Turn back to the front (hold to scramble)") : tr("轉回正面", "Turn back to the front"));
  // the copy button sits after the move text in study mode, after the token strip otherwise
  (on ? $("studyTextRow") : $("sequence").parentElement!).append($("copySeq"));
}

function renderKeys() {
  if (net) $("studyKeys").innerHTML = keypadHtml(net.size, studyDepth, studyWide, studyWheel ? studyKeyset : undefined);
  renderMacros();
}

/** Open the solve screen in study mode on `start`: a solved cube from the home screen, or a solve's current step. */
/** The study is of the 3×3 whose centres have arrows: no hint, solver or share, and solved means the arrows too. */
let studyArrows = false;
/** The study is of the 2×2 Magic Wheel: wheel turns too, no hint, solver or share. */
let studyWheel = false;
/** Its keypad shows the layer keys (U R F) or the wheel keys (u r f). */
let studyKeyset: "layer" | "wheel" = "layer";
/** A solved cube for the study kind now open: arrows on its centres, or wheels, when the study has them. */
function studySolved(n: number): Sticker[] {
  return studyWheel ? withWheels(n, solvedState(n)) : studyArrows ? pointCentres(n, solvedState(n)) : solvedState(n);
}

function startStudy(n: number, start: Sticker[], arrows = false, wheel = false) {
  stopPlaying();
  studyArrows = arrows;
  studyWheel = wheel;
  studyKeyset = "layer";
  setWheelStudy(wheel);
  $("solveView").classList.toggle("arrows", arrows);
  $("solveView").classList.toggle("wheel", wheel);
  net = netFor(n, start);
  startState = start;
  moves = [];
  moveIndex = 0;
  shownIndex = 0;
  segments = null;
  studyTokens = [];
  macroRuns = [];
  studyDepth = 1;
  studyWide = false;
  studyFrom = null;
  $("backToSolve").classList.add("hidden");
  $<HTMLInputElement>("studyText").value = "";
  $("studyText").classList.remove("bad");
  setStudying(true);
  renderKeys();
  setMarkedOnly(false);
  cubeView.setState(n, start);
  // every study, a save included, opens at the starting angle rather than wherever the view was left
  cubeView.resetView();
  // a dot on the front face's centre to start with, so it is easy to see where the front went;
  // an even cube has no single centre, so the top-left of the middle four
  // (the arrow on a 3×3 with arrows already shows it, and a dot would hide it)
  if (!arrows) cubeView.mark(n % 2 ? `0,0,${n - 1}|0,0,1` : `-1,1,${n - 1}|0,0,1`);
  showScreen("solveView");
  renderSolve();
  firstStudyTour();
}

/**
 * New study moves; `pressed` is the keypad token that made them, turned on the cube as it is now.
 * `turned`: the cube already shows them (a hand turn), so only the step moves to the end.
 */
/**
 * With the slider partway, a new move starts from there: the moves after it are dropped first.
 * False while a turn is still animating, when the edit waits for the next tap.
 */
function cutAtCursor(): boolean {
  if (!net) return false;
  if (moveIndex >= moves.length) return true;
  stopPlaying();
  if (cubeView.animating) return false;
  studyTokens = tokensThrough(studyTokens, net.size, moveIndex);
  $<HTMLInputElement>("studyText").value = studyTokens.join(" ");
  const read = readMoves(studyTokens, net.size);
  $("studyText").classList.toggle("bad", read.bad);
  moves = read.moves;
  shownIndex = Math.max(0, moves.length - 1);
  renderSolve();
  return true;
}

function setStudyTokens(tokens: string[], pressed?: string, turned = false) {
  if (!net) return;
  stopPlaying();
  const before = moves.length;
  const prevTokens = moves.map((m) => m.token);
  const prevLast = prevTokens[before - 1];
  studyTokens = tokens;
  const read = readMoves(tokens, net.size);
  $("studyText").classList.toggle("bad", read.bad);
  moves = read.moves;
  if (turned) {
    studyDirty = false;
    jumpTo(moves.length, Math.max(0, moves.length - 1));
    return;
  }
  if (cubeView.animating) {
    studyDirty = true;
    return;
  }
  if (studyInstant) {
    jumpTo(moves.length, Math.max(0, moves.length - 1));
    return;
  }
  if (pressed && moves.length === before + 1) {
    jumpTo(before, before);
    void step(1);
    return;
  }
  const turn = pressed ? studyMove(pressed, net.size) : null;
  const kept = Math.min(moves.length, before - 1);
  if (turn && moveIndex === before && moves.length >= before - 1 && moves.length <= before && moves.slice(0, kept).every((m, i) => m.token === prevTokens[i])) {
    // the key merged into the last move (L L → L2) or cancelled it (L L′): turn by the key pressed
    shownIndex = Math.max(0, moves.length - 1);
    renderSolve();
    void cubeView.animate(turn, 1, turnMs).then(() => {
      studyDirty = false;
      jumpTo(moves.length, Math.max(0, moves.length - 1));
    });
    return;
  }
  const delta = moves.length === before && moveIndex === before && before > 0 ? deltaTurn(prevLast!, moves[before - 1]!.token, net.size) : null;
  if (delta && moves.slice(0, -1).every((m, i) => m.token === prevTokens[i])) {
    // R → R2 or R → R′: turn from the old move into the new one
    shownIndex = before - 1;
    renderSolve();
    void cubeView.animate(delta.move, delta.dir, Math.abs(delta.move.q) === 2 ? turnMs * 1.4 : turnMs).then(() => {
      studyDirty = false;
      jumpTo(moves.length, Math.max(0, moves.length - 1));
    });
    return;
  }
  jumpTo(moves.length, Math.max(0, moves.length - 1));
}

/** Open a saved study as it was left: same start, same text, same step. */
function openStudy(sv: Save) {
  const plain = fromNet(sv.size, sv.faces);
  if (sv.wheels) startStudy(sv.size, withWheels(sv.size, plain, sv.wheels), false, true);
  else startStudy(sv.size, sv.centres ? withCentreTurns(sv.size, plain, sv.centres) : plain, !!sv.centres);
  studyTokens = sv.moves;
  macroRuns = [];
  $<HTMLInputElement>("studyText").value = sv.moves.join(" ");
  const read = readMoves(sv.moves, sv.size);
  $("studyText").classList.toggle("bad", read.bad);
  moves = read.moves;
  const at = Math.min(sv.index, moves.length);
  jumpTo(at, Math.max(0, at - 1));
  savedKey = progressKey();
}

/*
 * Holding a move key shows which layers it turns (outlined, with the arrow) without turning; letting
 * go after a hold does nothing. Only a tap turns.
 */
const HOLD_MS = 350;
let holdTimer = 0;
let held = false;
// the move keys and the x y z row above the yellow keys behave alike
const keyPads = [$("studyKeys"), $("studyTurns")];
function endHold() {
  clearTimeout(holdTimer);
  holdTimer = 0;
  if (held) cubeView.setPreview(null);
}
function keyDown(e: PointerEvent) {
  const k = (e.target as HTMLElement).closest<HTMLElement>("[data-tok]");
  endHold();
  held = false;
  if (!k || !net) return;
  const mv = studyMove(k.dataset.tok!, net.size);
  if (!mv) return;
  holdTimer = window.setTimeout(() => {
    held = true;
    cubeView.setPreview(mv);
  }, HOLD_MS);
}

function keyTap(e: MouseEvent) {
  const k = (e.target as HTMLElement).closest<HTMLElement>("button");
  if (!k || !net) return;
  if (held) {
    // the end of a hold, not a tap
    held = false;
    return;
  }
  if (k.dataset.depth) {
    studyDepth = Number(k.dataset.depth);
    if (studyDepth === 1) studyWide = false;
    renderKeys();
    return;
  }
  if (k.dataset.keyset) {
    studyKeyset = k.dataset.keyset as "layer" | "wheel";
    renderKeys();
    return;
  }
  if (k.dataset.wide !== undefined) {
    studyWide = !studyWide;
    if (studyWide && studyDepth === 1) studyDepth = 2;
    renderKeys();
    return;
  }
  if (!k.dataset.tok || !cutAtCursor()) return;
  const next = addToken(k.dataset.tok);
  $<HTMLInputElement>("studyText").value = next.join(" ");
  setStudyTokens(next, k.dataset.tok);
}
for (const pad of keyPads) {
  pad.addEventListener("pointerdown", keyDown);
  for (const type of ["pointerup", "pointercancel", "pointerleave"]) pad.addEventListener(type, endHold);
  // a long press would otherwise open the phone's menu or start selecting text
  pad.addEventListener("contextmenu", (e) => e.preventDefault());
  pad.addEventListener("click", keyTap);
}
// ⌫ beside the text drops the last move (with the slider partway: the moves after it, then that
// one); it stays while turning by hand, to take back a turn
$("studyDel").onclick = () => {
  // the click that ends a long press is not a tap
  if (delHeld) return void (delHeld = false);
  if (!net || !cutAtCursor() || !studyTokens.length) return;
  // a custom sequence at the end goes whole
  const run = lastRun();
  if (run) macroRuns.pop();
  const next = studyTokens.slice(0, run ? run.start : -1);
  $<HTMLInputElement>("studyText").value = next.join(" ");
  setStudyTokens(next);
};
// a long press on ⌫ deletes every move: the cube goes back to where the study started, at once
const DELETE_HOLD_MS = 600;
let delTimer = 0;
let delHeld = false;
function deleteAllMoves() {
  if (!net || !studying || cubeView.animating || !studyTokens.length) return;
  stopPlaying();
  studyTokens = [];
  macroRuns = [];
  $<HTMLInputElement>("studyText").value = "";
  $("studyText").classList.remove("bad");
  moves = [];
  jumpTo(0, 0);
  navigator.vibrate?.(30);
}
function endDeleteHold() {
  clearTimeout(delTimer);
  $("studyDel").classList.remove("holding");
}
$("studyDel").addEventListener("pointerdown", () => {
  delHeld = false;
  if (!studyTokens.length) return;
  $("studyDel").classList.add("holding");
  delTimer = window.setTimeout(() => {
    endDeleteHold();
    delHeld = true;
    deleteAllMoves();
  }, DELETE_HOLD_MS);
});
for (const type of ["pointerup", "pointercancel", "pointerleave"]) $("studyDel").addEventListener(type, endDeleteHold);
$("studyDel").addEventListener("contextmenu", (e) => e.preventDefault());
$("studyText").oninput = (e) => setStudyTokens(tokenize((e.target as HTMLInputElement).value));
$("studyText").onkeydown = (e) => {
  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
};

/* The ⓘ in study mode: a step-by-step tour of the screen, one part lit at a time. */
const tourDialog = $<HTMLDialogElement>("tourDialog");
tourDialog.querySelector(".tour-skip")!.textContent = tr("略過", "Skip");
$("studyHelp").onclick = () => studyTour();

/* Study mode's fold: hide the slider and play buttons so the keys sit higher. Remembered per device. */
const PLAYBAR_KEY = "rcsolver.playbar";
function setCompact(on: boolean) {
  $("solveView").classList.toggle("compact", on);
  const btn = $("playToggle");
  btn.setAttribute("aria-expanded", String(!on));
  btn.setAttribute("aria-label", on ? tr("展開播放列", "Show the playback controls") : tr("收起播放列", "Hide the playback controls"));
}
try {
  setCompact(localStorage.getItem(PLAYBAR_KEY) === "0");
} catch {
  setCompact(false);
}
$("playToggle").onclick = () => {
  const on = !$("solveView").classList.contains("compact");
  setCompact(on);
  try {
    localStorage.setItem(PLAYBAR_KEY, on ? "0" : "1");
  } catch {
    /* storage unavailable */
  }
};

/*
 * Your own sequences: up to five named ones (names of at most three characters), kept on this
 * device. A key adds the whole sequence to the moves, written out, so saves, copies and shared
 * links read the same anywhere; it does not merge with the move before it. A sequence with moves
 * this cube size does not have is greyed out.
 */
interface Macro {
  name: string;
  seq: string;
}
const MACRO_KEY = "rcsolver.macros";
const MACRO_MAX = 5;
const MACRO_NAME_MAX = 2;
const MACRO_EXAMPLES: Macro[] = [
  { name: "Sx", seq: "R U R' U'" },
  { name: "Su", seq: "R U R' U R U2 R'" },
];
function loadMacros(): Macro[] {
  try {
    const raw = localStorage.getItem(MACRO_KEY);
    if (raw === null) return MACRO_EXAMPLES;
    const list = JSON.parse(raw) as Macro[];
    // names saved before the limit was two characters are cut to it
    return Array.isArray(list)
      ? list
          .filter((m) => m && typeof m.name === "string" && typeof m.seq === "string")
          .slice(0, MACRO_MAX)
          .map((m) => ({ name: [...m.name].slice(0, MACRO_NAME_MAX).join(""), seq: m.seq }))
      : MACRO_EXAMPLES;
  } catch {
    return MACRO_EXAMPLES;
  }
}
let macros = loadMacros();
function storeMacros(list: Macro[]) {
  macros = list;
  try {
    localStorage.setItem(MACRO_KEY, JSON.stringify(list));
  } catch {
    /* storage unavailable: kept for this visit */
  }
}
const EDIT_ICON = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M4 20l4-1 11-11-3-3L5 16z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M14 7l3 3" stroke="currentColor" stroke-width="2"/></svg>';
function renderMacros() {
  const row = $("studyMacros");
  if (!macros.length) {
    row.innerHTML = `<button type="button" class="k macro-add" data-macro-edit>${tr("＋ 自訂公式", "+ Your own sequence")}</button>`;
    return;
  }
  const esc = (t: string) => t.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  row.innerHTML =
    macros
      .map((m, i) => {
        const read = readMoves(tokenize(m.seq), net?.size ?? 3);
        const off = read.bad || !read.moves.length;
        return `<button type="button" class="k macro" data-macro="${i}" aria-label="${esc(`${m.name}: ${m.seq}`)}"${off ? " disabled" : ""}>${esc(m.name)}</button>`;
      })
      .join("") + `<button type="button" class="k macro-edit" data-macro-edit aria-label="${tr("設定自訂公式", "Edit your own sequences")}">${EDIT_ICON}</button>`;
}
/** Add a sequence at the end and turn through it quickly. */
async function runMacro(i: number) {
  const m = macros[i];
  if (!m || !net || !studying || cubeView.animating) return;
  const add = readMoves(tokenize(m.seq), net.size);
  if (add.bad || !add.moves.length) return;
  if (!cutAtCursor()) return;
  const tokens = add.moves.map((mv) => mv.token);
  macroRuns.push({ name: m.name, start: studyTokens.length, tokens });
  studyTokens = [...studyTokens, ...tokens];
  $<HTMLInputElement>("studyText").value = studyTokens.join(" ");
  const read = readMoves(studyTokens, net.size);
  $("studyText").classList.toggle("bad", read.bad);
  moves = read.moves;
  if (studyInstant) {
    jumpTo(moves.length, Math.max(0, moves.length - 1));
    return;
  }
  while (moveIndex < moves.length) {
    const at = moveIndex;
    await step(1, true);
    if (moveIndex === at) break; // interrupted (an edit jumped to the end)
  }
}
$("studyMacros").onclick = (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>("button");
  if (!b) return;
  if (b.dataset.macroEdit !== undefined) openMacroEditor();
  else if (b.dataset.macro) void runMacro(Number(b.dataset.macro));
};

const macroDialog = $<HTMLDialogElement>("macroDialog");
$("macroTitle").textContent = tr("自訂公式", "Your own sequences");
$("macroNote").textContent = tr(
  `名字最多 ${MACRO_NAME_MAX} 個字；按下去會把整串轉法加進去，分享和存檔也看得懂。最多 ${MACRO_MAX} 組。`,
  `Names of up to ${MACRO_NAME_MAX} characters. A key adds its whole sequence to the moves, so saves and shared links read the same anywhere. Up to ${MACRO_MAX}.`,
);
$("macroSave").textContent = tr("儲存", "Save");
function openMacroEditor() {
  const esc = (t: string) => t.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  $("macroRows").innerHTML = Array.from({ length: MACRO_MAX }, (_, i) => {
    const m = macros[i] ?? { name: "", seq: "" };
    return `<div class="macro-line"><input class="macro-name" maxlength="${MACRO_NAME_MAX}" value="${esc(m.name)}" placeholder="${tr("名字", "Ab")}" aria-label="${tr("名字", "Name")} ${i + 1}" autocomplete="off"><input class="macro-seq" value="${esc(m.seq)}" placeholder="R U R' U'" aria-label="${tr("轉法", "Moves")} ${i + 1}" autocomplete="off" autocapitalize="characters" spellcheck="false"><button type="button" class="macro-del" data-del aria-label="${tr("刪除這一組", "Delete this one")}"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M5 7h14M10 11v6M14 11v6M7 7l1 13h8l1-13M9 7V4h6v3" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg></button></div>`;
  }).join("");
  checkMacros();
  resetAi();
  macroDialog.showModal();
}
/** Mark what is missing or unreadable; returns the rows to keep, or null while any is wrong. */
function checkMacros(): Macro[] | null {
  const out: Macro[] = [];
  const problems: string[] = [];
  $("macroRows").querySelectorAll<HTMLElement>(".macro-line").forEach((line, i) => {
    const nameEl = line.querySelector<HTMLInputElement>(".macro-name")!;
    const seqEl = line.querySelector<HTMLInputElement>(".macro-seq")!;
    const name = nameEl.value.trim();
    const tokens = tokenize(seqEl.value);
    // any move some cube size has counts: 3R is fine to save for a 5×5
    const unknown = tokens.filter((t) => readMoves([t], 7).bad);
    const badName = !name && tokens.length > 0;
    const badSeq = (name !== "" && !tokens.length) || unknown.length > 0;
    nameEl.classList.toggle("bad", badName);
    seqEl.classList.toggle("bad", badSeq);
    if (unknown.length) problems.push(tr(`第 ${i + 1} 組有看不懂的記號：${unknown.join(" ")}`, `Row ${i + 1} has something that is not a move: ${unknown.join(" ")}`));
    else if (badName) problems.push(tr(`第 ${i + 1} 組還沒取名字`, `Row ${i + 1} needs a name`));
    else if (badSeq) problems.push(tr(`第 ${i + 1} 組還沒有轉法`, `Row ${i + 1} needs moves`));
    if (name && tokens.length && !unknown.length) out.push({ name, seq: tokens.join(" ") });
  });
  $("macroError").textContent = problems.join(tr("；", "; "));
  $("macroError").classList.toggle("hidden", !problems.length);
  $<HTMLButtonElement>("macroSave").disabled = problems.length > 0;
  return problems.length ? null : out;
}
$("macroRows").oninput = () => void checkMacros();
$("macroRows").onclick = (e) => {
  const del = (e.target as HTMLElement).closest<HTMLElement>("[data-del]");
  if (!del) return;
  const line = del.parentElement!;
  line.querySelectorAll("input").forEach((input) => ((input as HTMLInputElement).value = ""));
  if (line.classList.contains("ai-new")) {
    line.classList.remove("ai-new");
    aiRow = -1;
  }
  checkMacros();
};
$("macroSave").onclick = () => {
  const list = checkMacros();
  if (!list) return;
  storeMacros(list);
  renderMacros();
  macroDialog.close();
};
$("macroClose").onclick = () => macroDialog.close();

/*
 * "Ask AI" under the rows: one line of plain words goes to the model, with the marked pieces if
 * any (always: the model ignores them when the words do not mention them). Its answer fills the
 * next empty row, named "AI" and outlined, to keep with Save. Asking again rewrites that same row. Nothing checks what the moves do; unreadable ones turn red like typed ones.
 */
let aiRow = -1;
function setAiOpen(open: boolean) {
  $("macroAi").classList.toggle("open", open);
  $("macroAiToggle").setAttribute("aria-expanded", String(open));
  if (open) $("macroAiText").focus();
}
function aiError(text: string) {
  $("macroAiError").textContent = text;
  $("macroAiError").classList.toggle("hidden", !text);
}
function resetAi() {
  aiRow = -1;
  setAiOpen(false);
  aiError("");
  $<HTMLInputElement>("macroAiText").value = "";
}
$("macroAiLabel").textContent = tr("問 AI", "Ask AI");
$<HTMLInputElement>("macroAiText").placeholder = tr("例如：交換三個黑點的方塊", "e.g. swap the three marked pieces");
$("macroAiText").setAttribute("aria-label", tr("想要什麼公式", "What sequence do you want"));
$("macroAiSend").setAttribute("aria-label", tr("送出", "Send"));
$("macroAiToggle").onclick = () => setAiOpen(!$("macroAi").classList.contains("open"));
async function askAi() {
  const ask = $<HTMLInputElement>("macroAiText").value.trim();
  const send = $<HTMLButtonElement>("macroAiSend");
  if (!ask || !net || send.disabled) return;
  const lines = [...$("macroRows").querySelectorAll<HTMLElement>(".macro-line")];
  const empty = (l: HTMLElement) => [...l.querySelectorAll("input")].every((i) => !(i as HTMLInputElement).value.trim());
  const target = aiRow >= 0 ? aiRow : lines.findIndex(empty);
  if (target < 0) return aiError(tr(`${MACRO_MAX} 組都滿了，先刪掉一組`, `All ${MACRO_MAX} are taken: delete one first`));
  const marks = studying ? cubeView.markedKeys().map((k) => describeMark(k, net!.size)) : [];
  aiError("");
  send.disabled = true;
  send.classList.add("waiting");
  try {
    const a = await askMacro(net.size, ask, marks);
    if (!a.moves.trim()) return aiError(a.error || tr("AI 沒有給轉法，換個說法試試", "No sequence came back: try other words"));
    const line = lines[target]!;
    line.querySelector<HTMLInputElement>(".macro-name")!.value = "AI";
    line.querySelector<HTMLInputElement>(".macro-seq")!.value = tokenize(a.moves).join(" ");
    lines.forEach((l, i) => l.classList.toggle("ai-new", i === target));
    aiRow = target;
    checkMacros();
  } catch (err) {
    const code = err instanceof ApiError ? err.code : "";
    aiError(
      code === "QUOTA_EXCEEDED"
        ? tr("今天的 AI 次數用完了，明天再試", "Today's AI requests are used up: try tomorrow")
        : code === "RATE_LIMITED"
          ? tr("問得太快了，等一下再試", "Too many requests: wait a moment")
          : code === "AI_TIMEOUT"
            ? tr("AI 想太久了，換個說法試試", "The AI took too long: try other words")
            : tr("AI 暫時無法使用，請稍後再試", "The AI is not available right now: try again later"),
    );
  } finally {
    send.disabled = false;
    send.classList.remove("waiting");
  }
}
$("macroAiSend").onclick = () => void askAi();
$("macroAiText").onkeydown = (e) => {
  if (e.key === "Enter") void askAi();
};

/*
 * Hand turns: with the switch on, a drag that starts on a sticker turns its layer (the layer
 * follows the finger and settles on a quarter turn); off, drags turn the view as before. A turn
 * is recorded like a key press, so it merges and shows in the move text. On until switched off;
 * remembered per device.
 */
const TWIST_KEY = "rcsolver.twist";
let twistOn = true;
try {
  twistOn = localStorage.getItem(TWIST_KEY) !== "0";
} catch {
  /* storage unavailable: on */
}
function setTwistOn(on: boolean) {
  twistOn = on;
  const btn = $("twistBtn");
  btn.classList.toggle("on", on);
  btn.setAttribute("aria-pressed", String(on));
  $("solveView").classList.toggle("twisting", on);
  cubeView.setTwisting(studying && on);
}
$("twistBtn").onclick = () => {
  setTwistOn(!twistOn);
  try {
    localStorage.setItem(TWIST_KEY, twistOn ? "1" : "0");
  } catch {
    /* storage unavailable */
  }
};
// a hand turn adds a move where the slider is, dropping any after it
cubeView.canTwist = () => studying && cutAtCursor();
cubeView.onTwist = (axis, layer, quarters, wheel) => {
  if (!net) return;
  const turned = twistToken(net.size, axis, layer, quarters);
  if (!turned) return;
  // a Magic Wheel's wheel spun round: the same face, in lowercase
  const token = wheel ? turned.toLowerCase() : turned;
  const next = addToken(token);
  $<HTMLInputElement>("studyText").value = next.join(" ");
  setStudyTokens(next, undefined, true);
};
const TOUR_KEY = "rcsolver.studyTour";
/** The tour runs by itself the first time study mode opens on this device. */
function firstStudyTour() {
  try {
    if (localStorage.getItem(TOUR_KEY) === "1") return;
    localStorage.setItem(TOUR_KEY, "1");
  } catch {
    return; // storage unavailable: it would run every time, so leave it to the ⓘ
  }
  setTimeout(() => {
    if (studying && !$("solveView").classList.contains("hidden")) studyTour();
  }, 400);
}
function studyTour() {
  const big = (net?.size ?? 3) >= 4;
  runTour(tourDialog, [
    {
      targets: [$("cube")],
      title: tr("3D 方塊", "The cube"),
      body: tr("點一格加圓點，再點一次取消。", "Tap a sticker to dot it; tap again to clear it."),
    },
    {
      targets: [$("studyFocusBtn")],
      title: tr("只看圓點", "Dots only"),
      body: tr("只留有圓點的塊的顏色。", "Only the dotted pieces keep their colours."),
    },
    {
      targets: [$("twistBtn")],
      title: tr("手轉", "Turn by hand"),
      body: tr("開：拖一層就轉那層。關：拖曳轉視角。", "On: drag a layer to turn it. Off: drag to turn the view."),
    },
    {
      targets: [$("viewHome")],
      title: tr("轉回正面", "Front view"),
      body: tr("點：朝向你的面變正面。長按：打亂。", "Tap: the face towards you becomes the front. Hold: scramble."),
    },
    {
      targets: [$("instantBtn")],
      title: tr("無動畫", "No animation"),
      body: tr("開：按鍵立刻生效。", "On: keys take effect at once."),
    },
    {
      targets: [$("studyKeys")],
      title: tr("轉動鍵盤", "Move keys"),
      body: tr("深藍順時針，淺藍逆時針；按住先看會轉哪層。", "Dark blue clockwise, light blue anticlockwise; hold a key to see what it turns.") + (big ? tr("最上排選層。", " The top row picks the layer.") : ""),
    },
    {
      targets: [$("studyTurns")],
      title: tr("整顆翻轉", "Whole cube"),
      body: tr("x y z 翻轉整顆方塊。", "x y z turn the whole cube over."),
    },
    {
      targets: [$("studyMacros")],
      title: tr("自訂公式", "Your own sequences"),
      body: tr("按一下加入整串；✎ 新增或修改。", "Tap to add the whole sequence; the pencil adds or edits."),
    },
    {
      targets: [$("studyTextRow")],
      title: tr("轉法", "The moves"),
      body: tr("可以直接打字。⌫ 刪一步，長按全刪；右邊複製。", "Type here. ⌫ deletes a move, hold to delete all; copy on the right."),
    },
    {
      targets: [$("sliderRow"), $("prev").parentElement!],
      title: tr("播放", "Playback"),
      body: tr("一步一步看或自動播；拉桿跳到任一步。", "Step through or play; the slider jumps to any move."),
    },
    {
      targets: [$("studyHint")],
      title: tr("提示", "Hint"),
      body: tr("告訴你現在做到哪一步。", "Tells you which step you are at."),
    },
    {
      targets: [$("studyGo")],
      title: tr("求解", "Solve"),
      body: tr("交給求解器，一步步教你解。", "Hands the cube to the solver, move by move."),
    },
    {
      targets: [$("save")],
      title: tr("存檔", "Save"),
      body: tr("存到首頁，之後接著玩。", "Keeps it on the home page for later."),
    },
  ]);
}

/** Go: solve the cube as it is on screen and continue on the ordinary solve screen. */
$("studyGo").onclick = () => {
  if (!net || cubeView.animating) return;
  stopPlaying();
  const n = net.size;
  const from = applyAlgorithm(startState, moves.slice(0, moveIndex));
  const btn = $<HTMLButtonElement>("studyGo");
  btn.disabled = true;
  setBusy(true);
  void (async () => {
    const studyNet = netFor(n, from);
    const r = await solveAsync(n, studyNet.current);
    setBusy(false);
    btn.disabled = false;
    // every study state comes from turning a solved cube, so it always solves
    if (!r.ok) return;
    net = studyNet;
    startState = from;
    moves = parseAlgorithm(r.moves.join(" "), n);
    segments = r.segments;
    moveIndex = 0;
    shownIndex = 0;
    studyFrom = null;
    setStudying(false);
    cubeView.setState(n, from);
    renderSolve();
  })();
};

/*
 * Hint, left of Go: which step of the beginner's method the cube on screen is at, in a line
 * above the row, with the pieces still to do ringed on the cube (`web/src/hint.ts`). Any move,
 * step or edit puts it away; a 2×2 or 3×3 step offers its lesson, and the lesson's × comes back.
 */
const hintMark = () => `${moveIndex}|${shownIndex}|${studyTokens.join(" ")}`;
let hintLesson: { size: 2 | 3; index: number } | null = null;
function clearStudyHint() {
  hintShownAt = null;
  $("studyTip").classList.add("hidden");
  $("studyHint").setAttribute("aria-pressed", "false");
  cubeView.setGuides(null);
}
$("studyHintLabel").textContent = tr("提示", "Hint");
$("studyTipLearn").textContent = tr("去學這一關", "Learn this step");
$("studyHint").onclick = () => {
  if (!net || cubeView.animating) return;
  if (hintShownAt !== null) return clearStudyHint();
  stopPlaying();
  const h = studyHint(net.size, cubeView.getState());
  hintLesson = h?.lesson ?? null;
  $("studyTipTitle").textContent = h ? h.title : tr("看不出來", "Can't tell");
  $("studyTipBody").textContent = h ? h.body : tr("這個方塊的顏色對不起來，沒辦法判斷。", "The colours on this cube do not add up, so there is no hint.");
  $("studyTipLearn").classList.toggle("hidden", !hintLesson);
  $("studyTip").classList.remove("hidden");
  $("studyHint").setAttribute("aria-pressed", "true");
  cubeView.setGuides(h && h.rings.size ? { arrows: [], rings: h.rings } : null);
  hintShownAt = hintMark();
  // the card pushes the buttons down: keep the row (and the card above it) in sight
  $("studyGo").scrollIntoView({ block: "nearest", behavior: "smooth" });
};
$("studyTipLearn").onclick = () => {
  if (!hintLesson) return;
  const { size: s, index } = hintLesson;
  clearStudyHint();
  openLessonFrom(s, index, () => showScreen("solveView"));
};

/** From a solve: study the cube as it is at this step. */
$("toStudy").onclick = () => {
  if (!net || cubeView.animating) return;
  const from = { net, start: startState, moves, segments, index: moveIndex };
  startStudy(net.size, applyAlgorithm(startState, moves.slice(0, moveIndex)));
  studyFrom = from;
  $("backToSolve").classList.remove("hidden");
};

/** The eye: only the marked pieces keep their colours, so it is easy to follow where they go. */
$("studyFocusBtn").onclick = () => setMarkedOnly(!markedOnly);
// the eye needs something to show: no marks, no eye (and the view goes back to full colour)
cubeView.onMarks = (count) => {
  $<HTMLButtonElement>("studyFocusBtn").disabled = count === 0;
  if (count === 0 && markedOnly) setMarkedOnly(false);
};

/** Back to the solve this study came from, at the step it was left on. Go, by contrast, solves afresh. */
$("backToSolve").onclick = () => {
  if (!studyFrom || cubeView.animating) return;
  stopPlaying();
  const f = studyFrom;
  studyFrom = null;
  net = f.net;
  startState = f.start;
  moves = f.moves;
  segments = f.segments;
  setStudying(false);
  cubeView.setState(net.size, f.start);
  jumpTo(f.index, Math.max(0, f.index - 1));
};

/* Home: the study button opens a picker of cube sizes, each a small solved cube. */
const sizeDialog = $<HTMLDialogElement>("sizeDialog");
let sizeViews: CubeView[] = [];
/** What a picked size starts: study mode from the home page, or filling in colours after the AI failed. */
let sizePurpose: "study" | "manual" = "study";
function openSizePicker(purpose: "study" | "manual") {
  sizePurpose = purpose;
  $("aiFailHead").classList.toggle("hidden", purpose !== "manual");
  $("aiRetry").classList.toggle("hidden", purpose !== "manual");
  $("sizeGrid").classList.toggle("manual", purpose === "manual");
  sizeDialog.showModal();
  if (sizeViews.length) return;
  // the sizes, then the 3×3 whose centres have arrows (study only)
  $("sizeGrid").innerHTML =
    SOLVABLE.map((n) => `<button type="button" data-n="${n}"><canvas></canvas>${n}×${n}</button>`).join("") +
    `<button type="button" data-n="3" data-arrows class="size-arrows"><canvas></canvas>${tr("3×3 ▲ 中心", "3×3 ▲ centres")}</button>` +
    `<button type="button" data-n="2" data-wheel class="size-arrows"><canvas></canvas>${tr("2×2 魔輪", "2×2 Magic Wheel")}</button>`;
  sizeViews = Array.from($("sizeGrid").querySelectorAll("canvas"), (c, i) => {
    const n = SOLVABLE[i] ?? 3;
    const v = new CubeView(c);
    const extra = [pointCentres(3, solvedState(3)), withWheels(2, solvedState(2))][i - SOLVABLE.length];
    v.setState(i < SOLVABLE.length ? n : i === SOLVABLE.length ? 3 : 2, extra ?? solvedState(n));
    v.resetView();
    return v;
  });
}
$("study").onclick = () => openSizePicker("study");
// the turning cube on an empty home page opens the same picker
$("hero").onclick = () => openSizePicker("study");
$("importLabel").textContent = tr("貼上", "Paste");
$("startLabel").textContent = tr("拍照解", "Photo solve");
$("studyLabel").textContent = tr("自己轉", "Free turn");
$("heroPlayText").textContent = tr("點方塊，自己轉轉看", "Tap the cube to turn it yourself");
$("sizeGrid").onclick = (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>("[data-n]");
  if (!b) return;
  sizeDialog.close();
  const n = Number(b.dataset.n);
  if (sizePurpose === "manual") startManual(n);
  else if (b.dataset.arrows !== undefined) startStudy(3, pointCentres(3, solvedState(3)), true);
  else if (b.dataset.wheel !== undefined) startStudy(2, withWheels(2, solvedState(2)), false, true);
  else startStudy(n, solvedState(n));
};
$("aiRetry").onclick = () => {
  sizeDialog.close();
  void send();
};
// a tap outside the grid closes the picker
sizeDialog.addEventListener("click", (e) => {
  if (e.target === sizeDialog) sizeDialog.close();
});

/* ---------- wiring ---------- */

$("start").onclick = () => void startCapture();
/**
 * The header's home button. Leaving would lose photos, a reading or an unsaved solve, so it asks
 * first; with nothing to lose (the home page, re-shooting one face, a solve just saved or opened
 * and not moved since, a study with no moves yet) it goes straight away.
 */
const leaveDialog = $<HTMLDialogElement>("leaveDialog");
function goHome(current: (typeof SCREENS)[number] | undefined) {
  if (current === "capture") cancelCapture();
  else {
    stopPlaying();
    showScreen("setup");
  }
}
$("home").onclick = () => {
  const current = SCREENS.find((s) => !$(s).classList.contains("hidden"));
  const keep =
    current === "capture" ? (singleShot || Object.keys(images).length === 0 ? null : tr("已經拍的照片會不見。", "The photos taken so far will be lost."))
    : current === "review" ? tr("已經拍的照片會不見。", "The photos taken so far will be lost.")
    : current === "result" && resultKey() !== savedKey ? tr("辨識的結果會不見。", "The colours that were read will be lost.")
    : current === "solveView" && !(studying && studyTokens.length === 0) && progressKey() !== savedKey ? tr("沒存檔的進度會不見。", "Anything not saved will be lost.")
    : null;
  if (!keep) {
    goHome(current);
    return;
  }
  $("leaveText").textContent = keep;
  leaveDialog.showModal();
  $("leaveGo").onclick = () => {
    leaveDialog.close();
    goHome(current);
  };
};
$("leaveCancel").onclick = () => leaveDialog.close();
leaveDialog.addEventListener("click", (e) => {
  if (e.target === leaveDialog) leaveDialog.close();
});
$("tips").onclick = showTips;
$("shoot").onclick = () => {
  if (nativeCamera) {
    $<HTMLInputElement>("fileCapture").click();
    return;
  }
  try {
    acceptImage(captureFromVideo(video, STEPS[stepIndex]!.quarter));
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
    acceptImage(await captureFromFile(file, STEPS[stepIndex]!.quarter));
  } catch (err) {
    alert(err instanceof Error ? err.message : String(err));
  }
};
$<HTMLInputElement>("file").onchange = onFilePicked;
$<HTMLInputElement>("fileCapture").onchange = onFilePicked;
$("send").onclick = () => void send();
$("reviewThumbs").onclick = (e) => {
  const el = (e.target as HTMLElement).closest(".thumb");
  if (!el) return;
  const i = Array.from($("reviewThumbs").children).indexOf(el);
  if (i >= 0) void recapture(i);
};
$("retake").onclick = () => void startCapture();
$("again").onclick = () => void startCapture();
$("solve").onclick = () => startSolve();
$("fix").onclick = () => setEditor($("editor").classList.contains("hidden"));
$("shareResult").onclick = () => {
  if (net) void copyText(shareLink(net.size, net.current), $("shareResult"));
};
$("resetNet").onclick = resetNet;
// the cube button jumps back to the starting angle after any amount of dragging
/*
 * The view button turns the cube back to the front; in study mode a long press scrambles it
 * instead: random moves for this size go on the end of the moves, shown at once, not played.
 */
const SCRAMBLE_HOLD_MS = 600;
let scrambleTimer = 0;
let scrambledByHold = false;
/**
 * A long press scrambles: a fresh study of a solved cube turned at random, with no moves written
 * down, so the scramble is a puzzle to solve rather than a sequence to read back.
 */
function scrambleStudy() {
  if (!net || !studying || cubeView.animating) return;
  const n = net.size;
  // the Magic Wheel mixes layer and wheel turns
  const scramble = studyWheel ? wheelScrambleTokens().map((t) => studyMove(t, n)!) : parseAlgorithm(scrambleTokens(n).join(" "), n);
  startStudy(n, applyAlgorithm(studySolved(n), scramble), studyArrows, studyWheel);
  navigator.vibrate?.(30);
}
function endScrambleHold() {
  clearTimeout(scrambleTimer);
  $("viewHome").classList.remove("holding");
}
$("viewHome").addEventListener("pointerdown", () => {
  scrambledByHold = false;
  if (!studying) return;
  $("viewHome").classList.add("holding");
  scrambleTimer = window.setTimeout(() => {
    endScrambleHold();
    scrambledByHold = true;
    scrambleStudy();
  }, SCRAMBLE_HOLD_MS);
});
for (const type of ["pointerup", "pointercancel", "pointerleave"]) $("viewHome").addEventListener(type, endScrambleHold);
$("viewHome").addEventListener("contextmenu", (e) => e.preventDefault());
$("viewHome").onclick = () => {
  // the click that ends a long press is not a tap
  if (scrambledByHold) scrambledByHold = false;
  else {
    if (studying) smartHome();
    else cubeView.resetView();
    // the arrows say which way is up, front and right now, then fade
    cubeView.flashAxes(axisLabels(), 1800);
  }
};

const WHOLE_TURNS = ["x", "x'", "x2", "y", "y'", "y2", "z", "z'", "z2"];
/**
 * Study mode's front view: the corner nearest you goes to the front top right, so the three faces in
 * sight stay in sight; of the three ways to hold it so, the one nearest the view now, so they are only
 * squared up. The whole-cube turns that make it so (none,
 * or one or two of x y z) go on the end of the moves, and the view glides back to the usual angle
 * with the picture never jumping.
 */
function smartHome() {
  if (!net || cubeView.animating) return;
  const n = net.size;
  const turnBy = (v: Vec, toks: string[]) => toks.reduce((p, t) => { const m = parseMove(t, n); return rotateVec(p, m.axis, m.angle); }, v);
  const options = [[], ...WHOLE_TURNS.map((t) => [t]), ...WHOLE_TURNS.flatMap((a) => WHOLE_TURNS.map((b) => [a, b]))];
  const corner = cubeView.nearestCorner();
  const near = (v: Vec, w: Vec) => v.every((c, i) => Math.abs(c - w[i]!) < 1e-6);
  // the nearest; among ways to the same hold, the fewest turns (listed first)
  let turns: string[] = [];
  let best = -Infinity;
  for (const toks of options) {
    if (!near(turnBy(corner, toks), [1, 1, 1])) continue;
    const c = cubeView.homeCloseness((v) => turnBy(v, toks));
    if (c > best + 1e-9) [best, turns] = [c, toks];
  }
  const ms = studyInstant ? 0 : 450;
  if (turns.length) {
    if (!cutAtCursor()) return;
    let next = studyTokens;
    for (const t of turns) {
      studyTokens = next;
      next = addToken(t);
    }
    $<HTMLInputElement>("studyText").value = next.join(" ");
    setStudyTokens(next, undefined, true);
  }
  cubeView.homeFrom((v) => turnBy(v, turns), ms);
}

/* Study mode's ⚡: keys, x y z and custom sequences take effect at once, without turning on screen. */
const INSTANT_KEY = "rcsolver.instant";
let studyInstant = false;
try {
  studyInstant = localStorage.getItem(INSTANT_KEY) === "1";
} catch {
  /* storage unavailable: animated */
}
let noteTimer = 0;
/** A word over the move for a second (the ⚡ switch saying what it now does). */
function noteMove(text: string) {
  $("moveNote").textContent = text;
  $("moveNote").parentElement!.classList.add("noting");
  clearTimeout(noteTimer);
  noteTimer = window.setTimeout(() => $("moveNote").parentElement!.classList.remove("noting"), 1000);
}
function setInstant(on: boolean) {
  studyInstant = on;
  const btn = $("instantBtn");
  btn.classList.toggle("on", on);
  btn.setAttribute("aria-pressed", String(on));
}
setInstant(studyInstant);
$("instantBtn").onclick = () => {
  setInstant(!studyInstant);
  noteMove(studyInstant ? tr("無動畫", "No animation") : tr("有動畫", "Animated"));
  try {
    localStorage.setItem(INSTANT_KEY, studyInstant ? "1" : "0");
  } catch {
    /* storage unavailable */
  }
};
$("previewHome").onclick = () => previewView.resetView();
/** The import dialog takes a facelet string or a shared link; the clipboard is offered as a starting point. */
const importDialog = $<HTMLDialogElement>("importDialog");
const importText = $<HTMLTextAreaElement>("importText");
// an example of what to paste: a link to this site, as the share button makes them
importText.placeholder = `${location.origin}${location.pathname}#z=…`;
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
/* Sharing sends the cube as it is at this step, solving or studying; whoever opens the link starts
   a fresh study of it and presses Go to solve. */
$("shareSolve").onclick = () => {
  if (!net) return;
  void copyText(shareLink(net.size, toNet(net.size, applyAlgorithm(startState, moves.slice(0, moveIndex)))), $("shareSolve"));
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
/** The cube after the first `index` of `moves`. */
function cubeAtStep(size: number, faces: Record<Face, string[]>, moves: string[], index: number): Record<Face, string[]> {
  if (!moves.length || index <= 0) return faces;
  return toNet(size, applyAlgorithm(fromNet(size, faces), parseAlgorithm(moves.slice(0, index).join(" "), size)));
}

/** A shared link always opens a fresh study of the cube it carries. */
async function openSharedLink() {
  const q = new URLSearchParams(location.hash.slice(1));
  const z = q.get("z") ? decodeShare(q.get("z")!) : null;
  if (z) {
    stopPlaying();
    // an older link may carry a step: open the cube as it was there, its moves or the solver's
    // (deterministic, so the same as the sender's) replayed up to it
    let moves = z.moves ?? [];
    if (!z.moves && z.index > 0) {
      setBusy(true);
      const r = await solveAsync(z.size, z.faces);
      setBusy(false);
      moves = r.ok ? r.moves : [];
    }
    // an old teaching link counted steps of a solve that is gone: it opens at the scramble
    openStudy({ ts: Date.now(), size: z.size, faces: cubeAtStep(z.size, z.faces, moves, z.teach ? 0 : z.index), moves: [], index: 0, study: true });
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
  openStudy({ ts: Date.now(), size: parsed.size, faces: cubeAtStep(parsed.size, parsed.net, ok ? tokens : [], Number(q.get("i") ?? 0) || 0), moves: [], index: 0, study: true });
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
// The offline copy (sw.js): registered once the page has loaded, so its downloads never slow the page down.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => void navigator.serviceWorker.register("./sw.js").catch(() => undefined));
}

/** Hooks for the end-to-end test: feed a recognised net without the camera. */
initLearn(showScreen);
initSpeed();

(window as unknown as { rcsolverTest: unknown }).rcsolverTest = {
  learn: learnTest,
  speed: speedTest,
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
  get marks() {
    return cubeView.markedKeys();
  },
  /** Where a sticker ("x,y,z|nx,ny,nz") is drawn on the cube canvas. */
  stickerPoint(key: string) {
    return cubeView.pointOf(key);
  },
  /** The cube on screen as a net, to compare states across pages. */
  get cubeNet() {
    return net ? toNet(net.size, cubeView.getState()) : null;
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
