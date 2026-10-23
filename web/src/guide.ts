/**
 * Guide mode: how the stages of a solution group into chips, and a short explanation of the
 * strategy for each. Pure helpers over the solver's segments.
 */
import type { Segment } from "./solveAny.js";

export function segmentAt(segments: Segment[], moveIndex: number): Segment | null {
  return segments.find((s) => moveIndex >= s.from && moveIndex < s.to) ?? null;
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

/** Title and explanation (Traditional Chinese) of what the solver is doing in this segment. */
export function describe(seg: Segment, size: number): { title: string; body: string } {
  const odd = size % 2 === 1;
  switch (seg.kind) {
    case "centres": {
      const stage = ["先把白色和黃色的中心格都集中到上面和下面。", "再把紅色和橘色分到左右兩面，綠色和藍色自然就到了前後。", "最後讓每一面各自歸位。"][seg.stage]!;
      const group = seg.orbits > 1 ? `中心格分成幾組，每一組只會在組內互換，所以一組一組解；現在是${seg.orbit === 0 ? "角落那一組" : `第 ${seg.orbit + 1} 組`}。${seg.orbit > 0 ? "這一組只用不會弄亂前面幾組的公式。" : ""}` : "四個中心格只會在這些位置之間互換。";
      return { title: `中心 ${seg.orbit + 1}/${seg.orbits}・階段 ${seg.stage + 1}/3`, body: `${group}${stage}` };
    }
    case "edges": {
      const ref = odd ? "以每條邊中央那一塊的顏色為準。" : seg.orbit === 0 ? "先讓每條邊上的翼塊兩兩成對。" : "以最外層那組翼塊為準對齊。";
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
  }
}
