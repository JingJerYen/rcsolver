import { ApiError, FACES, getHealth, recognize, type Face, type FaceImage, type RecognizeResponse } from "./api.js";
import { STEPS, captureFromFile, captureFromVideo, closeCamera, openCamera, turnsBefore } from "./capture.js";
import { GuideCube } from "./guideCube.js";
import { accuracy, makeState, renderLegend, renderNet, type NetState } from "./net.js";

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

/** null = let the model count. After recognition this holds the size the model saw. */
let size: number | null = null;
let stepIndex = 0;
let images: Partial<Record<Face, FaceImage>> = {};
let response: RecognizeResponse | null = null;
let net: NetState | null = null;

const video = $<HTMLVideoElement>("video");
const guide = new GuideCube($<HTMLCanvasElement>("guide"));

function show(id: string, on: boolean) {
  $(id).classList.toggle("hidden", !on);
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
  $("historyCount").textContent = runs.length ? `（${runs.length} 次）` : "";
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
  show("setup", false);
  show("review", false);
  show("result", false);
  show("capture", true);
  renderStep();
  $("camError").classList.add("hidden");
  $<HTMLButtonElement>("shoot").disabled = false;
  try {
    await openCamera(video);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    $("camError").textContent = `打不開相機：${msg}\n可以改用「從相簿選擇」，或確認網址是 https。`;
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
  show("capture", false);
  show("review", true);
  $("reviewThumbs").innerHTML = thumbsHtml(null);
  $("sendStatus").textContent = "";
  $<HTMLButtonElement>("send").disabled = false;
}

function cancelCapture() {
  closeCamera(video);
  guide.stop();
  show("capture", false);
  show("setup", true);
}

/* ---------- recognition ---------- */

async function send() {
  const faces = images as Record<Face, FaceImage>;
  if (FACES.some((f) => !faces[f])) return;
  $<HTMLButtonElement>("send").disabled = true;
  $("sendStatus").innerHTML = `<span class="spinner"></span>辨識中，通常要 10～40 秒……`;
  const started = Date.now();
  try {
    response = await recognize(size, faces);
  } catch (err) {
    const msg = err instanceof ApiError ? `${err.message}（${err.code}）` : err instanceof Error ? err.message : String(err);
    $("sendStatus").textContent = `失敗：${msg}`;
    $<HTMLButtonElement>("send").disabled = false;
    return;
  }
  $("sendStatus").textContent = `完成，${((Date.now() - started) / 1000).toFixed(1)} 秒。`;
  showResult();
}

function showResult() {
  if (!response) return;
  size = response.size;
  net = makeState(size, response.recognition);
  const sn = $("sizeNote");
  const mm = response.sizeMismatch;
  sn.classList.toggle("hidden", !mm);
  sn.textContent = mm ? `你選的是 ${mm.requested}×${mm.requested}，照片看起來是 ${mm.detected}×${mm.detected}，已改用 ${mm.detected}×${mm.detected} 辨識。` : "";
  show("review", false);
  show("result", true);
  renderNet($("net"), net, refreshStats);
  const warn = $("warnings");
  warn.classList.toggle("hidden", response.warnings.length === 0);
  warn.textContent = response.warnings.length ? `顏色數量對不上：${response.warnings.join("；")}。至少有一格讀錯了。` : "";
  $("notes").innerHTML = response.recognition.notes.map((n) => `<li>${escapeHtml(n)}</li>`).join("");
  $<HTMLButtonElement>("record").disabled = false;
  refreshStats();
  $("result").scrollIntoView({ behavior: "smooth" });
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
  $("history").scrollIntoView({ behavior: "smooth" });
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
    el.textContent = h.mock ? ` 目前是 MOCK 模式（${h.mockReason}），結果是假的。` : ` 模型：${h.model}，今天已用 ${h.dailyUsed}/${h.dailyLimit}。`;
    el.classList.toggle("bad", h.mock);
  })
  .catch(() => {
    $("health").textContent = " 連不上伺服器。";
    $("health").classList.add("bad");
  });
