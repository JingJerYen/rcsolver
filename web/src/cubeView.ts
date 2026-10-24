/**
 * Canvas 2D renderer for an N×N cube with animated layer turns, generalised from the
 * "照片換角解法" lesson page. Orthographic projection, painter's algorithm, drag to orbit.
 */
import { hexOf } from "./net.js";
import { FACE_AXES, applyMove, layerValues, rotateVec, type Move, type Sticker, type Vec } from "./cubeState.js";

const DEFAULT_VIEW = { yaw: 0.62, pitch: 0.52 };

export class CubeView {
  private ctx: CanvasRenderingContext2D;
  private size = 3;
  private stickers: Sticker[] = [];
  private lookup = new Map<string, string>();
  /** Sticker position key → index in `stickers`; the index is the sticker itself, since turns keep the order. */
  private indexAt = new Map<string, number>();
  /**
   * Study mode's marks: stickers (by index) tapped to carry a dot. Turns move stickers but keep their
   * order in the list, so a mark stays on its sticker wherever it goes.
   */
  private marks = new Set<number>();
  private marking = false;
  /** Where each visible sticker was last drawn, front last, for finding the one under a tap. */
  private hits: { poly: [number, number][]; key: string }[] = [];
  private press: { x: number; y: number; moved: boolean } | null = null;
  private w = 300;
  private h = 300;
  private yaw = DEFAULT_VIEW.yaw;
  private pitch = DEFAULT_VIEW.pitch;
  private anim: { move: Move; dir: 1 | -1; start: number; duration: number; f: number; resolve: () => void } | null = null;
  private raf = 0;
  private drag: { x: number; y: number } | null = null;
  private ro: ResizeObserver;
  private orbitSpeed = 0;
  private orbitRaf = 0;
  /** Direction arrows during turns; off for decorative views. */
  showArrows = true;
  /**
   * What stays in colour while the rest is plain grey: sticker keys ("x,y,z|nx,ny,nz") by position,
   * or pieces by their colour signature (sorted colours), which follows the piece as it moves.
   */
  private focus: { keys: Set<string> } | { pieces: Set<string> } | null = null;

  setFocus(focus: { keys: Set<string> } | { pieces: Set<string> } | null) {
    this.focus = focus;
    if (!this.anim) this.draw();
  }

  /** A move shown without turning: its layers outlined and its arrow drawn, as at the start of a turn. */
  private preview: Move | null = null;

