import { test } from "node:test";
import assert from "node:assert/strict";
import { applyAlgorithm, fromNet, parseAlgorithm, type Sticker } from "../web/src/cubeState.js";
import { parsePyraMove, pyraPiece, pyraSolved } from "../web/src/pyraminx.js";
import { BUILT_IN } from "../web/src/builtInMacros.js";

const COLORS: Record<string, string> = { U: "W", R: "R", F: "G", D: "Y", L: "O", B: "B" };
const solved = fromNet(3, Object.fromEntries(Object.entries(COLORS).map(([f, c]) => [f, [c.repeat(3), c.repeat(3), c.repeat(3)]])) as never);
const key = (s: Sticker) => `${s.p.join()}|${s.n.join()}`;
const group = (i: number) => BUILT_IN[i]![1];

/** After `alg` on a solved 3×3: is everything below the top layer as it was, and is the top face one colour? */
function topOnly(alg: string) {
  const st = applyAlgorithm(solved, parseAlgorithm(alg, 3));
  const at = new Map(st.map((s) => [key(s), s.c]));
  const below = solved.every((s) => s.p[1] === 2 || at.get(key(s)) === s.c);
  const top = st.filter((s) => s.n[1] === 1).map((s) => s.c);
  return { below, topWhite: top.every((c) => c === "W") };
}

test("OLL sequences touch only the top layer and leave its face mixed (they orient it)", () => {
  for (const [name, seq] of group(1)) {
    const r = topOnly(seq);
    assert.ok(r.below, name);
    assert.ok(!r.topWhite, name);
  }
});

test("PLL sequences touch only the top layer and keep its face one colour (they permute it)", () => {
  for (const [name, seq] of group(2)) {
    const r = topOnly(seq);
    assert.ok(r.below && r.topWhite, name);
  }
  assert.equal(group(2).length, 15);
});

test("the beginner's last-layer sequences touch only the top layer; the rest are the lessons' own", () => {
  for (const [name, seq] of group(0).slice(4)) assert.ok(topOnly(seq).below, name);
  for (const [, seq] of group(0)) assert.doesNotThrow(() => parseAlgorithm(seq, 3));
});

test("the Pyraminx sequences cycle three edges and nothing else", () => {
  for (const [name, seq] of group(3)) {
    const before = pyraSolved();
    const after = applyAlgorithm(before, seq.split(" ").map((t) => parsePyraMove(t)!));
    const at = new Map(after.map((s) => [key(s), s.c]));
    const moved = new Set(before.filter((s) => at.get(key(s)) !== s.c).map((s) => pyraPiece(s.p)));
    assert.equal(moved.size, 3, name);
    assert.ok([...moved].every((p) => p[0] === "e"), name);
  }
});
