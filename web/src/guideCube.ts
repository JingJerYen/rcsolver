/**
 * A small animated cube that demonstrates each whole-cube turn of the capture sequence.
 * Faces the user has already photographed show the photo itself, so the animation reads as
 * "the face I just shot moves away, this new face comes to the front".
 */
import type { Face } from "./api.js";

type Vec = [number, number, number];
type Mat = [Vec, Vec, Vec]; // rows

export interface Gesture {
  axis: "x" | "y";
  /** Degrees, right-hand rule about the world axis (+x = right, +y = up, +z = toward the viewer). */
  deg: number;
}

/** Image axes for each face so that the photo is drawn the way the net expects it. */
const FACE_AXES: Record<Face, { n: Vec; right: Vec; down: Vec; label: string }> = {
  F: { n: [0, 0, 1], right: [1, 0, 0], down: [0, -1, 0], label: "前" },
  R: { n: [1, 0, 0], right: [0, 0, -1], down: [0, -1, 0], label: "右" },
  B: { n: [0, 0, -1], right: [-1, 0, 0], down: [0, -1, 0], label: "後" },
  L: { n: [-1, 0, 0], right: [0, 0, 1], down: [0, -1, 0], label: "左" },
  U: { n: [0, 1, 0], right: [1, 0, 0], down: [0, 0, 1], label: "上" },
  D: { n: [0, -1, 0], right: [1, 0, 0], down: [0, 0, -1], label: "底" },
};

const IDENTITY: Mat = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

function rot(axis: "x" | "y", deg: number): Mat {
  const t = (deg * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  return axis === "x" ? [[1, 0, 0], [0, c, -s], [0, s, c]] : [[c, 0, s], [0, 1, 0], [-s, 0, c]];
}

function mul(a: Mat, b: Mat): Mat {
  const out: number[][] = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) out[i]![j]! += a[i]![k]! * b[k]![j]!;
  return out as Mat;
}

function apply(m: Mat, v: Vec): Vec {
  return [
    m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
    m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
    m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
  ];
}

function add(...vs: Vec[]): Vec {
  return vs.reduce((a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], [0, 0, 0] as Vec);
}

function scale(v: Vec, k: number): Vec {
  return [v[0] * k, v[1] * k, v[2] * k];
}

function dot(a: Vec, b: Vec): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/** Camera looking at the cube from front-right-above, like the lesson page. */
const YAW = 0.6;
const PITCH = 0.5;
const CAM = (() => {
  const cy = Math.cos(YAW), sy = Math.sin(YAW), cp = Math.cos(PITCH), sp = Math.sin(PITCH);
  return { right: [cy, 0, -sy] as Vec, up: [-sy * sp, cp, -cy * sp] as Vec, view: [sy * cp, sp, cy * cp] as Vec };
})();

const HOLD_BEFORE = 1300;
const TURN_MS = 2200;
const HOLD_AFTER = 1800;

export interface GuideStep {
  /** The face that is in front before the gestures. */
  gestures: Gesture[];
  /** The face to photograph once the gestures are done. */
  target: Face;
}

