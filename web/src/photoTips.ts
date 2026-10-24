/**
 * Pictures for the "how to shoot" card: one face straight on filling the frame (right), the whole
 * cube at an angle and a face too far away (both wrong). Drawn rather than shipped as images, and
 * wordless on screen so the card works in any language; its one instruction is spoken instead.
 */
import { LANG, tr } from "./i18n.js";

type Vec = [number, number, number];

const COLOURS: Record<string, string> = { W: "#f2f2ec", Y: "#ffd21c", R: "#d42630", O: "#ff7a14", G: "#1c9c4a", B: "#1d5dd6" };
const FRONT = "GRWYGBOWG";
const TOP = "WWOBWYWRW";
const RIGHT = "RYBWRGROY";

function table(ctx: CanvasRenderingContext2D, w: number) {
  const g = ctx.createRadialGradient(w * 0.5, w * 0.55, w * 0.08, w * 0.5, w * 0.5, w * 0.85);
  g.addColorStop(0, "#76604d");
  g.addColorStop(1, "#2a1f18");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, w);
}

/** One face seen straight on, top-left corner at (x, y). */
function face(ctx: CanvasRenderingContext2D, x: number, y: number, side: number, stickers: string) {
  ctx.fillStyle = "#121519";
  ctx.beginPath();
  ctx.roundRect(x, y, side, side, side * 0.06);
  ctx.fill();
  const gap = side * 0.035;
  const cell = (side - gap * 4) / 3;
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      ctx.fillStyle = COLOURS[stickers[i * 3 + j]!]!;
      ctx.beginPath();
      ctx.roundRect(x + gap + j * (cell + gap), y + gap + i * (cell + gap), cell, cell, cell * 0.12);
      ctx.fill();
    }
  }
}

/** The whole cube from front-right-above, the way it should not be shot. */
function angledCube(ctx: CanvasRenderingContext2D, w: number) {
  const yaw = 0.6, pitch = 0.5;
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  const right: Vec = [cy, 0, -sy];
  const up: Vec = [-sy * sp, cp, -cy * sp];
  const s = w * 0.24;
  const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const at = (p: Vec): [number, number] => [w * 0.5 + dot(p, right) * s, w * 0.52 - dot(p, up) * s];
  const faces: { n: Vec; r: Vec; d: Vec; stickers: string; shade: number }[] = [
    { n: [0, 1, 0], r: [1, 0, 0], d: [0, 0, 1], stickers: TOP, shade: 0 },
    { n: [0, 0, 1], r: [1, 0, 0], d: [0, -1, 0], stickers: FRONT, shade: 0.12 },
    { n: [1, 0, 0], r: [0, 0, -1], d: [0, -1, 0], stickers: RIGHT, shade: 0.25 },
  ];
  for (const f of faces) {
    const pt = (u: number, v: number) => at([f.n[0] + f.r[0] * u + f.d[0] * v, f.n[1] + f.r[1] * u + f.d[1] * v, f.n[2] + f.r[2] * u + f.d[2] * v]);
    const quad = (u0: number, v0: number, u1: number, v1: number) => {
      ctx.beginPath();
      ctx.moveTo(...pt(u0, v0));
      ctx.lineTo(...pt(u1, v0));
      ctx.lineTo(...pt(u1, v1));
      ctx.lineTo(...pt(u0, v1));
      ctx.closePath();
    };
    quad(-1, -1, 1, 1);
    ctx.fillStyle = "#13171d";
    ctx.fill();
    const g = 0.08;
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        quad(-1 + (2 * j) / 3 + g, -1 + (2 * i) / 3 + g, -1 + (2 * (j + 1)) / 3 - g, -1 + (2 * (i + 1)) / 3 - g);
        ctx.fillStyle = COLOURS[f.stickers[i * 3 + j]!]!;
        ctx.fill();
      }
    }
    quad(-1, -1, 1, 1);
    ctx.fillStyle = `rgba(0,0,0,${f.shade})`;
    ctx.fill();
  }
}

const PICTURES: Record<string, (ctx: CanvasRenderingContext2D, w: number) => void> = {
  good: (ctx, w) => {
    table(ctx, w);
    face(ctx, w * 0.06, w * 0.06, w * 0.88, FRONT);
  },
  angled: (ctx, w) => {
    table(ctx, w);
    angledCube(ctx, w);
  },
  far: (ctx, w) => {
    table(ctx, w);
    face(ctx, w * 0.38, w * 0.4, w * 0.24, FRONT);
  },
};

/** Paint every `canvas[data-tip]` under `root`; call once it is on screen so the sizes are known. */
export function drawPhotoTips(root: HTMLElement) {
  const dpr = window.devicePixelRatio || 1;
  for (const canvas of root.querySelectorAll<HTMLCanvasElement>("canvas[data-tip]")) {
    const w = canvas.clientWidth;
    if (!w) continue;
    canvas.width = canvas.height = Math.round(w * dpr);
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    PICTURES[canvas.dataset.tip!]?.(ctx, w);
  }
}

/**
 * Say the card's one instruction out loud as it opens. Browsers only allow speech started from a
 * tap, which is how the card opens (the camera button or "?"). When the device lists voices but
 * none in the page's language, stay quiet rather than read Chinese with an English voice.
 */
export function speakPhotoTip() {
  const synth = globalThis.speechSynthesis;
  if (!synth) return;
  const want = LANG === "zh" ? ["zh-tw", "zh"] : ["en"];
  const voices = synth.getVoices();
  const voice = want.map((p) => voices.find((v) => v.lang.toLowerCase().replace("_", "-").startsWith(p))).find(Boolean);
  if (voices.length && !voice) return;
  synth.cancel();
  const say = new SpeechSynthesisUtterance(tr("一次只拍一個面，請按照圖示轉動。", "Take one face at a time, and turn the cube as the picture shows."));
  say.lang = voice?.lang ?? (LANG === "zh" ? "zh-TW" : "en-US");
  if (voice) say.voice = voice;
  synth.speak(say);
}

/** Stop talking when the card closes. */
export function stopPhotoTip() {
  globalThis.speechSynthesis?.cancel();
}
