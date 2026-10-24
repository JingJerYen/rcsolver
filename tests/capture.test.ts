import { test } from "node:test";
import assert from "node:assert/strict";
import { STEPS, turnsBefore } from "../web/src/capture.js";
import { FACE_AXES, apply, orient } from "../web/src/guideCube.js";
import type { Face } from "../web/src/api.js";

type Vec = [number, number, number];
const same = (a: Vec, b: Vec) => a.every((v, i) => Math.abs(v - b[i]!) < 1e-9);

test("capture: every photo, turned by its quarter, is stored the way the net lays it out", () => {
  STEPS.forEach((step, i) => {
    const m = orient([...turnsBefore(i), ...step.turns]);
    const at = (screen: Vec): Face => (Object.keys(FACE_AXES) as Face[]).find((f) => same(apply(m, FACE_AXES[f].n), screen))!;
    assert.equal(at([0, 0, 1]), step.face, `step ${i + 1} faces the camera`);
    // after a quarter turn clockwise the photo's left edge is its top; anticlockwise, its right edge
    const top = at(step.quarter === 1 ? [-1, 0, 0] : step.quarter === -1 ? [1, 0, 0] : [0, 1, 0]);
    const down = FACE_AXES[step.face].down;
    assert.ok(same(FACE_AXES[top].n, [-down[0], -down[1], -down[2]]), `step ${i + 1} (${step.face}) has ${top} at its top`);
  });
});

test("capture: after the fourth side the cube tilts straight up, one gesture", () => {
  assert.equal(STEPS[4]!.turns.length, 1);
});
