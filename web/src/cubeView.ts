/**
 * Canvas 2D renderer for an N×N cube with animated layer turns, generalised from the
 * "照片換角解法" lesson page. Orthographic projection, painter's algorithm, drag to orbit.
 */
import { COLOR_HEX } from "./net.js";
import { FACE_AXES, applyMove, layerValues, rotateVec, type Move, type Sticker, type Vec } from "./cubeState.js";

const DEFAULT_VIEW = { yaw: 0.62, pitch: 0.52 };

export class CubeView {
  private ctx: CanvasRenderingContext2D;
  private size = 3;
  private stickers: Sticker[] = [];
  private lookup = new Map<string, string>();
  private w = 300;
  private h = 300;
  private yaw = DEFAULT_VIEW.yaw;
  private pitch = DEFAULT_VIEW.pitch;
  private anim: { move: Move; dir: 1 | -1; start: number; duration: number; f: number; resolve: () => void } | null = null;
  private raf = 0;
  private drag: { x: number; y: number } | null = null;
  private ro: ResizeObserver;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext("2d")!;
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas);
    canvas.addEventListener("pointerdown", (e) => {
      this.drag = { x: e.clientX, y: e.clientY };
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener("pointermove", (e) => {
      if (!this.drag) return;
      this.yaw += (e.clientX - this.drag.x) * 0.009;
      this.pitch = Math.max(-1.2, Math.min(1.4, this.pitch + (e.clientY - this.drag.y) * 0.009));
      this.drag = { x: e.clientX, y: e.clientY };
      if (!this.anim) this.draw();
    });
    const up = () => (this.drag = null);
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);
    this.resize();
  }

  setState(size: number, stickers: Sticker[]) {
    this.size = size;
    this.stickers = stickers;
    this.lookup = new Map(stickers.map((s) => [`${s.p.join(",")}|${s.n.join(",")}`, s.c]));
    this.draw();
  }

  getState(): Sticker[] {
    return this.stickers;
  }

  get animating() {
    return this.anim !== null;
  }

  resetView() {
    this.yaw = DEFAULT_VIEW.yaw;
    this.pitch = DEFAULT_VIEW.pitch;
    this.draw();
  }

  /** Animate `move` (or its inverse when dir is -1), then commit it to the state. */
  animate(move: Move, dir: 1 | -1, duration: number): Promise<void> {
    if (this.anim) return Promise.resolve();
    return new Promise((resolve) => {
      this.anim = { move, dir, start: performance.now(), duration, f: 0, resolve };
      const tick = (now: number) => {
        if (!this.anim) return;
        const f = Math.min(1, (now - this.anim.start) / this.anim.duration);
        this.anim.f = f * f * (3 - 2 * f);
        this.draw(now);
        if (f < 1) {
          this.raf = requestAnimationFrame(tick);
          return;
        }
        const mv = this.anim.dir === 1 ? move : { ...move, angle: -move.angle };
        const done = this.anim.resolve;
        this.anim = null;
        this.setState(this.size, applyMove(this.stickers, mv));
        done();
      };
      this.raf = requestAnimationFrame(tick);
    });
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
    this.draw();
  }

  private basis() {
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw), cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    return { right: [cy, 0, -sy] as Vec, up: [-sy * sp, cp, -cy * sp] as Vec, view: [sy * cp, sp, cy * cp] as Vec };
  }

  draw(now = performance.now()) {
    const { ctx, w, h, size } = this;
    if (!w || !h || !this.stickers.length) return;
    ctx.clearRect(0, 0, w, h);
    const b = this.basis();
    const dot = (a: Vec, c: Vec) => a[0] * c[0] + a[1] * c[1] + a[2] * c[2];
    const scale = (Math.min(w, h) * 0.42) / (size * 1.75);
    const project = (p: Vec): [number, number] => [w / 2 + dot(p, b.right) * scale, h / 2 - dot(p, b.up) * scale];
    const vals = layerValues(size);
    const anim = this.anim;
    const angle = anim ? anim.move.angle * anim.dir * anim.f : 0;
    const rot = (p: Vec, active: boolean): Vec => (active && anim ? rotateVec(p, anim.move.axis, angle) : p);

    type FaceDraw = { poly: [number, number][]; st: [number, number][]; col: string | undefined; active: boolean; depth: number; light: number };
    const faces: FaceDraw[] = [];
    for (const x of vals) for (const y of vals) for (const z of vals) {
      // only cubies on the surface have stickers; skip the hidden interior
      if (Math.abs(x) !== size - 1 && Math.abs(y) !== size - 1 && Math.abs(z) !== size - 1) continue;
      const c: Vec = [x, y, z];
      const active = !!anim && anim.move.layers.includes(c[anim.move.axis]);
      for (let ax = 0; ax < 3; ax++) for (const sign of [-1, 1] as const) {
        const n: Vec = [0, 0, 0];
        n[ax] = sign;
        const rn = rot(n, active);
        if (dot(rn, b.view) <= 0.001) continue;
        const a = (ax + 1) % 3, v = (ax + 2) % 3;
        const polygon = (half: number): [number, number][] =>
          ([[-1, -1], [1, -1], [1, 1], [-1, 1]] as const).map(([u, vv]) => {
            const p: Vec = [...c] as Vec;
            p[ax] += sign * 0.975;
            p[a] += u * half;
            p[v] += vv * half;
            return project(rot(p, active));
          });
        const col = this.lookup.get(`${c.join(",")}|${n.join(",")}`);
        const centre: Vec = [...c] as Vec;
        centre[ax] += sign;
        faces.push({
          poly: polygon(0.975),
          st: polygon(0.8),
          col: col ? COLOR_HEX[col as keyof typeof COLOR_HEX] : undefined,
          active,
          depth: dot(rot(centre, active), b.view),
          light: 0.7 + 0.3 * Math.max(0, dot(rn, [0.3, 0.8, 0.5])),
        });
      }
    }
    faces.sort((p, q) => p.depth - q.depth);
    const path = (ps: [number, number][]) => {
      ctx.beginPath();
      ps.forEach((p, i) => (i ? ctx.lineTo(...p) : ctx.moveTo(...p)));
      ctx.closePath();
    };
    for (const f of faces) {
      path(f.poly);
      ctx.fillStyle = "#172336";
      ctx.fill();
      if (f.col) {
        path(f.st);
        ctx.fillStyle = f.col;
        ctx.fill();
        ctx.fillStyle = `rgba(0,0,0,${(1 - f.light) * 0.35})`;
        ctx.fill();
        ctx.strokeStyle = f.active ? "#fff1a8" : "rgba(255,255,255,.18)";
        ctx.lineWidth = f.active ? 2 : 1;
        ctx.stroke();
      }
    }
    if (anim) this.drawArrow(anim.move, anim.dir, project, b.view, now);
  }

  /**
   * Curved arrow sweeping the way the layer goes. An outer-face turn gets an arrow floating over
   * that face; an inner slice or a wide turn gets a belt around the cube at the height of the
   * layers that move, centred on the side facing the camera.
   */
  private drawArrow(move: Move, dir: 1 | -1, project: (p: Vec) => [number, number], view: Vec, now: number) {
    const { ctx, size } = this;
    const ax = FACE_AXES[move.face];
    const n = ax.n;
    const outerOnly = move.layers.length === 1 && Math.abs(move.layers[0]!) === size - 1;
    const sweep = move.angle * dir; // a 180° turn gets a half-circle arrow
    const pts: [number, number][] = [];
    const steps = 28;
    let hidden = false;
    if (outerOnly) {
      // A face turned away from the camera still gets its arrow, drawn as if seen through the cube:
      // its projection shows the true motion of that layer, the same way its side stickers move.
      hidden = n[0] * view[0] + n[1] * view[1] + n[2] * view[2] < 0.15;
      const out = size + 0.9;
      const r = size * 0.62;
      const centre: Vec = [n[0] * out, n[1] * out, n[2] * out];
      const start: Vec = [centre[0] + ax.right[0] * r, centre[1] + ax.right[1] * r, centre[2] + ax.right[2] * r];
      for (let i = 0; i <= steps; i++) pts.push(project(rotateVec(start, move.axis, sweep * (i / steps - 0.5))));
    } else {
      const height = move.layers.reduce((a, b) => a + b, 0) / move.layers.length;
      const r = size + 1.1;
      // start on the belt at the point nearest the camera, then sweep ±45° (or ±90° for a half turn)
      const radial: Vec = [view[0], view[1], view[2]];
      radial[move.axis] = 0;
      const len = Math.hypot(...radial) || 1;
      const start: Vec = [0, 0, 0];
      for (let i = 0; i < 3; i++) start[i] = (radial[i] / len) * r;
      start[move.axis] = height;
      for (let i = 0; i <= steps; i++) pts.push(project(rotateVec(start, move.axis, sweep * (i / steps - 0.5))));
    }
    const pulse = 0.85 + 0.15 * Math.sin(now / 150);
    ctx.save();
    if (hidden) {
      ctx.globalAlpha = 0.55;
      ctx.setLineDash([9, 7]);
    }
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const [width, color] of [[11, "rgba(255,255,255,.9)"], [5.5, `rgba(25,94,214,${pulse})`]] as const) {
      ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo(...p) : ctx.moveTo(...p)));
      ctx.lineWidth = width;
      ctx.strokeStyle = color;
      ctx.stroke();
    }
    ctx.setLineDash([]);
    const end = pts[pts.length - 1]!;
    const prev = pts[pts.length - 3]!;
    const a = Math.atan2(end[1] - prev[1], end[0] - prev[0]);
    const head = 16;
    ctx.beginPath();
    ctx.moveTo(end[0] + Math.cos(a) * head * 0.7, end[1] + Math.sin(a) * head * 0.7);
    ctx.lineTo(end[0] + Math.cos(a + 2.5) * head, end[1] + Math.sin(a + 2.5) * head);
    ctx.lineTo(end[0] + Math.cos(a - 2.5) * head, end[1] + Math.sin(a - 2.5) * head);
    ctx.closePath();
    ctx.fillStyle = "#195ed6";
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = "rgba(255,255,255,.9)";
    ctx.stroke();
    ctx.restore();
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
  }
}
