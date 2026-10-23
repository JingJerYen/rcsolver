/**
 * Offline: for each cube size, choose the order in which the centre orbits are solved and find
 * short sequences that move at most three stickers of one orbit while leaving every earlier
 * orbit's faces (and, on odd cubes, the core) as they were. The first orbit(s) are solved with
 * plain moves; the rest with these macros. Run `npx tsx scripts/gen-centre-macros.ts`.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { centreSolverFor, Orbit, OUTER_MOVES, sliceMoves } from "../web/src/solvers/centres.js";
import { applyAlgorithm, fromNet, parseAlgorithm, type Sticker } from "../web/src/cubeState.js";
import type { Face } from "../web/src/api.js";

const COLORS: Record<Face, string> = { U: "W", R: "R", F: "G", D: "Y", L: "O", B: "B" };
const net = (n: number) => Object.fromEntries((Object.keys(COLORS) as Face[]).map((f) => [f, Array.from({ length: n }, () => COLORS[f].repeat(n))])) as Record<Face, string[]>;
const inv = (t: string) => (t.endsWith("'") ? t.slice(0, -1) : t.endsWith("2") ? t : t + "'");
const key = (s: Sticker) => `${s.p.join(",")}|${s.n.join(",")}`;

/** Net frame rotation of a sequence on an odd cube must be zero: count quarter turns per middle axis. */
function coreStaysPut(tokens: string[], n: number): boolean {
  if (n % 2 === 0) return true;
  const mid = (n + 1) / 2;
  const turns: Record<string, number> = { x: 0, y: 0, z: 0 };
  for (const t of tokens) {
    const m = /^(\d)([URFDLB])(['2]?)$/.exec(t);
    if (!m || Number(m[1]) !== mid) continue;
    const axis = { R: "x", L: "x", U: "y", D: "y", F: "z", B: "z" }[m[2]!]!;
    const sign = "URF".includes(m[2]!) ? 1 : -1;
    turns[axis] = (turns[axis]! + sign * (m[3] === "2" ? 2 : m[3] === "'" ? -1 : 1) + 4) % 4;
  }
  // a rotation is identity only if all axes are 0 (rotations about different axes don't cancel this simply, but
  // the cheap check is sufficient as a filter: a false negative only loses a candidate)
  return turns.x === 0 && turns.y === 0 && turns.z === 0;
}

const UD = [0, 1, 2, 3, 12, 13, 14, 15];
const LR = [4, 5, 6, 7, 16, 17, 18, 19];
const FB = [8, 9, 10, 11, 20, 21, 22, 23];
/** Does the orbit permutation keep stage `st` of the orbit solved? (same rule as the solver) */
function preserves(perm: number[], st: number): boolean {
  const groups = st === 0 ? [UD] : st === 1 ? [UD, LR, FB] : [0, 1, 2, 3, 4, 5].map((f) => [0, 1, 2, 3].map((i) => f * 4 + i));
  return groups.every((g) => g.every((p) => g.includes(perm[p]!)));
}

/** Per stage (1..3) the shortest macros usable there: stage 2 keeps stage 1, stage 3 keeps stages 1 and 2. */
function macrosFor(n: number, target: Orbit, preserved: Orbit[], forms: string[][], limit: number): string[][][] {
  const solved = fromNet(n, net(n));
  const labelled: Sticker[] = solved.map((s, i) => ({ ...s, c: String(i) as never }));
  const tIdx = new Map(target.positions.map((x, i) => [`${x.p.join(",")}|${x.n.join(",")}`, i]));
  const pKeys = preserved.flatMap((o) => o.positions.map((x) => `${x.p.join(",")}|${x.n.join(",")}`));
  const solvedByKey = new Map(solved.map((s) => [key(s), s.c]));
  const found = new Map<string, string[]>();
  for (const tokens of forms) {
    if (!coreStaysPut(tokens, n)) continue;
    const moves = parseAlgorithm(tokens.join(" "), n);
    const real = applyAlgorithm(solved, moves);
    const byKey = new Map(real.map((s) => [key(s), s.c]));
    if (pKeys.some((k) => byKey.get(k) !== solvedByKey.get(k))) continue;
    const after = applyAlgorithm(labelled, moves);
    const where = new Map<string, string>();
    for (const st of after) where.set(st.c as unknown as string, key(st));
    const perm = Array.from({ length: 24 }, (_, i) => i);
    let moved = 0;
    for (let i = 0; i < labelled.length; i++) {
      const from = key(labelled[i]!);
      const t = tIdx.get(from);
      if (t === undefined) continue;
      const to = tIdx.get(where.get(labelled[i]!.c as unknown as string)!);
      if (to === undefined) {
        moved = 99;
        break;
      }
      perm[t] = to;
      if (to !== t) moved++;
    }
    if (moved === 0 || moved > 3) continue;
    const pk = perm.join(",");
    const prev = found.get(pk);
    if (!prev || prev.length > tokens.length) found.set(pk, tokens);
  }
  const all = [...found.entries()].map(([pk, tokens]) => ({ perm: pk.split(",").map(Number), tokens })).sort((a, b) => a.tokens.length - b.tokens.length);
  return [0, 1, 2].map((stage) => all.filter((m) => [0, 1].slice(0, stage).every((st) => preserves(m.perm, st))).slice(0, limit).map((m) => m.tokens));
}

const FILE = "web/src/solvers/centreMacros.ts";
const out: Record<number, { order: number[]; tableOrbits: number; macros: string[][][][] }> = existsSync(FILE)
  ? (JSON.parse(readFileSync(FILE, "utf8").split("= ")[1]!.replace(/;\s*$/, "")) as typeof out)
  : {};
const sizes = (process.argv[2] ?? "5,6,7").split(",").map(Number);
for (const n of sizes) {
  const solver = centreSolverFor(n);
  const orbits = solver.orbits;
  const depths: number[] = [];
  for (let d = 2; d <= Math.floor(n / 2) + (n % 2); d++) depths.push(d);
  const slices = depths.flatMap(sliceMoves);
  const faceOf = (t: string) => t.replace(/[2']/g, "");
  const shortForms: string[][] = [];
  const longForms: string[][] = [];
  const pairs: string[][] = [];
  for (const a of OUTER_MOVES) for (const b of OUTER_MOVES) if (faceOf(a) !== faceOf(b)) pairs.push([a, b]);
  for (const s1 of slices) for (const s2 of slices) {
    if (faceOf(s1).slice(1) === faceOf(s2).slice(1) && s1[0] === s2[0]) continue;
    shortForms.push([s1, s2, inv(s1), inv(s2)]);
    for (const x of OUTER_MOVES) shortForms.push([s1, x, s2, inv(x), inv(s1), x, inv(s2), inv(x)]);
    for (const [a, b] of pairs) longForms.push([s1, a, b, s2, inv(b), inv(a), inv(s1), a, b, inv(s2), inv(b), inv(a)]);
  }
  // order: x-centre orbits first (solved with plain moves; deeper slices first so later ones do not disturb them),
  // then +-centres and obliques with macros
  const isX = (o: Orbit) => Math.abs(o.cells[0]![0]) === Math.abs(o.cells[0]![1]);
  const xs = orbits.map((o, i) => [o, i] as const).filter(([o]) => isX(o)).sort((a, b) => Math.abs(a[0].cells[0]![0]) - Math.abs(b[0].cells[0]![0])).map(([, i]) => i);
  const rest = orbits.map((_, i) => i).filter((i) => !xs.includes(i));
  const order = [...xs, ...rest];
  const macros: string[][][][] = [];
  const t0 = Date.now();
  for (let i = xs.length; i < order.length; i++) {
    const target = orbits[order[i]!]!;
    const preserved = order.slice(0, i).map((j) => orbits[j]!);
    let m = macrosFor(n, target, preserved, shortForms, 100);
    if (m.some((x) => x.length < 40)) {
      console.log(`  stage counts ${m.map((x) => x.length).join("/")} too thin, adding long forms (${longForms.length})`);
      m = macrosFor(n, target, preserved, [...shortForms, ...longForms], 100);
    }
    console.log(`${n}x${n} orbit ${JSON.stringify(target.cells[0])} preserving ${preserved.length}: per stage ${m.map((x) => x.length).join("/")} macros, shortest ${m.map((x) => x[0]?.length).join("/")} (${Date.now() - t0} ms)`);
    macros.push(m);
  }
  out[n] = { order, tableOrbits: xs.length, macros };
}
writeFileSync(FILE, `// Generated by scripts/gen-centre-macros.ts: per size, the orbit order, how many leading orbits use plain moves,\n// and for each remaining orbit, per stage, the macros (3-cycles and less) that keep every earlier orbit and stage intact.\nexport const CENTRE_MACROS: Record<number, { order: number[]; tableOrbits: number; macros: string[][][][] }> = ${JSON.stringify(out)};\n`);
