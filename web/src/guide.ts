/**
 * Guide mode: which pieces a stretch of the solution works on, how the stages group into chips,
 * and a short explanation of the strategy for each. Pure helpers over the solver's segments.
 */
import type { Segment } from "./solveAny.js";
import { layerValues, type Vec } from "./cubeState.js";
import { centreSolverFor } from "./solvers/centres.js";
import { wingOrbits } from "./solvers/wings.js";
import { tr } from "./i18n.js";

const key = (p: Vec, n: Vec) => `${p.join(",")}|${n.join(",")}`;

export function segmentAt(segments: Segment[], moveIndex: number): Segment | null {
  return segments.find((s) => moveIndex >= s.from && moveIndex < s.to) ?? null;
}

/** Sticker keys shown in colour while this segment runs; null means every sticker. The rest turn grey. */
export function focusKeys(seg: Segment | null, size: number): Set<string> | null {
  if (!seg) return null;
  const m = size - 1;
  const odd = size % 2 === 1;
  const out = new Set<string>();
  const addMidges = () => {
    for (const p of edgeMidPositions(size)) for (const n of edgeNormals(p, m)) out.add(key(p, n));
  };
  if (seg.kind === "centres") {
    for (const pos of centreSolverFor(size).orbits[seg.orbit]!.positions) out.add(key(pos.p, pos.n));
    return out;
  }
  if (seg.kind === "edges") {
    const orbits = wingOrbits(size);
    const add = (oi: number) => {
      for (const w of orbits[oi]!.positions) for (const n of w.faces) out.add(key(w.p, n));
    };
    add(seg.orbit);
    // the reference the orbit is matched against
    if (odd) addMidges();
    else if (seg.orbit > 0) add(0);
    return out;
  }
  if (seg.kind === "parity") {
    // the UF and UB edges, which the parity algorithms flip or swap
    const vals = layerValues(size);
    for (const x of vals) for (const z of [-m, m]) {
      const p: Vec = [x, m, z];
      for (const n of edgeNormals(p, m)) out.add(key(p, n));
    }
    return out;
  }
  if (seg.kind === "cube3" && odd && size > 3) {
    // the 3×3 skeleton of an odd cube: corners, middle edges and middle centres
    for (const x of [-m, 0, m]) for (const y of [-m, 0, m]) for (const z of [-m, 0, m]) {
      const p: Vec = [x, y, z];
      for (let ax = 0; ax < 3; ax++) {
        if (Math.abs(p[ax]!) !== m) continue;
        const n: Vec = [0, 0, 0];
        n[ax] = Math.sign(p[ax]!);
        out.add(key(p, n));
      }
    }
    return out;
  }
  return null;
}

function edgeNormals(p: Vec, m: number): Vec[] {
  const out: Vec[] = [];
  for (let ax = 0; ax < 3; ax++) {
    if (Math.abs(p[ax]!) !== m) continue;
    const n: Vec = [0, 0, 0];
    n[ax] = Math.sign(p[ax]!);
    out.push(n);
  }
  return out;
}

function edgeMidPositions(size: number): Vec[] {
  const m = size - 1;
  const out: Vec[] = [];
  for (const a of [-m, m]) for (const b of [-m, m]) out.push([0, a, b], [a, 0, b], [a, b, 0]);
  return out;
}

export interface Chip {
  kind: Segment["kind"];
  from: number;
  to: number;
}

/** Consecutive segments of one kind form a chip: centres, edges, parity, 3×3. */
export function chipsFor(segments: Segment[]): Chip[] {
  const out: Chip[] = [];
  for (const s of segments) {
    const last = out[out.length - 1];
    if (last && last.kind === s.kind) last.to = s.to;
    else out.push({ kind: s.kind, from: s.from, to: s.to });
  }
  return out;
}