export class GuideCube {
  private ctx: CanvasRenderingContext2D;
  private photos = new Map<Face, HTMLImageElement>();
  private base: Mat = IDENTITY;
  private step: GuideStep = { gestures: [], target: "F" };
  private raf = 0;
  private t0 = 0;
  private w = 300;
  private h = 170;
  private ro: ResizeObserver;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext("2d")!;
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas);
    this.resize();
  }

  /** Photo for a face, drawn on the cube from now on. Pass null to clear. */
  setPhoto(face: Face, dataUrl: string | null) {
    if (!dataUrl) {
      this.photos.delete(face);
      return;
    }
    const img = new Image();
    img.src = dataUrl;
    this.photos.set(face, img);
  }

  /** `base` is the orientation the physical cube is in now (product of all earlier gestures). */
  show(base: Gesture[], step: GuideStep) {
    this.base = base.reduce((m, g) => mul(rot(g.axis, g.deg), m), IDENTITY);
    this.step = step;
    this.t0 = performance.now();
    this.start();
  }

  start() {
    cancelAnimationFrame(this.raf);
    const tick = (now: number) => {
      this.draw(now);
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private resize() {
    const r = this.canvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    this.w = r.width;
    this.h = r.height;
    const d = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(r.width * d);
    this.canvas.height = Math.round(r.height * d);
    this.ctx.setTransform(d, 0, 0, d, 0, 0);
  }

  /** Orientation at animation time `ms`; `arrow` is the gesture whose direction arrow to show, if any. */
  private orientation(ms: number): { m: Mat; done: boolean; arrow: Gesture | null } {
    const g = this.step.gestures;
    const total = HOLD_BEFORE + g.length * TURN_MS + HOLD_AFTER;
    const t = g.length ? ms % total : 0;
    let m = this.base;
    if (t < HOLD_BEFORE) return { m, done: g.length === 0, arrow: g[0] ?? null };
    let rest = t - HOLD_BEFORE;
    for (const gesture of g) {
      if (rest >= TURN_MS) {
        m = mul(rot(gesture.axis, gesture.deg), m);
        rest -= TURN_MS;
        continue;
      }
      const f = rest / TURN_MS;
      const eased = f * f * (3 - 2 * f);
      return { m: mul(rot(gesture.axis, gesture.deg * eased), m), done: false, arrow: gesture };
    }
    return { m, done: true, arrow: null };
  }

  /**
   * Curved arrow just outside the cube showing which way it is about to turn. It lives in world
   * space (the up axis never changes), in the top-front quadrant where the camera can see it.
   */
  private drawArrow(g: Gesture, project: (p: Vec) => [number, number]) {
    const { ctx } = this;
    const start: Vec = g.axis === "y" ? [0, 1.45, 1.35] : g.deg > 0 ? [1.45, 1.35, 0] : [1.45, 0, 1.35];
    const pts: [number, number][] = [];
    for (let i = 0; i <= 24; i++) pts.push(project(apply(rot(g.axis, (g.deg * i) / 24), start)));
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const [width, color] of [[9, "rgba(255,255,255,.85)"], [4.5, "#195ed6"]] as const) {
      ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo(...p) : ctx.moveTo(...p)));
      ctx.lineWidth = width;
      ctx.strokeStyle = color;
      ctx.stroke();
    }
    const end = pts[pts.length - 1]!;
    const prev = pts[pts.length - 3]!;
    const a = Math.atan2(end[1] - prev[1], end[0] - prev[0]);
    const head = 13;
    ctx.beginPath();
    ctx.moveTo(end[0] + Math.cos(a) * head * 0.6, end[1] + Math.sin(a) * head * 0.6);
    ctx.lineTo(end[0] + Math.cos(a + 2.5) * head, end[1] + Math.sin(a + 2.5) * head);
    ctx.lineTo(end[0] + Math.cos(a - 2.5) * head, end[1] + Math.sin(a - 2.5) * head);
    ctx.closePath();
    ctx.fillStyle = "#195ed6";
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(255,255,255,.85)";
    ctx.stroke();
  }

  private draw(now: number) {
    const { ctx, w, h } = this;
    ctx.clearRect(0, 0, w, h);
    const { m, done, arrow } = this.orientation(now - this.t0);
    const s = Math.min(w, h) * 0.27;
    const project = (p: Vec): [number, number] => [w / 2 + dot(p, CAM.right) * s, h / 2 + 6 - dot(p, CAM.up) * s];
    const pulse = 0.5 + 0.5 * Math.sin(now / 180);

    const faces = (Object.keys(FACE_AXES) as Face[]).map((face) => {
      const ax = FACE_AXES[face];
      const n = apply(m, ax.n);
      const r = apply(m, ax.right);
      const d = apply(m, ax.down);
      const corners: Vec[] = [add(n, scale(r, -1), scale(d, -1)), add(n, r, scale(d, -1)), add(n, r, d), add(n, scale(r, -1), d)];
      return { face, n, corners: corners.map(project), depth: dot(n, CAM.view), light: 0.72 + 0.28 * Math.max(0, dot(n, [0.3, 0.8, 0.5])) };
    });
    faces.sort((a, b) => a.depth - b.depth);

    for (const f of faces) {
      if (f.depth <= 0.02) continue;
      const [p0, p1, p2, p3] = f.corners as [[number, number], [number, number], [number, number], [number, number]];
      const path = () => {
        ctx.beginPath();
        ctx.moveTo(...p0);
        ctx.lineTo(...p1);
        ctx.lineTo(...p2);
        ctx.lineTo(...p3);
        ctx.closePath();
      };
      const photo = this.photos.get(f.face);
      const isTarget = f.face === this.step.target;
      if (photo?.complete && photo.naturalWidth) {
        ctx.save();
        path();
        ctx.clip();
        const px = photo.naturalWidth;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        const dpr = window.devicePixelRatio || 1;
        ctx.transform(dpr, 0, 0, dpr, 0, 0);
        ctx.transform((p1[0] - p0[0]) / px, (p1[1] - p0[1]) / px, (p3[0] - p0[0]) / px, (p3[1] - p0[1]) / px, p0[0], p0[1]);
        ctx.drawImage(photo, 0, 0);
        ctx.restore();
        path();
        ctx.fillStyle = `rgba(0,0,0,${(1 - f.light) * 0.5})`;
        ctx.fill();
      } else {
        path();
        ctx.fillStyle = isTarget ? `rgb(255, ${Math.round(230 - 40 * pulse)}, 120)` : "#d7dfea";
        ctx.fill();
        ctx.fillStyle = `rgba(0,0,0,${(1 - f.light) * 0.35})`;
        ctx.fill();
      }
      path();
      ctx.lineWidth = isTarget ? 3 + 2 * pulse : 1.5;
      ctx.strokeStyle = isTarget ? "#ffb703" : "#1b2a3d";
      ctx.stroke();

      // Label at the face centre: the sticky "上" on the up face, "?" on faces not yet shot, "拍這面" on the target.
      let cx = (p0[0] + p2[0]) / 2;
      let cy = (p0[1] + p2[1]) / 2;
      if (photo && f.face === "U") {
        // keep the sticky "上" off the photo: near the face's top edge
        cx = (p0[0] + p1[0]) / 2 * 0.3 + cx * 0.7;
        cy = (p0[1] + p1[1]) / 2 * 0.3 + cy * 0.7;
      }
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      let label = "";
      if (f.face === "U") label = "上";
      if (isTarget && done) label = "拍這面";
      else if (!photo && !isTarget && f.face !== "U") label = FACE_AXES[f.face].label;
      if (label) {
        ctx.font = `700 ${label.length > 1 ? 13 : 16}px system-ui`;
        ctx.lineWidth = 4;
        ctx.strokeStyle = "rgba(255,255,255,.9)";
        ctx.strokeText(label, cx, cy);
        ctx.fillStyle = isTarget && done ? "#b35c00" : "#2b3b52";
        ctx.fillText(label, cx, cy);
      }
    }
    if (arrow) this.drawArrow(arrow, project);
  }

  destroy() {
    this.stop();
    this.ro.disconnect();
  }
}
