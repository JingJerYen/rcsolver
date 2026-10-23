/**
 * Any cube from 4×4 to 7×7 by reduction: centres (staged table descent) → every wing orbit paired
 * against a reference (the midges on odd cubes, the outermost orbit on even ones) → OLL/PLL parity
 * on even cubes → the reduced 3×3 with min2phase. Each stage is replayed on the sticker model, so
 * the result is known to solve the cube as it was read.
 */
import type { Color, Face } from "../api.js";
import { FACE_AXES, FACE_ORDER, applyAlgorithm, fromNet, isSolved, parseAlgorithm, toNet, type Sticker, type Vec } from "../cubeState.js";
import { checkFacelets, netToFacelets } from "../cube3.js";
import { solve3 } from "../solver.js";
import { centreSolverFor, solveCentresStaged } from "./centres.js";
import { stickerCell, type Cell } from "./cube4.js";
import { badCorners, schemeFromCorners, type Net } from "./scheme.js";
import { flipUF, slotKey, wingOrbits } from "./wings.js";
import { cube3Segments, type Segment } from "./segments.js";

export type SolveNResult = { ok: true; moves: string[]; stages: Record<string, number>; segments: Segment[] } | { ok: false; badCells: Cell[]; reason: string };

const faceOfNormal = (n: Vec): Face => FACE_ORDER.find((f) => FACE_AXES[f].n.every((v, i) => v === n[i]))!;
const key = (p: Vec, n: Vec) => `${p.join(",")}|${n.join(",")}`;

/** Flip of the whole UF edge (every wing orbit) on an even cube: the OLL parity fix. */
function ollParity(size: number): string[] {
  const out: string[] = [];
  for (let d = 2; d <= size / 2; d++) out.push(...flipUF(d));
  return out;
}

/** Swap of the UF and UB edges with centres intact on an even cube: the 4×4 alg with all inner layers turned together. */
function pllParity(size: number): string[] {
  const ds: number[] = [];
  for (let d = 2; d <= size / 2; d++) ds.push(d);
  const X = ds.map((d) => `${d}R2`);
  const Y = ds.map((d) => `${d}U2`);
  return [...X, "U2", ...X, "U2", ...Y, ...X, ...Y];
}

/** The reduced 3×3 net: corners, one sticker of each edge and centre block. */
export function reduceTo3(stickers: Sticker[], size: number): Net {
  const netN = toNet(size, stickers);
  const mid = size % 2 ? (size - 1) / 2 : 1;
  const map = [0, mid, size - 1];
  const net3 = {} as Net;
  for (const f of FACE_ORDER) net3[f] = map.map((r) => map.map((c) => netN[f][r]![c]!).join(""));
  return net3;
}