/** Title and explanation of what the solver is doing in this segment, in the device's language. */
export function describe(seg: Segment, size: number): { title: string; body: string } {
  const odd = size % 2 === 1;
  switch (seg.kind) {
    case "centres": {
      const stage = [
        tr("先把白色和黃色的中心格都集中到上面和下面。", "First gather all the white and yellow centre pieces onto the top and bottom."),
        tr("再把紅色和橘色分到左右兩面，綠色和藍色自然就到了前後。", "Then sort red and orange onto the left and right faces; green and blue end up front and back on their own."),
        tr("最後讓每一面各自歸位。", "Finally, finish each face."),
      ][seg.stage]!;
      const group =
        seg.orbits > 1
          ? tr(
              `中心格分成幾組，每一組只會在組內互換，所以一組一組解；彩色的就是現在這一組。${seg.orbit > 0 ? "這一組只用不會弄亂前面幾組的公式。" : ""}`,
              `The centre pieces fall into groups that only ever swap among themselves, so they are solved one group at a time; the coloured ones are this group. ${seg.orbit > 0 ? "This group only uses formulas that leave the earlier groups alone. " : ""}`,
            )
          : tr("彩色的中心格只會在這些位置之間互換。", "The coloured centre pieces only ever swap among these positions. ");
      return { title: tr(`中心 ${seg.orbit + 1}/${seg.orbits}・階段 ${seg.stage + 1}/3`, `Centres ${seg.orbit + 1}/${seg.orbits} · step ${seg.stage + 1}/3`), body: `${group}${stage}` };
    }
    case "edges": {
      const ref = odd
        ? tr("以每條邊中央那一塊（也是彩色）的顏色為準。", "Each edge is matched to its middle piece (also in colour).")
        : seg.orbit === 0
          ? tr("先讓每條邊上的翼塊兩兩成對。", "First, pair up the wing pieces on each edge.")
          : tr("以最外層那組翼塊（也是彩色）為準對齊。", "They are lined up against the outermost wing pieces (also in colour).");
      return {
        title: tr(`邊塊 ${seg.orbit + 1}/${seg.orbits}`, `Edges ${seg.orbit + 1}/${seg.orbits}`),
        body: tr(`外層先轉幾下把要配的兩塊擺到位，接一條只換三塊的公式，其他全部不動。${ref}`, `A few outer turns line up the two pieces to pair, then a formula swaps just three pieces and leaves everything else alone. ${ref}`),
      };
    }
    case "parity":
      return {
        title: tr("特殊修正", "Parity fix"),
        body: tr(
          "偶數階才有的狀況：整條邊翻了面或兩條邊對調，這在 3×3 上不可能出現，所以用內層一起轉的公式處理。",
          "Something only even-sized cubes can have: a whole edge flipped, or two edges swapped. That can't happen on a 3×3, so it takes a formula that turns inner layers too.",
        ),
      };
    case "cube3":
      return seg.phase === 1
        ? {
            title: tr("當成 3×3・階段 1/2", "As a 3×3 · step 1/2"),
            body: tr(
              `${size > 3 ? "只看角塊和每條邊、每一面的一塊，現在它就是個 3×3。" : ""}先把每一塊轉正：白黃朝上下、中層的邊留在中層。（Kociemba 兩階段法）`,
              `${size > 3 ? "Looking only at the corners, the edges and one piece per face, it is now just a 3×3. " : ""}First turn every piece the right way: white and yellow facing up or down, middle-layer edges kept in the middle layer. (Kociemba's two-phase method)`,
            ),
          }
        : {
            title: tr("當成 3×3・階段 2/2", "As a 3×3 · step 2/2"),
            body: tr("接下來只用上下層的轉動和側面 180°，把每一塊送回家。", "Then, using only top and bottom turns and half turns of the sides, every piece goes home."),
          };
    case "optimal":
      return {
        title: tr("最短解", "Shortest solution"),
        body: tr("電腦搜尋過所有可能，這是步數最少的解法之一，每一步都讓剩下的步數少一。", "The computer searched every possibility. This is one of the shortest solutions: each move takes you one move closer."),
      };
  }
}
