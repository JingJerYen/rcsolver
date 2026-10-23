import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeShare, encodeShare } from "../web/src/share.js";
import { applyAlgorithm, fromNet, parseAlgorithm, toNet } from "../web/src/cubeState.js";
import type { Face } from "../web/src/api.js";

const COLORS: Record<Face, string> = { U: "W", R: "R", F: "G", D: "Y", L: "O", B: "B" };
const solvedNet = (size: number) => Object.fromEntries((Object.keys(COLORS) as Face[]).map((f) => [f, Array.from({ length: size }, () => COLORS[f].repeat(size))])) as Record<Face, string[]>;

test("share tokens round-trip cube, index and moves, and are short", () => {
  for (const [size, alg] of [[2, "R U' F2"], [3, "R U R' U' F2 D"], [4, "R 2U F' Rw2 D 3Rw 2L'"], [5, "R 2U 3U' Rw2 3Rw 3Lw' 2F2"]] as [number, string][]) {
    const faces = toNet(size, applyAlgorithm(fromNet(size, solvedNet(size)), parseAlgorithm(alg, size)));
    const moves = alg.split(" ");
    const tok = encodeShare({ size, faces, index: 300, moves });
    const back = decodeShare(tok);
    assert.deepEqual(back, { size, faces, index: 300, moves });
    const tok2 = encodeShare({ size, faces, index: 7 });
    assert.deepEqual(decodeShare(tok2), { size, faces, index: 7 });
    assert.ok(tok2.length <= (size === 3 ? 34 : size === 4 ? 54 : 82), `${size}×${size} token is ${tok2.length} chars`);
  }
});

test("garbage tokens are rejected", () => {
  assert.equal(decodeShare("not base64 !!"), null);
  assert.equal(decodeShare("AQM"), null);
  assert.equal(decodeShare(encodeShare({ size: 3, faces: solvedNet(3), index: 0 }).slice(0, -3)), null);
});
