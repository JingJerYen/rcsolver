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
const FACE_AXES: Record<Face, { n: Vec; right: Vec; down: Vec }> = {
  F: { n: [0, 0, 1], right: [1, 0, 0], down: [0, -1, 0] },
  R: { n: [1, 0, 0], right: [0, 0, -1], down: [0, -1, 0] },
  B: { n: [0, 0, -1], right: [-1, 0, 0], down: [0, -1, 0] },
  L: { n: [-1, 0, 0], right: [0, 0, 1], down: [0, -1, 0] },
  U: { n: [0, 1, 0], right: [1, 0, 0], down: [0, 0, 1] },
  D: { n: [0, -1, 0], right: [1, 0, 0], down: [0, 0, -1] },
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

/**
 * Camera for zoom `z`: 0 is the front-right-above view, 1 looks straight at the front face, which
 * is what the photo should look like. Shooting the whole cube at an angle came from copying the
 * angled view, so every step ends on that straight-on shot.
 */
function camera(z: number) {
  const yaw = YAW * (1 - z), pitch = PITCH * (1 - z);
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  return { right: [cy, 0, -sy] as Vec, up: [-sy * sp, cp, -cy * sp] as Vec, view: [sy * cp, sp, cy * cp] as Vec };
}

const smooth = (f: number) => f * f * (3 - 2 * f);

const HOLD_BEFORE = 1300;
const TURN_MS = 2200;
const ZOOM_MS = 900;
const HOLD_ZOOMED = 2600;

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

  /**
   * Orientation at animation time `ms`; `arrow` is the gesture whose direction arrow to show, if any,
   * and `zoom` how far the camera has moved in on the face to shoot (0–1, after the turns).
   */
  private orientation(ms: number): { m: Mat; done: boolean; arrow: Gesture | null; zoom: number } {
    const g = this.step.gestures;
    const total = HOLD_BEFORE + g.length * TURN_MS + ZOOM_MS + HOLD_ZOOMED;
    const t = ms % total;
    let m = this.base;
    if (t < HOLD_BEFORE) return { m, done: g.length === 0, arrow: g[0] ?? null, zoom: 0 };
    let rest = t - HOLD_BEFORE;
    for (const gesture of g) {
      if (rest >= TURN_MS) {
        m = mul(rot(gesture.axis, gesture.deg), m);
        rest -= TURN_MS;
        continue;
      }
      return { m: mul(rot(gesture.axis, gesture.deg * smooth(rest / TURN_MS)), m), done: false, arrow: gesture, zoom: 0 };
    }
    return { m, done: true, arrow: null, zoom: smooth(Math.min(1, rest / ZOOM_MS)) };
  }

  /**
   * Curved arrow around the turn axis through the cube's centre, so it reads as the whole cube
   * turning. The 90° sweep is centred on the front, where the camera sees it, and ends with the
   * arrowhead pointing the way the front face is about to move.
   */
  private drawArrow(g: Gesture, project: (p: Vec) => [number, number]) {
    const { ctx } = this;
    const front: Vec = [0, 0, 1.8];
    const pts: [number, number][] = [];
    for (let i = 0; i <= 24; i++) pts.push(project(apply(rot(g.axis, g.deg * (i / 24 - 0.5)), front)));
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
    const { m, done, arrow, zoom } = this.orientation(now - this.t0);
    const cam = camera(zoom);
    // zoomed in, the front face fills most of the height, like the frame in the viewfinder
    const s = Math.min(w, h) * 0.27 * (1 - zoom) + h * 0.37 * zoom;
    const project = (p: Vec): [number, number] => [w / 2 + dot(p, cam.right) * s, h / 2 + 6 * (1 - zoom) - dot(p, cam.up) * s];
    const pulse = 0.5 + 0.5 * Math.sin(now / 180);

    const faces = (Object.keys(FACE_AXES) as Face[]).map((face) => {
      const ax = FACE_AXES[face];
      const n = apply(m, ax.n);
      const r = apply(m, ax.right);
      const d = apply(m, ax.down);
      const corners: Vec[] = [add(n, scale(r, -1), scale(d, -1)), add(n, r, scale(d, -1)), add(n, r, d), add(n, scale(r, -1), d)];
      return { face, n, corners: corners.map(project), depth: dot(n, cam.view), light: 0.72 + 0.28 * Math.max(0, dot(n, [0.3, 0.8, 0.5])) };
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
      if (isTarget && zoom > 0.5) this.drawGrid(f.corners, (zoom - 0.5) * 2);
      path();
      ctx.lineWidth = isTarget ? 3 + 2 * pulse : 1.5;
      ctx.strokeStyle = isTarget ? "#ffb703" : "#1b2a3d";
      ctx.stroke();

      // Markers instead of words: a dot on the face that must stay up, a camera on the face to shoot.
      const cx = (p0[0] + p2[0]) / 2;
      const cy = (p0[1] + p2[1]) / 2;
      if (f.face === "U") {
        ctx.beginPath();
        ctx.arc(cx, cy, 7, 0, Math.PI * 2);
        ctx.fillStyle = "#2b3b52";
        ctx.fill();
        ctx.lineWidth = 3;
        ctx.strokeStyle = "rgba(255,255,255,.9)";
        ctx.stroke();
      }
      if (isTarget && done) this.drawCamera(cx, cy, (1 + 0.08 * pulse) * (1 + 0.35 * zoom));
      if (isTarget && zoom > 0.6) this.drawBrackets(f.corners, (zoom - 0.6) / 0.4);
    }
    if (arrow) this.drawArrow(arrow, project);
  }

  /** Dashed sticker lines on the face to shoot: "fill the frame with this". 3×3 just as a picture. */
  private drawGrid(corners: [number, number][], alpha: number) {
    const { ctx } = this;
    const [p0, p1, , p3] = corners as [[number, number], [number, number], [number, number], [number, number]];
    const at = (u: number, v: number): [number, number] => [p0[0] + (p1[0] - p0[0]) * u + (p3[0] - p0[0]) * v, p0[1] + (p1[1] - p0[1]) * u + (p3[1] - p0[1]) * v];
    ctx.save();
    ctx.setLineDash([5, 4]);
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = `rgba(150,80,0,${0.6 * alpha})`;
    for (const k of [1 / 3, 2 / 3]) {
      ctx.beginPath();
      ctx.moveTo(...at(k, 0));
      ctx.lineTo(...at(k, 1));
      ctx.moveTo(...at(0, k));
      ctx.lineTo(...at(1, k));
      ctx.stroke();
    }
    ctx.restore();
  }

  /** Viewfinder corner marks just outside the face, once the camera is straight on. */
  private drawBrackets(corners: [number, number][], alpha: number) {
    const { ctx } = this;
    const xs = corners.map((p) => p[0]);
    const ys = corners.map((p) => p[1]);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const half = (Math.max(...xs) - Math.min(...xs)) / 2 + 9;
    const len = half * 0.42;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = "#195ed6";
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
      const x = cx + sx * half;
      const y = cy + sy * half;
      ctx.beginPath();
      ctx.moveTo(x - sx * len, y);
      ctx.lineTo(x, y);
      ctx.lineTo(x, y - sy * len);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawCamera(cx: number, cy: number, k: number) {
    const { ctx } = this;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(k, k);
    ctx.lineWidth = 2.4;
    ctx.strokeStyle = "#b35c00";
    ctx.fillStyle = "rgba(255,255,255,.85)";
    ctx.beginPath();
    ctx.roundRect(-15, -9, 30, 20, 4);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-6, -9);
    ctx.lineTo(-3, -13);
    ctx.lineTo(3, -13);
    ctx.lineTo(6, -9);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 1, 5.5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  destroy() {
    this.stop();
    this.ro.disconnect();
  }
}
