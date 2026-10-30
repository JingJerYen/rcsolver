import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_WHEEL_CONFIG,
  FACE_BASIS,
  WHEEL_FACES,
  applyWheelMoves,
  buildWheelPuzzle,
  colourOf,
  cornerPieces,
  exportWheel,
  importWheel,
  isWheelSolved,
  moveGeometry,
  parseWheelMoves,
  rotate,
  scrambleWheel,
  sequenceDest,
  solvedWheel,
  wheelCycles,
  type Vec3,
  type WheelFace,
  type WheelState,
} from "../web/src/wheel.js";

const pz = buildWheelPuzzle();
const solved = solvedWheel(pz);
const run = (text: string, from: WheelState = solved) => {
  const { moves, bad } = parseWheelMoves(pz, text);
  assert.deepEqual(bad, [], `unknown tokens in ${text}`);
  return applyWheelMoves(from, moves);
};
const LAYERS = ["U", "D", "R", "L", "F", "B"];
const WHEELS = ["u", "d", "r", "l", "f", "b"];
let seed = 12345;
const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;

test("the model has 24 corner stickers and 24 wedges, and every move", () => {
  assert.equal(pz.slots.filter((s) => s.kind === "corner").length, 24);
  assert.equal(pz.slots.filter((s) => s.kind === "wedge").length, 24);
  assert.equal(pz.moves.size, 15 * 3);
  assert.equal(pz.locked.size, 0);
});

test("any layer, wheel or rotation four times over is no change, and a move then its inverse too", () => {
  for (const l of [...LAYERS, ...WHEELS, "x", "y", "z"]) {
    assert.deepEqual(run(`${l} ${l} ${l} ${l}`), solved, `${l}×4`);
    assert.deepEqual(run(`${l} ${l}'`), solved, `${l} ${l}'`);
    assert.deepEqual(run(`${l}2 ${l}2`), solved, `${l}2 ${l}2`);
    assert.deepEqual(run(`${l} ${l}`), run(`${l}2`), `${l} ${l} = ${l}2`);
  }
});

test("every colour stays on exactly four wedges and four corner stickers", () => {
  let state = solved;
  for (let i = 0; i < 300; i++) {
    state = run(scrambleWheel(pz, 1, {}, rand).join(" "), state);
    for (const kind of ["corner", "wedge"] as const) {
      const count = new Map<WheelFace, number>();
      state.forEach((sticker, slot) => {
        if (pz.slots[slot]!.kind === kind) count.set(colourOf(pz, sticker), (count.get(colourOf(pz, sticker)) ?? 0) + 1);
      });
      for (const f of WHEEL_FACES) assert.equal(count.get(f), 4, `${kind} ${f}`);
    }
  }
});

test("a layer turn hands each neighbouring face half a wheel from the face before it", () => {
  // R carries F's right half up to U, U's to B, B's to D, D's to F
  const after = run("R");
  const wedgesOn = (face: WheelFace) => after.filter((_, slot) => pz.slots[slot]!.kind === "wedge" && pz.slots[slot]!.face === face).map((s) => colourOf(pz, s));
  const tally = (cs: WheelFace[]) => cs.reduce((m, c) => m.set(c, (m.get(c) ?? 0) + 1), new Map<WheelFace, number>());
  assert.equal(tally(wedgesOn("U")).get("F"), 2);
  assert.equal(tally(wedgesOn("B")).get("U"), 2);
  assert.equal(tally(wedgesOn("D")).get("B"), 2);
  assert.equal(tally(wedgesOn("F")).get("D"), 2);
  // and every layer move moves 2 wedges onto each of its four neighbours, all from the face before
  for (const l of LAYERS) {
    const next = run(l);
    const n = FACE_BASIS[l as WheelFace].n;
    for (const f of WHEEL_FACES) {
      if (Math.abs(FACE_BASIS[f].n[0] * n[0] + FACE_BASIS[f].n[1] * n[1] + FACE_BASIS[f].n[2] * n[2]) > 0) continue;
      const moved = next.filter((s, slot) => pz.slots[slot]!.kind === "wedge" && pz.slots[slot]!.face === f && colourOf(pz, s) !== f);
      assert.equal(moved.length, 2, `${l} onto ${f}`);
      assert.equal(new Set(moved.map((s) => colourOf(pz, s))).size, 1, `${l} onto ${f}: one face`);
    }
  }
});

