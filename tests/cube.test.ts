import { test } from "node:test";
import assert from "node:assert/strict";
import min2phase from "min2phase.js";
import { applyAlgorithm, fromNet, isSolved, parseAlgorithm, parseMove, toNet, unrotate as unrotateFn, type Sticker } from "../web/src/cubeState.js";
import { checkFacelets, netToFacelets } from "../web/src/cube3.js";
import type { Face } from "../web/src/api.js";

const SOLVED_COLORS: Record<Face, string> = { U: "W", R: "R", F: "G", D: "Y", L: "O", B: "B" };

function solvedNet(size: number): Record<Face, string[]> {
  return Object.fromEntries(
    (Object.keys(SOLVED_COLORS) as Face[]).map((f) => [f, Array.from({ length: size }, () => SOLVED_COLORS[f].repeat(size))]),
  ) as Record<Face, string[]>;
}

/** Facelet string (face letters) → net of colour letters using the solved colour scheme. */
function faceletsToNet(facelets: string): Record<Face, string[]> {
  const order: Face[] = ["U", "R", "F", "D", "L", "B"];
  const net = {} as Record<Face, string[]>;
  order.forEach((f, i) => {
    net[f] = [];
    for (let r = 0; r < 3; r++) net[f].push(facelets.slice(i * 9 + r * 3, i * 9 + r * 3 + 3).split("").map((x) => SOLVED_COLORS[x as Face]).join(""));
  });
  return net;
}

test("a solved net round-trips through the sticker model for every size", () => {
  for (const size of [2, 3, 4, 5, 6, 7]) {
    const s = fromNet(size, solvedNet(size));
    assert.equal(s.length, 6 * size * size);
    assert.ok(isSolved(s));
    assert.deepEqual(toNet(size, s), solvedNet(size));
  }
});

test("sexy move six times is the identity; R once is not", () => {
  const s = fromNet(3, solvedNet(3));
  const sexy = parseAlgorithm("R U R' U'", 3);
  let t: Sticker[] = s;
  for (let i = 0; i < 6; i++) t = applyAlgorithm(t, sexy);
  assert.ok(isSolved(t));
  assert.ok(!isSolved(applyAlgorithm(s, parseAlgorithm("R", 3))));
  assert.ok(isSolved(applyAlgorithm(s, parseAlgorithm("R R'", 3))));
  assert.ok(isSolved(applyAlgorithm(s, parseAlgorithm("F2 F2", 3))));
});

test("an R turn moves the front-right column up onto U (clockwise as seen from the right)", () => {
  const s = applyAlgorithm(fromNet(3, solvedNet(3)), parseAlgorithm("R", 3));
  const net = toNet(3, s);
  // the F face's right column came from D (yellow); U's right column came from F (green)
  assert.equal(net.F.map((r) => r[2]).join(""), "YYY");
  assert.equal(net.U.map((r) => r[2]).join(""), "GGG");
  assert.equal(net.B.map((r) => r[0]).join(""), "WWW");
  assert.equal(net.D.map((r) => r[2]).join(""), "BBB");
});

test("wide and inner-slice tokens pick the right layers", () => {
  assert.deepEqual(parseMove("R", 4).layers, [3]);
  assert.deepEqual(parseMove("Rw", 4).layers, [3, 1]);
  assert.deepEqual(parseMove("r", 4).layers, [3, 1]);
  assert.deepEqual(parseMove("3Rw", 5).layers, [4, 2, 0]);
  assert.deepEqual(parseMove("2R", 4).layers, [1]);
  assert.deepEqual(parseMove("2L'", 4).layers, [-1]);
  assert.deepEqual(parseMove("u", 4).layers, [3, 1]);
  assert.equal(parseMove("U'", 3).q, -1);
  assert.throws(() => parseMove("X", 3));
});

test("min2phase solutions solve our model for random cubes (move semantics agree)", () => {
  min2phase.initFull();
  for (let i = 0; i < 20; i++) {
    const facelets = min2phase.randomCube();
    const net = faceletsToNet(facelets);
    const conv = netToFacelets(net);
    assert.ok(conv);
    assert.equal(conv.facelets, facelets, "net → facelets reproduces the input");
    assert.ok(checkFacelets(facelets).ok);
    const solution = min2phase.solve(facelets).split(/\s+/).filter(Boolean);
    assert.ok(solution.length > 0 && solution.length <= 21);
    const end = applyAlgorithm(fromNet(3, net), parseAlgorithm(solution.join(" "), 3));
    assert.ok(isSolved(end), `solution ${solution.join(" ")} did not solve ${facelets}`);
  }
});

test("validity: impossible pieces are pointed at, twists and flips and parity are named", () => {
  const solved = "UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB";
  assert.ok(checkFacelets(solved).ok);
  // corner URF with two U stickers: facelets 8 (U9), 9 (R1), 20 (F3)
  const twoWhites = solved.slice(0, 9) + "U" + solved.slice(10);
  const v1 = checkFacelets(twoWhites);
  assert.ok(!v1.ok);
  assert.deepEqual(v1.badFacelets.slice(0, 3), [8, 9, 20]);
  // twist one corner: rotate the stickers of URF
  const twist = (s: string, a: number, b: number, c: number) => {
    const arr = s.split("");
    [arr[a], arr[b], arr[c]] = [arr[c]!, arr[a]!, arr[b]!];
    return arr.join("");
  };
  const v2 = checkFacelets(twist(solved, 8, 9, 20));
  assert.ok(!v2.ok);
  assert.deepEqual(v2.reasons, ["corner_twist"]);
  // flip one edge UR: facelets 5 and 10
  const flip = solved.split("");
  [flip[5], flip[10]] = [flip[10]!, flip[5]!];
  const v3 = checkFacelets(flip.join(""));
  assert.deepEqual(v3.reasons, ["edge_flip"]);
  // swap two edges UR and UF: facelets (5,10) <-> (7,19)
  const swap = solved.split("");
  [swap[5], swap[7]] = [swap[7]!, swap[5]!];
  [swap[10], swap[19]] = [swap[19]!, swap[10]!];
  assert.deepEqual(checkFacelets(swap.join("")).reasons, ["parity"]);
  // two centres with the same colour cannot be mapped
  const net = solvedNet(3);
  net.R = ["WWW", "WWW", "WWW"];
  assert.equal(netToFacelets(net), null);
});

test("whole-cube rotations parse, and unrotate() removes them without changing the effect", () => {
  const { unrotate } = await_import();
  for (const size of [3, 4, 5]) {
    const s = fromNet(size, solvedNet(size));
    const alg = "R U x R U2 y' 2L z F' x2 Rw D";
    const withRot = applyAlgorithm(s, parseAlgorithm(alg, size));
    const plain = unrotate(alg.split(" "), size);
    assert.ok(!plain.some((t) => /^[xyz]/.test(t)));
    // the cube ends up rotated by x y' z x2 in one case and not in the other, so compare after undoing that
    const back = applyAlgorithm(withRot, parseAlgorithm("x2 z' y x'", size));
    assert.deepEqual(toNet(size, back), toNet(size, applyAlgorithm(s, parseAlgorithm(plain.join(" "), size))));
  }
  function await_import() {
    return { unrotate: unrotateFn };
  }
});
