/**
 * Canvas 2D renderer for an N×N cube with animated layer turns, generalised from the
 * "照片換角解法" lesson page. Orthographic projection, painter's algorithm, drag to orbit.
 */
import { hexOf } from "./net.js";
import type { Face } from "./api.js";
import { FACE_AXES, FACE_ORDER, applyMove, layerValues, rotateVec, type Move, type Sticker, type Vec } from "./cubeState.js";

const DEFAULT_VIEW = { yaw: 0.62, pitch: 0.52 };

/** `v` turned by `angle` about the unit axis `k` (right-hand rule). */
function turnAbout(v: Vec, k: Vec, angle: number): Vec {
  const c = Math.cos(angle), s = Math.sin(angle);
  const kv = k[0] * v[0] + k[1] * v[1] + k[2] * v[2];
  const x: Vec = [k[1] * v[2] - k[2] * v[1], k[2] * v[0] - k[0] * v[2], k[0] * v[1] - k[1] * v[0]];
  return [0, 1, 2].map((i) => v[i]! * c + x[i]! * s + k[i]! * kv * (1 - c)) as Vec;
}

/** A camera squared up again, so rounding never skews it over many drags. */
function squared(b: { right: Vec; up: Vec }): { right: Vec; up: Vec; view: Vec } {
  const unit = (v: Vec): Vec => {
    const l = Math.hypot(...v) || 1;
    return [v[0] / l, v[1] / l, v[2] / l];
  };
  const r = unit(b.right);
  const d = r[0] * b.up[0] + r[1] * b.up[1] + r[2] * b.up[2];
  const u = unit([b.up[0] - r[0] * d, b.up[1] - r[1] * d, b.up[2] - r[2] * d]);
  return { right: r, up: u, view: [r[1] * u[2] - r[2] * u[1], r[2] * u[0] - r[0] * u[2], r[0] * u[1] - r[1] * u[0]] };
}

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
  /** Study mode's eye: only the pieces carrying a mark keep their colours, the rest go grey. */
  private markedOnly = false;
  /** Told whenever the marks change, with how many there are. */
  onMarks: ((count: number) => void) | null = null;
  /** Where each visible sticker was last drawn, front last, for finding the one under a tap. */
  private hits: { poly: [number, number][]; key: string }[] = [];
  private press: { x: number; y: number; moved: boolean } | null = null;
  /**
   * Turning layers by hand (study mode's switch): a drag that starts on a sticker turns its layer,
   * which follows the finger and settles on the nearest quarter turn when let go.
   */
  private twisting = false;
  /** The sticker a hand turn started on and, once the drag has a direction, the layer it turns. */
  private grab: {
    x: number;
    y: number;
    c: Vec;
    n: Vec;
    /** Fixed after the first few pixels: turn axis, layer, screen direction of a positive turn and pixels per radian. */
    turn: { axis: 0 | 1 | 2; layer: number; dir: [number, number]; pxPerRad: number } | null;
    /** Started on a face's centre with `centreSpin` on: the finger's last angle round that face's middle. */
    spin: { last: number | null } | null;
  } | null = null;
  /** The layer being turned by hand and how far, in radians; `spin` for a whole face turned round its middle. */
  private twist: { axis: 0 | 1 | 2; layers: number[]; angle: number; spin?: boolean } | null = null;
  /** Speed mode: a drag that starts on a face's centre turns that whole face, following the finger round. */
  centreSpin = false;
  /** Asked before a hand turn starts; false leaves the drag to turn the view. */
  canTwist: () => boolean = () => true;
  /** A hand turn that landed: its axis, layer and quarter turns (right-hand rule), already applied. */
  onTwist: ((axis: 0 | 1 | 2, layer: number, quarters: number) => void) | null = null;
  private w = 300;
  private h = 300;
  private yaw = DEFAULT_VIEW.yaw;
  private pitch = DEFAULT_VIEW.pitch;
  /**
   * The speed mode's camera. Within one drag it is yaw and pitch as usual (no pitch limits), so a
   * drag that comes back to where it started leaves the cube as it was; but yaw turns about whatever
   * was the screen's up when the finger came down (`base`, the camera at yaw and pitch 0), so however
   * the cube lies a drag across always turns it across. Null for the usual camera.
   */
  private free: { right: Vec; up: Vec; view: Vec } | null = null;
  private drawQueued = 0;
  /** False: a drag that misses the stickers does nothing, instead of turning the view. */
  viewDrag = true;
  /** The one finger the canvas follows; others that land meanwhile are ignored. */
  private pointer: number | null = null;
  /** Ends a hand turn's settling at once, so the next turn can start straight away. */
  private settling: (() => void) | null = null;
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

  /**
   * Teaching marks over the cube (the learning mode's "when to use it"): arrows from where pieces
   * are to where a formula sends them, by cubie position, and rings on stickers, by key. Not drawn
   * while a layer turns, when they would point at the wrong places.
   */
  private guides: { arrows: [Vec, Vec][]; rings: Set<string> } | null = null;

  setGuides(guides: { arrows: [Vec, Vec][]; rings: Set<string> } | null) {
    this.guides = guides;
    if (!this.anim) this.draw();
  }

  /**
   * The learning mode's axis sign: an arrow out of the centre of each face the camera sees (up,
   * front and right as usual), its letter and name at the tip ("U 上"), turning with the view.
   */
  private axes: Record<Face, string> | null = null;

  setAxes(labels: Record<Face, string> | null) {
    this.axes = labels;
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
      if (this.pointer !== null) return;
      this.pointer = e.pointerId;
      this.press = { x: e.clientX, y: e.clientY, moved: false };
      canvas.setPointerCapture(e.pointerId);
      const r = canvas.getBoundingClientRect();
      if (this.twisting) this.settling?.();
      const key = this.twisting && !this.anim && !this.twist ? this.stickerAt(e.clientX - r.left, e.clientY - r.top) : null;
      if (key && this.canTwist()) {
        const [c, n] = key.split("|").map((v) => v.split(",").map(Number) as Vec) as [Vec, Vec];
        this.grab = { x: e.clientX, y: e.clientY, c, n, turn: null, spin: this.spinsFrom(c, n) ? { last: null } : null };
        this.drag = null;
        return;
      }
      this.drag = this.viewDrag ? { x: e.clientX, y: e.clientY } : null;
    });
    canvas.addEventListener("pointermove", (e) => {
      if (e.pointerId !== this.pointer) return;
      if (this.press && Math.hypot(e.clientX - this.press.x, e.clientY - this.press.y) > 6) this.press.moved = true;
      if (this.grab) {
        this.turnByHand(e.clientX, e.clientY);
        return;
      }
      if (!this.drag) return;
      this.turnView(e.clientX - this.drag.x, e.clientY - this.drag.y);
      this.drag = { x: e.clientX, y: e.clientY };
    });
    const up = () => {
      this.drag = null;
      this.pointer = null;
    };
    canvas.addEventListener("pointerup", (e) => {
      if (e.pointerId !== this.pointer) return;
      up();
      if (this.grab) {
        const turned = this.grab.turn !== null;
        this.grab = null;
        if (turned) {
          this.press = null;
          this.settleTwist();
          return;
        }
      }
      // a tap (not a drag) on a sticker toggles its mark
      const press = this.press;
      this.press = null;
      if (!this.marking || !press || press.moved || this.anim) return;
      const r = canvas.getBoundingClientRect();
      this.toggleMarkAt(e.clientX - r.left, e.clientY - r.top);
    });
    canvas.addEventListener("pointercancel", (e) => {
      if (e.pointerId !== this.pointer) return;
      up();
      this.press = null;
      if (this.grab?.turn) this.settleTwist(true);
      this.grab = null;
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

  /** Mark the sticker now at this position ("x,y,z|nx,ny,nz"). */
  mark(key: string) {
    const index = this.indexAt.get(key);
    if (index === undefined) return;
    this.marks.add(index);
    this.marksChanged();
  }

  clearMarks() {
    this.marks.clear();
    this.marksChanged();
  }

  private marksChanged() {
    this.onMarks?.(this.marks.size);
    if (!this.anim) this.draw();
  }

  /** Grey out every piece without a mark (the pieces follow their stickers as they move). */
  setMarkedOnly(on: boolean) {
    this.markedOnly = on;
    if (!this.anim) this.draw();
  }

  /** The sticker drawn under (x, y), front first, as its "x,y,z|nx,ny,nz" key. */
  private stickerAt(x: number, y: number): string | null {
    const inside = (poly: [number, number][]) => {
      let hit = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [xi, yi] = poly[i]!, [xj, yj] = poly[j]!;
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
      }
      return hit;
    };
    for (let i = this.hits.length - 1; i >= 0; i--) if (inside(this.hits[i]!.poly)) return this.hits[i]!.key;
    return null;
  }

  private toggleMarkAt(x: number, y: number) {
    const key = this.stickerAt(x, y);
    const index = key === null ? undefined : this.indexAt.get(key);
    if (index === undefined) return;
    if (!this.marks.delete(index)) this.marks.add(index);
    this.marksChanged();
  }

  /** Where a visible sticker was last drawn (its centre, canvas pixels), or null. */
  pointOf(key: string): [number, number] | null {
    const hit = this.hits.find((h) => h.key === key);
    if (!hit) return null;
    return [hit.poly.reduce((a, p) => a + p[0], 0) / 4, hit.poly.reduce((a, p) => a + p[1], 0) / 4];
  }

  /**
   * Let drags that start on a sticker turn its layer (study mode's hand-turn switch). The cube is
   * drawn larger meanwhile, so the stickers of a big cube are easier to hit; it then fills the
   * canvas at the usual angles and only clips a corner at extreme ones.
   */
  setTwisting(on: boolean) {
    this.twisting = on;
    if (!this.anim) this.draw();
  }

  /** Pixels per cube unit. */
  private scale(): number {
    // turned freely any corner can point at the screen's edge: fit the whole sphere round the cube
    if (this.free) return (Math.min(this.w, this.h) * 0.49) / (this.size * Math.sqrt(3));
    // turned by hand the cube is drawn bigger; with the axis arrows a little smaller, to leave them room round it
    return ((Math.min(this.w, this.h) * 0.42) / (this.size * 1.75)) * (this.axes ? 0.92 : this.twisting ? 1.3 : 1);
  }

  /**
   * Follow the finger. The first few pixels pick the turn: of the sticker's face's two directions,
   * the one the drag runs along is how the sticker moves, so the layer turns about the third axis.
   * After that the angle is the drag's length along that direction over the sticker's distance from
   * the axis, so the sticker stays under the finger.
   */
  private turnByHand(x: number, y: number) {
    const g = this.grab!;
    if (g.spin) {
      this.spinByHand(x, y);
      return;
    }
    const dx = x - g.x;
    const dy = y - g.y;
    if (!g.turn) {
      if (Math.hypot(dx, dy) < 8) return;
      const b = this.basis();
      const scale = this.scale();
      const screen = (v: Vec): [number, number] => [(v[0] * b.right[0] + v[1] * b.right[1] + v[2] * b.right[2]) * scale, -(v[0] * b.up[0] + v[1] * b.up[1] + v[2] * b.up[2]) * scale];
      const normal = g.n.findIndex((v) => v !== 0);
      let best: { along: number; ax: number; sd: [number, number] } | null = null;
      for (let ax = 0; ax < 3; ax++) {
        if (ax === normal) continue;
        const e: Vec = [0, 0, 0];
        e[ax] = 1;
        const sd = screen(e);
        const len = Math.hypot(...sd);
        if (len < 1e-6) continue;
        const along = (dx * sd[0] + dy * sd[1]) / len;
        if (!best || Math.abs(along) > Math.abs(best.along)) best = { along, ax, sd };
      }
      if (!best) return;
      const axis = (3 - normal - best.ax) as 0 | 1 | 2;
      // the sticker's centre on the surface, and which way it moves for a positive turn about `axis`
      const p: Vec = [g.c[0] + g.n[0], g.c[1] + g.n[1], g.c[2] + g.n[2]];
      const e: Vec = [0, 0, 0];
      e[axis] = 1;
      const vel: Vec = [e[1] * p[2] - e[2] * p[1], e[2] * p[0] - e[0] * p[2], e[0] * p[1] - e[1] * p[0]];
      // `vel` is the sticker's velocity for one radian per unit time, so its screen length is pixels per radian
      const sv = screen(vel);
      const len = Math.hypot(...sv) || 1;
      g.turn = { axis, layer: g.c[axis], dir: [sv[0] / len, sv[1] / len], pxPerRad: len };
      this.twist = { axis, layers: [g.c[axis]], angle: 0 };
    }
    const t = g.turn!;
    this.twist!.angle = (dx * t.dir[0] + dy * t.dir[1]) / t.pxPerRad;
    this.draw();
  }

  /**
   * A face's centre (the middle sticker, or the middle four of an even cube) seen from in front
   * enough that a circle round it reads clearly. A 2×2 has no centres: every sticker turns a layer.
   */
  private spinsFrom(c: Vec, n: Vec): boolean {
    if (!this.centreSpin || this.size < 3) return false;
    const ax = n.findIndex((v) => v !== 0);
    const b = this.basis();
    return [0, 1, 2].every((i) => i === ax || Math.abs(c[i]!) <= 1) && n[0] * b.view[0] + n[1] * b.view[1] + n[2] * b.view[2] > 0.3;
  }

  /** Where a point of the cube is drawn, in canvas pixels. */
  private toScreen(p: Vec): [number, number] {
    const b = this.basis();
    const s = this.scale();
    return [this.w / 2 + (p[0] * b.right[0] + p[1] * b.right[1] + p[2] * b.right[2]) * s, this.h / 2 - (p[0] * b.up[0] + p[1] * b.up[1] + p[2] * b.up[2]) * s];
  }

  /**
   * Turn the face the finger circles. The finger is read back onto the face's own plane, so the
   * angle is the face's, however slanted it is drawn, and the sticker under the finger stays there.
   */
  private spinByHand(x: number, y: number) {
    const g = this.grab!;
    const sp = g.spin!;
    if (!g.turn && Math.hypot(x - g.x, y - g.y) < 8) return;
    const ax = g.n.findIndex((v) => v !== 0) as 0 | 1 | 2;
    const a = (ax + 1) % 3, b = (ax + 2) % 3;
    const mid: Vec = [0, 0, 0];
    mid[ax] = g.n[ax]! * this.size;
    const along = (i: number): Vec => {
      const p: Vec = [...mid] as Vec;
      p[i] += 1;
      return p;
    };
    const o = this.toScreen(mid);
    const pa = this.toScreen(along(a)), pb = this.toScreen(along(b));
    const sa = [pa[0] - o[0], pa[1] - o[1]], sb = [pb[0] - o[0], pb[1] - o[1]];
    const det = sa[0]! * sb[1]! - sa[1]! * sb[0]!;
    const r = this.canvas.getBoundingClientRect();
    const dx = x - r.left - o[0], dy = y - r.top - o[1];
    // too close to the middle the angle jumps about: wait for the finger to come out
    if (Math.abs(det) < 1e-6 || Math.hypot(dx, dy) < 6) return;
    // a and b then the face's normal make a right-handed set, so this angle grows with a positive turn
    const angle = Math.atan2((sa[0]! * dy - sa[1]! * dx) / det, (dx * sb[1]! - dy * sb[0]!) / det);
    if (!g.turn) {
      g.turn = { axis: ax, layer: g.c[ax]!, dir: [0, 0], pxPerRad: 1 };
      this.twist = { axis: ax, layers: [g.c[ax]!], angle: 0, spin: true };
      sp.last = angle;
    }
    let d = angle - sp.last!;
    if (d > Math.PI) d -= 2 * Math.PI;
    if (d < -Math.PI) d += 2 * Math.PI;
    sp.last = angle;
    this.twist!.angle += d;
    this.draw();
  }

  /** Let go: settle on the nearest quarter turn (or back to where it was) and report it. */
  private settleTwist(back = false) {
    const tw = this.twist;
    if (!tw) return;
    const quarter = Math.PI / 2;
    const near = Math.round(tw.angle / quarter);
    // a face spun round can go past a half turn: settle where it is, report it as the shortest turn
    const q = back ? 0 : tw.spin ? near : Math.max(-2, Math.min(2, near));
    const turns = (((q % 4) + 4) % 4 === 3 ? -1 : ((q % 4) + 4) % 4) as -1 | 0 | 1 | 2;
    const from = tw.angle;
    const to = q * quarter;
    const start = performance.now();
    const ms = 90 + 120 * Math.min(1, Math.abs(to - from) / quarter);
    const finish = () => {
      cancelAnimationFrame(this.raf);
      this.settling = null;
      this.twist = null;
      if (turns !== 0) {
        this.setState(this.size, applyMove(this.stickers, { axis: tw.axis, layers: tw.layers, angle: turns * quarter } as Move));
        this.onTwist?.(tw.axis, tw.layers[0]!, tw.spin ? turns : q);
      } else this.draw();
    };
    const tick = (now: number) => {
      const f = Math.min(1, (now - start) / ms);
      tw.angle = from + (to - from) * (1 - (1 - f) * (1 - f));
      this.draw(now);
      if (f < 1) {
        this.raf = requestAnimationFrame(tick);
        return;
      }
      finish();
    };
    this.settling = finish;
    this.raf = requestAnimationFrame(tick);
  }

  getState(): Sticker[] {
    return this.stickers;
  }

  get animating() {
    return this.anim !== null || this.twist !== null;
  }

  /** The usual camera: from the front right, or from the front left to see the left face. */
  resetView(side: "right" | "left" = "right") {
    this.yaw = side === "left" ? -DEFAULT_VIEW.yaw : DEFAULT_VIEW.yaw;
    this.pitch = DEFAULT_VIEW.pitch;
    if (this.free) this.free = { right: [1, 0, 0], up: [0, 1, 0], view: [0, 0, 1] };
    if (!this.anim) this.draw();
  }

  /** The speed mode's camera with no angle limits (see `free`); off goes back to the usual one. */
  setFreeView(on: boolean) {
    this.free = on ? { right: [1, 0, 0], up: [0, 1, 0], view: [0, 0, 1] } : null;
    this.resetView();
  }

  /** A finger came down on the free camera's pad: drags now turn about the screen's axes as they are. */
  beginViewDrag() {
    if (!this.free) return;
    this.free = squared(this.basis());
    this.yaw = this.pitch = 0;
  }

  /**
   * Turn the cube with a drag of (dx, dy) pixels so it follows the finger. The usual camera keeps
   * its pitch limits; the free one has none, and with the cube upside down a drag across turns it
   * the other way round, so it still follows the finger.
   */
  turnView(dx: number, dy: number) {
    const k = 0.009;
    if (!this.free) {
      // yaw moves the camera, so the cube turns the other way: subtract to make it follow the finger
      this.yaw -= dx * k;
      this.pitch = Math.max(-1.2, Math.min(1.4, this.pitch + dy * k));
      if (!this.anim) this.draw();
      return;
    }
    this.yaw -= dx * k * (Math.cos(this.pitch) < 0 ? -1 : 1);
    this.pitch += dy * k;
    this.queueDraw();
  }

  /** Twist the free camera's picture clockwise on the screen (radians), as two fingers do. */
  rollView(angle: number) {
    if (!this.free) return;
    const b = this.basis();
    this.free = squared({ right: turnAbout(b.right, b.view, angle), up: turnAbout(b.up, b.view, angle), view: b.view });
    this.yaw = this.pitch = 0;
    this.queueDraw();
  }

  /** One draw per frame however many fingers move. */
  private queueDraw() {
    if (this.anim || this.drawQueued) return;
    this.drawQueued = requestAnimationFrame(() => {
      this.drawQueued = 0;
      if (!this.anim) this.draw();
    });
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
  /** Drop a turn part way, without applying it (its promise still settles). */
  cancelAnimation() {
    if (!this.anim) return;
    cancelAnimationFrame(this.raf);
    const done = this.anim.resolve;
    this.anim = null;
    this.draw();
    done();
  }

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
    const right: Vec = [cy, 0, -sy], up: Vec = [-sy * sp, cp, -cy * sp], view: Vec = [sy * cp, sp, cy * cp];
    const f = this.free;
    if (!f) return { right, up, view };
    // the same camera, taking the free camera's base as the axes
    const at = (v: Vec): Vec => [0, 1, 2].map((i) => v[0] * f.right[i]! + v[1] * f.up[i]! + v[2] * f.view[i]!) as Vec;
    return { right: at(right), up: at(up), view: at(view) };
  }

  draw(now = performance.now()) {
    const { ctx, w, h, size } = this;
    if (!w || !h || !this.stickers.length) return;
    ctx.clearRect(0, 0, w, h);
    const b = this.basis();
    const dot = (a: Vec, c: Vec) => a[0] * c[0] + a[1] * c[1] + a[2] * c[2];
    const scale = this.scale();
    const project = (p: Vec): [number, number] => [w / 2 + dot(p, b.right) * scale, h / 2 - dot(p, b.up) * scale];
    const vals = layerValues(size);
    const anim = this.anim;
    // the layer turning now: an animated move, or one being turned by hand
    const turn = anim ? { axis: anim.move.axis, layers: anim.move.layers, angle: anim.move.angle * anim.dir * anim.f } : this.twist;
    const rot = (p: Vec, active: boolean): Vec => (active && turn ? rotateVec(p, turn.axis, turn.angle) : p);

    // the pieces (by where they are now) that carry a mark, for the marked-only view
    const litPieces = this.markedOnly ? new Set([...this.marks].map((i) => this.stickers[i]!.p.join(","))) : null;
    type FaceDraw = { poly: [number, number][]; st: [number, number][]; col: string | undefined; active: boolean; depth: number; light: number; key: string; marked: boolean };
    const GREY = "#9aa6b5";
    const faces: FaceDraw[] = [];
    for (const x of vals) for (const y of vals) for (const z of vals) {
      // only cubies on the surface have stickers; skip the hidden interior
      if (Math.abs(x) !== size - 1 && Math.abs(y) !== size - 1 && Math.abs(z) !== size - 1) continue;
      const c: Vec = [x, y, z];
      const shown = turn ?? this.preview;
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
        const muted = (litPieces !== null && !litPieces.has(c.join(","))) || (focus !== null && ("keys" in focus ? !focus.keys.has(key) : pieceMuted));
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
    if (this.guides && !anim && !this.twist) this.drawGuides(faces, project, b.view);
    if (this.axes) this.drawAxes(b, project);
    if (anim && this.showArrows) this.drawArrow(anim.move, anim.dir, project, b.view, now);
    else if (this.preview && this.showArrows) this.drawArrow(this.preview, 1, project, b.view, now);
  }

  private drawAxes(b: { right: Vec; up: Vec; view: Vec }, project: (p: Vec) => [number, number]) {
    const { ctx, w, h, size } = this;
    const labels = this.axes!;
    const dot = (a: Vec, c: Vec) => a[0] * c[0] + a[1] * c[1] + a[2] * c[2];
    const arms = FACE_ORDER.map((f) => ({ n: FACE_AXES[f].n, text: labels[f] }));
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.font = '700 13px system-ui, "Noto Sans TC", sans-serif';
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    // the arm pointing furthest away first, so the nearer ones draw over it
    for (const { n, text } of arms.sort((a, c) => dot(a.n, b.view) - dot(c.n, b.view))) {
      // a face turned away has its arm behind the cube: leave it out
      const facing = dot(n, b.view);
      if (facing <= 0.05) continue;
      // out of the face's centre, far enough that the tip clears the cube however steeply the face
      // is seen, but short enough that the name past the tip still fits in the canvas
      const pw = ctx.measureText(text).width + 14;
      const base = project(n.map((v) => v * size) as Vec);
      const fits = (x: number, y: number) => x - pw / 2 >= 2 && x + pw / 2 <= w - 2 && y - 11 >= 2 && y + 11 <= h - 2;
      // the name goes past the tip, or else just below or above it
      const at = (reach: number) => {
        const tip = project(n.map((v) => v * size * reach) as Vec);
        const along = Math.hypot(tip[0] - base[0], tip[1] - base[1]) || 1;
        const ux = (tip[0] - base[0]) / along, uy = (tip[1] - base[1]) / along;
        const gap = Math.abs(ux) * (pw / 2 + 5) + Math.abs(uy) * 16;
        const spots: [number, number][] = [[tip[0] + ux * gap, tip[1] + uy * gap], [tip[0], tip[1] + 22], [tip[0], tip[1] - 22]];
        const [lx, ly] = spots.find(([x, y]) => fits(x, y)) ?? spots[0]!;
        return { tip, ux, uy, lx, ly };
      };
      let reach = Math.min(3.2, 1 + 1.2 / Math.sqrt(Math.max(0.05, 1 - facing * facing)));
      let a = at(reach);
      while (reach > 1.4 && !fits(a.lx, a.ly)) a = at((reach -= 0.05));
      const { tip, ux, uy } = a;
      const neck: [number, number] = [tip[0] - ux * 13, tip[1] - uy * 13];
      // a white edge under the dark shaft, so it reads over any sticker
      for (const [colour, width] of [["#fff", 8], ["#233b55", 4]] as const) {
        ctx.strokeStyle = colour;
        ctx.lineWidth = width;
        ctx.beginPath();
        ctx.moveTo(base[0], base[1]);
        ctx.lineTo(neck[0], neck[1]);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.moveTo(tip[0], tip[1]);
      ctx.lineTo(neck[0] - uy * 8, neck[1] + ux * 8);
      ctx.lineTo(neck[0] + uy * 8, neck[1] - ux * 8);
      ctx.closePath();
      ctx.fillStyle = "#233b55";
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2;
      ctx.fill();
      ctx.stroke();
      // where it comes out of the face
      ctx.beginPath();
      ctx.arc(base[0], base[1], 5.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      // the name just past the tip, on a white pill (held inside the canvas should the arm be short)
      const lx = Math.max(pw / 2 + 2, Math.min(w - pw / 2 - 2, a.lx));
      const ly = Math.max(13, Math.min(h - 13, a.ly));
      ctx.fillStyle = "#fff";
      ctx.strokeStyle = "#cdd7e5";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(lx - pw / 2, ly - 11, pw, 22, 11);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#233b55";
      ctx.fillText(text, lx, ly + 0.5);
    }
    ctx.restore();
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
  /** Rings round the guide stickers in view, then each arrow from the face of its piece that faces you most. */
  private drawGuides(faces: { st: [number, number][]; key: string }[], project: (p: Vec) => [number, number], view: Vec) {
    const { ctx, size } = this;
    const g = this.guides!;
    const INK = "#e8318a";
    ctx.save();
    for (const f of faces) {
      if (!g.rings.has(f.key)) continue;
      const cx = f.st.reduce((a, p) => a + p[0], 0) / 4;
      const cy = f.st.reduce((a, p) => a + p[1], 0) / 4;
      const r = Math.max(8, Math.hypot(f.st[2]![0] - f.st[0]![0], f.st[2]![1] - f.st[0]![1]) * 0.42);
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.lineWidth = 6;
      ctx.strokeStyle = "rgba(255,255,255,.9)";
      ctx.stroke();
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = INK;
      ctx.stroke();
    }
    const h = size - 1;
    const anchor = (p: Vec): [number, number] => {
      let best: Vec = [0, 1, 0];
      let most = -Infinity;
      for (let ax = 0; ax < 3; ax++) {
        if (Math.abs(p[ax]!) !== h) continue;
        const n: Vec = [0, 0, 0];
        n[ax] = Math.sign(p[ax]!);
        const d = n[0] * view[0] + n[1] * view[1] + n[2] * view[2];
        if (d > most) [most, best] = [d, n];
      }
      return project([p[0] + best[0] * 1.05, p[1] + best[1] * 1.05, p[2] + best[2] * 1.05]);
    };
    const mid = project([0, 0, 0]);
    for (const [from, to] of g.arrows) {
      const a = anchor(from);
      const z = anchor(to);
      // bow the path away from the middle of the cube, so it reads as moving round it
      const m: [number, number] = [(a[0] + z[0]) / 2, (a[1] + z[1]) / 2];
      const len = Math.hypot(z[0] - a[0], z[1] - a[1]);
      let ox = m[0] - mid[0];
      let oy = m[1] - mid[1];
      const ol = Math.hypot(ox, oy) || 1;
      [ox, oy] = [(ox / ol) * len * 0.35, (oy / ol) * len * 0.35];
      const c: [number, number] = [m[0] + ox, m[1] + oy];
      // stop short of the target so the head sits on it
      const t = 0.92;
      const end: [number, number] = [(1 - t) ** 2 * a[0] + 2 * (1 - t) * t * c[0] + t * t * z[0], (1 - t) ** 2 * a[1] + 2 * (1 - t) * t * c[1] + t * t * z[1]];
      for (const [width, colour] of [[8, "rgba(255,255,255,.9)"], [4.5, INK]] as const) {
        ctx.beginPath();
        ctx.moveTo(...a);
        ctx.quadraticCurveTo(c[0], c[1], end[0], end[1]);
        ctx.lineWidth = width;
        ctx.lineCap = "round";
        ctx.strokeStyle = colour;
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(a[0], a[1], 5, 0, Math.PI * 2);
      ctx.fillStyle = INK;
      ctx.fill();
      const ang = Math.atan2(end[1] - c[1], end[0] - c[0]);
      ctx.beginPath();
      ctx.moveTo(end[0] + Math.cos(ang) * 12, end[1] + Math.sin(ang) * 12);
      ctx.lineTo(end[0] + Math.cos(ang + 2.4) * 13, end[1] + Math.sin(ang + 2.4) * 13);
      ctx.lineTo(end[0] + Math.cos(ang - 2.4) * 13, end[1] + Math.sin(ang - 2.4) * 13);
      ctx.closePath();
      ctx.fillStyle = INK;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = "rgba(255,255,255,.9)";
      ctx.stroke();
    }
    ctx.restore();
  }

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