  setPreview(move: Move | null) {
    this.preview = move;
    if (!this.anim) this.draw();
  }

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext("2d")!;
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas);
    canvas.addEventListener("pointerdown", (e) => {
      this.drag = { x: e.clientX, y: e.clientY };
      this.press = { x: e.clientX, y: e.clientY, moved: false };
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener("pointermove", (e) => {
      if (!this.drag) return;
      if (this.press && Math.hypot(e.clientX - this.press.x, e.clientY - this.press.y) > 6) this.press.moved = true;
      // yaw moves the camera, so the cube turns the other way: subtract to make it follow the finger
      this.yaw -= (e.clientX - this.drag.x) * 0.009;
      this.pitch = Math.max(-1.2, Math.min(1.4, this.pitch + (e.clientY - this.drag.y) * 0.009));
      this.drag = { x: e.clientX, y: e.clientY };
      if (!this.anim) this.draw();
    });
    const up = () => (this.drag = null);
    canvas.addEventListener("pointerup", (e) => {
      up();
      // a tap (not a drag) on a sticker toggles its mark
      const press = this.press;
      this.press = null;
      if (!this.marking || !press || press.moved || this.anim) return;
      const r = canvas.getBoundingClientRect();
      this.toggleMarkAt(e.clientX - r.left, e.clientY - r.top);
    });
    canvas.addEventListener("pointercancel", () => {
      up();
      this.press = null;
    });
    this.resize();
  }

  setState(size: number, stickers: Sticker[]) {
    this.size = size;
    this.stickers = stickers;
    this.lookup = new Map(stickers.map((s) => [`${s.p.join(",")}|${s.n.join(",")}`, s.c]));
    this.indexAt = new Map(stickers.map((s, i) => [`${s.p.join(",")}|${s.n.join(",")}`, i]));
    this.draw();
  }

  /** Let taps mark stickers (study mode); turning it off also clears the marks. */
  setMarking(on: boolean) {
    this.marking = on;
    if (!on) this.clearMarks();
  }

  /** Where the marked stickers are now, as "x,y,z|nx,ny,nz" keys. */
  markedKeys(): string[] {
    return [...this.marks].map((i) => `${this.stickers[i]!.p.join(",")}|${this.stickers[i]!.n.join(",")}`);
  }

  clearMarks() {
    this.marks.clear();
    if (!this.anim) this.draw();
  }

  private toggleMarkAt(x: number, y: number) {
    const inside = (poly: [number, number][]) => {
      let hit = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [xi, yi] = poly[i]!, [xj, yj] = poly[j]!;
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
      }
      return hit;
    };
    for (let i = this.hits.length - 1; i >= 0; i--) {
      if (!inside(this.hits[i]!.poly)) continue;
      const index = this.indexAt.get(this.hits[i]!.key);
      if (index === undefined) return;
      if (!this.marks.delete(index)) this.marks.add(index);
      this.draw();
      return;
    }
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

  /** Keep the camera drifting around the cube (radians per frame); 0 stops it. */
  orbit(speed: number) {
    this.orbitSpeed = speed;
    cancelAnimationFrame(this.orbitRaf);
    if (!speed) return;
    const tick = () => {
      if (!this.orbitSpeed) return;
      this.yaw += this.orbitSpeed;
      if (!this.anim) this.draw();
      this.orbitRaf = requestAnimationFrame(tick);
    };
    this.orbitRaf = requestAnimationFrame(tick);
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

    type FaceDraw = { poly: [number, number][]; st: [number, number][]; col: string | undefined; active: boolean; depth: number; light: number; key: string; marked: boolean };
    const GREY = "#9aa6b5";
    const faces: FaceDraw[] = [];
    for (const x of vals) for (const y of vals) for (const z of vals) {
      // only cubies on the surface have stickers; skip the hidden interior
      if (Math.abs(x) !== size - 1 && Math.abs(y) !== size - 1 && Math.abs(z) !== size - 1) continue;
      const c: Vec = [x, y, z];
      const shown = anim?.move ?? this.preview;
      const active = !!shown && shown.layers.includes(c[shown.axis]);
      const focus = this.focus;
      let pieceMuted = false;
      if (focus && "pieces" in focus) {
        const cols: string[] = [];
        for (let ax = 0; ax < 3; ax++) {
          if (Math.abs(c[ax]!) !== size - 1) continue;
          const n: Vec = [0, 0, 0];
          n[ax] = Math.sign(c[ax]!);
          const col = this.lookup.get(`${c.join(",")}|${n.join(",")}`);
          if (col) cols.push(col);
        }
        pieceMuted = !focus.pieces.has(cols.sort().join(""));
      }
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
        const key = `${c.join(",")}|${n.join(",")}`;
        const raw = this.lookup.get(key);
        const muted = focus !== null && ("keys" in focus ? !focus.keys.has(key) : pieceMuted);
        const centre: Vec = [...c] as Vec;
        centre[ax] += sign;
        faces.push({
          poly: polygon(0.975),
          st: polygon(0.8),
          col: raw ? (muted ? GREY : hexOf(raw)) : undefined,
          active,
          key,
          marked: this.marks.size > 0 && this.marks.has(this.indexAt.get(key) ?? -1),
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
        if (f.marked) this.drawMark(f.st);
      }
    }
    this.hits = faces.map((f) => ({ poly: f.poly, key: f.key }));
    if (anim && this.showArrows) this.drawArrow(anim.move, anim.dir, project, b.view, now);
    else if (this.preview && this.showArrows) this.drawArrow(this.preview, 1, project, b.view, now);
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
    const hidden = false;
    // A face turned away from the camera gets the belt instead: a ring around the cube at that
    // layer's height, in front of everything, sweeping the way its side stickers move.
    const faceVisible = n[0] * view[0] + n[1] * view[1] + n[2] * view[2] >= 0.15;
    if (outerOnly && faceVisible) {
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
    // A half turn is drawn as two chained quarter arrows, so "turn twice" is visible at a glance.
    const segments = Math.abs(move.q) === 2 ? [[0, 13], [15, steps]] : [[0, steps]];
    for (const [from, to] of segments) {
      const part = pts.slice(from, to + 1);
      for (const [width, color] of [[11, "rgba(255,255,255,.9)"], [5.5, `rgba(25,94,214,${pulse})`]] as const) {
        ctx.beginPath();
        part.forEach((p, i) => (i ? ctx.lineTo(...p) : ctx.moveTo(...p)));
        ctx.lineWidth = width;
        ctx.strokeStyle = color;
        ctx.stroke();
      }
      ctx.setLineDash([]);
      this.drawHead(part[part.length - 1]!, part[part.length - 3]!);
      if (hidden) ctx.setLineDash([9, 7]);
    }
    ctx.restore();
  }

  /** A mark: a dark dot with a thin white ring in the middle of the sticker. */
  private drawMark(st: [number, number][]) {
    const { ctx } = this;
    const cx = st.reduce((a, p) => a + p[0], 0) / st.length;
    const cy = st.reduce((a, p) => a + p[1], 0) / st.length;
    const side = Math.min(Math.hypot(st[1]![0] - st[0]![0], st[1]![1] - st[0]![1]), Math.hypot(st[3]![0] - st[0]![0], st[3]![1] - st[0]![1]));
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, Math.max(4, side * 0.2), 0, Math.PI * 2);
    ctx.fillStyle = "#172336";
    ctx.fill();
    ctx.lineWidth = Math.max(1.5, side * 0.04);
    ctx.strokeStyle = "#fff";
    ctx.stroke();
    ctx.restore();
  }

  private drawHead(end: [number, number], prev: [number, number]) {
    const { ctx } = this;
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
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    cancelAnimationFrame(this.orbitRaf);
    this.ro.disconnect();
  }
}
