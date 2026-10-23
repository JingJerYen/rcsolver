import { test } from "node:test";
import assert from "node:assert/strict";
import { fromFacelets, toFacelets } from "../web/src/facelets.js";
import { applyAlgorithm, fromNet, parseAlgorithm, toNet } from "../web/src/cubeState.js";
import type { Face } from "../web/src/api.js";

const COLORS: Record<Face, string> = { U: "W", R: "R", F: "G", D: "Y", L: "O", B: "B" };
const solvedNet = (size: number) => Object.fromEntries((Object.keys(COLORS) as Face[]).map((f) => [f, Array.from({ length: size }, () => COLORS[f].repeat(size))])) as Record<Face, string[]>;

test("facelet strings round-trip for 2×2, 3×3 and 4×4", () => {
  for (const [size, alg] of [[2, "R U' F2 U"], [3, "R U R' U' F2 D"], [4, "R 2U F' Rw2 D"]] as [number, string][]) {
    const net = toNet(size, applyAlgorithm(fromNet(size, solvedNet(size)), parseAlgorithm(alg, size)));
    const str = toFacelets(net, size);
    assert.ok(str && str.length === 6 * size * size && /^[URFDLB]+$/.test(str));
    const back = fromFacelets(str!);
    assert.ok(back && back.size === size);
    // Even cubes have no fixed centres, so the letters name faces relative to the DBL corner:
    // the imported colours can differ from the originals but describe the same state.
    assert.equal(toFacelets(back!.net, size), str);
    if (size % 2 === 1) assert.deepEqual(back!.net, net);
  }
  assert.equal(toFacelets(solvedNet(3), 3), "UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB");
});

test("import accepts colour letters and rejects junk", () => {
  const net = solvedNet(2);
  const colours = "WWWWRRRRGGGGYYYYOOOOBBBB";
  assert.deepEqual(fromFacelets(colours)?.net, net);
  assert.deepEqual(fromFacelets("www wrrr rggg gyyy yooo obbb b")?.size, 2);
  assert.equal(fromFacelets("UUUUUUUU"), null);
  assert.equal(fromFacelets("UUUUXUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB"), null);
});