test("with layer turns only, every wedge matches the corner sticker in its quadrant", () => {
  for (let trial = 0; trial < 50; trial++) {
    const seq = Array.from({ length: 25 }, () => LAYERS[Math.floor(rand() * 6)]! + ["", "'", "2"][Math.floor(rand() * 3)]);
    const state = run(seq.join(" "));
    pz.slots.forEach((s, slot) => {
      if (s.kind !== "wedge") return;
      const corner = pz.slots.findIndex((t) => t.kind === "corner" && t.face === s.face && t.index === s.index);
      assert.equal(colourOf(pz, state[slot]!), colourOf(pz, state[corner]!), `${seq.join(" ")}: ${s.face} wedge ${s.index}`);
    });
  }
});

test("the tables agree with turning the points themselves", () => {
  // each sticker carried as a point in space, turned directly by the move's geometry
  for (let trial = 0; trial < 20; trial++) {
    const seq = scrambleWheel(pz, 30, {}, rand);
    let points: Vec3[] = pz.slots.map((s) => s.p);
    for (const t of seq) {
      const g = moveGeometry(DEFAULT_WHEEL_CONFIG, t)!;
      points = points.map((p) => (g.carries(p) ? rotate(p, g.axis, g.angle) : p));
    }
    const fromTables = run(seq.join(" "));
    points.forEach((p, sticker) => assert.equal(fromTables[pz.slotAt(p)], sticker, seq.join(" ")));
  }
});

test("solved means every face one colour, wedges and corners alike, however the cube is held", () => {
  assert.ok(isWheelSolved(pz, solved));
  assert.ok(isWheelSolved(pz, run("x y2 z'")));
  // a wheel spun among wedges of one colour changes nothing you can see
  assert.ok(isWheelSolved(pz, run("u r2 f'")));
  assert.ok(!isWheelSolved(pz, run("R")));
  assert.ok(!isWheelSolved(pz, run("R u R'")));
  assert.ok(isWheelSolved(pz, run("R u R' R u' R'")));
});

test("a wheel turn moves only its own wedges, round in one cycle; corners never twist out of step", () => {
  const cycles = wheelCycles(pz, sequenceDest(pz, parseWheelMoves(pz, "u").moves));
  assert.equal(cycles.corners.length, 0);
  assert.deepEqual(cycles.wedges.map((c) => c.length), [4]);
  // R u R' u': the corners stay put; wedges move in short cycles
  const comm = wheelCycles(pz, sequenceDest(pz, parseWheelMoves(pz, "R u R' u'").moves));
  assert.equal(comm.corners.length, 0);
  assert.ok(comm.wedges.length > 0);
  // the twists of the eight corners always add up to a multiple of three
  let state = solved;
  for (let i = 0; i < 200; i++) {
    state = run(scrambleWheel(pz, 1, {}, rand).join(" "), state);
    const { at, twist } = cornerPieces(pz, state);
    assert.equal(new Set(at.values()).size, 8);
    assert.equal([...twist.values()].reduce((a, b) => a + b, 0) % 3, 0);
  }
});

test("a scramble of wheels only leaves the corners solved", () => {
  const state = run(scrambleWheel(pz, 40, { wheelsOnly: true }, rand).join(" "));
  pz.slots.forEach((s, slot) => {
    if (s.kind === "corner") assert.equal(state[slot], slot);
  });
});

test("a state goes out as JSON and comes back the same; anything else is refused", () => {
  const state = run(scrambleWheel(pz, 20, {}, rand).join(" "));
  assert.deepEqual(importWheel(pz, exportWheel(pz, state)), state);
  assert.equal(importWheel(pz, "{}"), null);
  assert.equal(importWheel(pz, JSON.stringify({ puzzle: "wheel2", wedges: 4, state: solved.slice(1) })), null);
});

test("eight wedges a wheel, and wheels turning only with the layers, are settings", () => {
  const eight = buildWheelPuzzle({ ...DEFAULT_WHEEL_CONFIG, wedges: 8 });
  assert.equal(eight.slots.filter((s) => s.kind === "wedge").length, 48);
  const st = applyWheelMoves(solvedWheel(eight), parseWheelMoves(eight, "u u u u u u u u R R R R").moves);
  assert.deepEqual(st, solvedWheel(eight));
  const fixed = buildWheelPuzzle({ ...DEFAULT_WHEEL_CONFIG, wheelsTurn: false });
  assert.equal(fixed.moves.has("u"), false);
  // wedges half a wedge round: a layer turn would cut through them, so the layers lock
  const offset = buildWheelPuzzle({ ...DEFAULT_WHEEL_CONFIG, aligned: false });
  assert.ok(offset.locked.has("R"));
  assert.ok(offset.moves.has("r"));
});
