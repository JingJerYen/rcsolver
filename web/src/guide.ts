/**
 * Guide mode: which pieces a stretch of the solution works on, how the stages group into chips,
 * and a short explanation of the strategy for each. Pure helpers over the solver's segments.
 */
import type { Segment } from "./solveAny.js";
import { layerValues, type Vec } from "./cubeState.js";
import { centreSolverFor } from "./solvers/centres.js";
import { wingOrbits } from "./solvers/wings.js";

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
  /** Teaching stage number (1–7); the orientation step joins stage 1. */
  stage?: number;
}

/** Consecutive segments of one kind form a chip: centres, edges, parity, 3×3; teaching stages one each. */
export function chipsFor(segments: Segment[]): Chip[] {
  const out: Chip[] = [];
  for (const s of segments) {
    const stage = s.kind === "lbl" ? Math.max(1, s.stage) : undefined;
    const last = out[out.length - 1];
    if (last && last.kind === s.kind && last.stage === stage) last.to = s.to;
    else out.push({ kind: s.kind, from: s.from, to: s.to, ...(stage !== undefined ? { stage } : {}) });
  }
  return out;
}

/** Title and explanation (Traditional Chinese) of what the solver is doing in this segment. */
export function describe(seg: Segment, size: number): { title: string; body: string; alg?: string } {
  const odd = size % 2 === 1;
  switch (seg.kind) {
    case "centres": {
      const stage = ["先把白色和黃色的中心格都集中到上面和下面。", "再把紅色和橘色分到左右兩面，綠色和藍色自然就到了前後。", "最後讓每一面各自歸位。"][seg.stage]!;
      const group = seg.orbits > 1 ? `中心格分成幾組，每一組只會在組內互換，所以一組一組解；彩色的就是現在這一組。${seg.orbit > 0 ? "這一組只用不會弄亂前面幾組的公式。" : ""}` : "彩色的中心格只會在這些位置之間互換。";
      return { title: `中心 ${seg.orbit + 1}/${seg.orbits}・階段 ${seg.stage + 1}/3`, body: `${group}${stage}` };
    }
    case "edges": {
      const ref = odd ? "以每條邊中央那一塊（也是彩色）的顏色為準。" : seg.orbit === 0 ? "先讓每條邊上的翼塊兩兩成對。" : "以最外層那組翼塊（也是彩色）為準對齊。";
      return { title: `邊塊 ${seg.orbit + 1}/${seg.orbits}`, body: `外層先轉幾下把要配的兩塊擺到位，接一條只換三塊的公式，其他全部不動。${ref}` };
    }
    case "parity":
      return { title: "特殊修正", body: "偶數階才有的狀況：整條邊翻了面或兩條邊對調，這在 3×3 上不可能出現，所以用內層一起轉的公式處理。" };
    case "cube3":
      return seg.phase === 1
        ? { title: `當成 3×3・階段 1/2`, body: `${size > 3 ? "只看角塊和每條邊、每一面的一塊，現在它就是個 3×3。" : ""}先把每一塊轉正：白黃朝上下、中層的邊留在中層。（Kociemba 兩階段法）` }
        : { title: `當成 3×3・階段 2/2`, body: "接下來只用上下層的轉動和側面 180°，把每一塊送回家。" };
    case "optimal":
      return { title: "最短解", body: "電腦搜尋過所有可能，這是步數最少的解法之一，每一步都讓剩下的步數少一。" };
    case "lbl":
      return { title: seg.title, body: seg.body, ...(seg.alg ? { alg: seg.alg } : {}) };
  }
}