export function solveN(net: Net, size: number): SolveNResult {
  const h = (size - 1) / 2;
  const odd = size % 2 === 1;
  // scheme: the fixed middles on odd cubes, the corners on even ones
  let colorOfFace = {} as Record<Face, Color>;
  if (odd) {
    for (const f of FACE_ORDER) colorOfFace[f] = net[f][h]![h] as Color;
    if (new Set(Object.values(colorOfFace)).size !== 6) return { ok: false, badCells: FACE_ORDER.map((face) => ({ face, row: h, col: h })), reason: "scheme" };
  } else {
    const scheme = schemeFromCorners(net, size);
    if (!scheme) return { ok: false, badCells: [], reason: "scheme" };
    colorOfFace = scheme.colorOfFace;
  }
  let faceOfColor = new Map<Color, Face>(FACE_ORDER.map((f) => [colorOfFace[f], f]));
  const bc = badCorners(net, size, faceOfColor);
  if (bc.length) return { ok: false, badCells: bc, reason: "corner" };

  let cube = fromNet(size, net);
  const stages: Record<string, number> = {};
  const moves: string[] = [];
  const segments: Segment[] = [];
  const run = (label: string, tokens: string[], segment?: (from: number, to: number) => Segment[]) => {
    if (!tokens.length) return;
    const from = moves.length;
    cube = applyAlgorithm(cube, parseAlgorithm(tokens.join(" "), size));
    moves.push(...tokens);
    stages[label] = (stages[label] ?? 0) + tokens.length;
    if (segment) segments.push(...segment(from, moves.length));
  };

  // centres: every orbit must hold four stickers of each face
  for (const orbit of centreSolverFor(size).orbits) {
    const faces = orbit.faces(cube, faceOfColor);
    if (faces.some((f) => !f)) return { ok: false, badCells: [], reason: "centre_colour" };
    for (const f of FACE_ORDER) if (faces.filter((x) => x === f).length !== 4) return { ok: false, badCells: [], reason: "centre_count" };
  }
  {
    const centreOrbits = centreSolverFor(size).orbits.length;
    const parts: { orbit: number; stage: number; count: number }[] = [];
    const tokens = solveCentresStaged(cube, faceOfColor, size, undefined, (orbit, stage, count) => parts.push({ orbit, stage, count }));
    run("centres", tokens, (from) => {
      const out: Segment[] = [];
      let at = 0;
      for (const p of parts) {
        if (p.count > at) out.push({ kind: "centres", from: from + at, to: from + p.count, orbit: p.orbit, orbits: centreOrbits, stage: p.stage });
        at = p.count;
      }
      return out;
    });
  }
  // middle-slice turns may have turned the whole cube: read the scheme off the solved centres
  {
    const n = toNet(size, cube);
    for (const f of FACE_ORDER) colorOfFace[f] = n[f][1]![1] as Color;
    faceOfColor = new Map<Color, Face>(FACE_ORDER.map((f) => [colorOfFace[f], f]));
  }

  // wings, outermost orbit first
  const orbits = wingOrbits(size);
  const m = size - 1;
  const colorAt = () => {
    const map = new Map<string, Color>();
    for (const s of cube) map.set(key(s.p, s.n), s.c);
    return map;
  };
  const readOrbit = (oi: number) => {
    const r = orbits[oi]!.read(cube, colorOfFace);
    if (r.badPositions.length) {
      const badCells = r.badPositions.flatMap((P) => orbits[oi]!.positions[P]!.faces.map((n) => stickerCell(orbits[oi]!.positions[P]!.p, n, size)));
      return { badCells, reason: "wing" };
    }
    if (new Set(r.arr).size !== 24) return { badCells: [], reason: "wing_duplicate" };
    return r.arr;
  };
  let refColour: (slotKey: string, normal: Vec) => Color;
  let first = 0;
  if (odd) {
    // the midges are the reference; they must form a valid set of 3×3 edges
    const colours = colorAt();
    const midges = new Map<string, Map<string, Color>>();
    const seen = new Set<string>();
    for (const w of orbits[0]!.positions) {
      const sk = slotKey(w.p, m);
      if (midges.has(sk)) continue;
      const p = sk.split(",").map(Number) as Vec;
      const byNormal = new Map<string, Color>();
      for (const n of w.faces) byNormal.set(n.join(","), colours.get(key(p, n))!);
      midges.set(sk, byNormal);
      const fs = w.faces.map((n) => faceOfColor.get(colours.get(key(p, n))!));
      const cells = w.faces.map((n) => stickerCell(p, n, size));
      if (fs.some((f) => !f)) return { ok: false, badCells: cells, reason: "midge" };
      const opposite = (a: Face, b: Face) => FACE_ORDER.indexOf(a) % 3 === FACE_ORDER.indexOf(b) % 3;
      if (opposite(fs[0]!, fs[1]!)) return { ok: false, badCells: cells, reason: "midge" };
      const id = [fs[0]!, fs[1]!].sort().join("");
      if (seen.has(id)) return { ok: false, badCells: cells, reason: "midge_duplicate" };
      seen.add(id);
    }
    refColour = (sk, n) => midges.get(sk)!.get(n.join(","))!;
  } else {
    const arr = readOrbit(0);
    if (!(arr instanceof Uint8Array)) return { ok: false, ...arr };
    try {
      run("edges", orbits[0]!.pair(arr), (from, to) => [{ kind: "edges", from, to, orbit: 0, orbits: orbits.length }]);
    } catch {
      return { ok: false, badCells: [], reason: "pairing" };
    }
    const colours = colorAt();
    // both wings of a paired slot show the same colours: either one stands for the slot
    refColour = (sk, n) => colours.get(key(orbits[0]!.positions.find((x) => slotKey(x.p, m) === sk)!.p, n))!;
    first = 1;
  }
  for (let oi = first; oi < orbits.length; oi++) {
    const arr = readOrbit(oi);
    if (!(arr instanceof Uint8Array)) return { ok: false, ...arr };
    const target = orbits[oi]!.target(refColour, colorOfFace);
    if (target.includes(255)) return { ok: false, badCells: [], reason: "wing_target" };
    try {
      run("edges", orbits[oi]!.pairTo(arr, target), (from, to) => [{ kind: "edges", from, to, orbit: oi, orbits: orbits.length }]);
    } catch {
      return { ok: false, badCells: [], reason: "pairing" };
    }
    // the reference moved with the outer moves: re-read it from the cube
    const colours = colorAt();
    refColour = odd
      ? (sk, n) => colours.get(key(sk.split(",").map(Number) as Vec, n))!
      : (sk, n) => colours.get(key(orbits[0]!.positions.find((x) => slotKey(x.p, m) === sk)!.p, n))!;
  }

  // reduced 3×3 with parity fixes
  for (let attempt = 0; attempt < 3; attempt++) {
    const conv = netToFacelets(reduceTo3(cube, size));
    if (!conv) return { ok: false, badCells: [], reason: "reduce" };
    const v = checkFacelets(conv.facelets);
    if (v.ok) {
      const before = cube;
      const tokens = solve3(conv.facelets);
      run("3x3", tokens, (from) => cube3Segments(from, tokens, (k) => reduceTo3(applyAlgorithm(before, parseAlgorithm(tokens.slice(0, k).join(" "), size)), size)));
      break;
    }
    if (odd) return { ok: false, badCells: [], reason: `reduced:${v.reasons.join(",")}` };
    const parity = (from: number, to: number): Segment[] => [{ kind: "parity", from, to }];
    if (v.reasons.includes("edge_flip")) run("parity", ollParity(size), parity);
    else if (v.reasons.includes("parity")) run("parity", pllParity(size), parity);
    else return { ok: false, badCells: [], reason: `reduced:${v.reasons.join(",")}` };
  }
  if (!isSolved(cube)) return { ok: false, badCells: [], reason: "unsolved" };
  return { ok: true, moves, stages, segments };
}
