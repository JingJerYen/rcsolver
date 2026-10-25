// The questions to ask, each with its own check. `known` is a correct answer, for --dry.
import { downAllYellow, effect, netAfter, sameAs, threeCycle } from "./check.js";

const SCRAMBLE = "R U2 F' L D' B2 R' U F2 D";

export interface Question {
  id: string;
  size: number;
  ask: string;
  marks?: string[];
  check: (moves: string, size: number) => string | null;
  impossible?: boolean;
  known?: string;
}

export const QUESTIONS: Question[] = [
  { id: "T-perm", size: 3, ask: "T-perm", check: sameAs("R U R' U' R' F R2 U' R' U' R U R' F'"), known: "R U R' U' R' F R2 U' R' U' R U R' F'" },
  { id: "Sune", size: 3, ask: "Sune 小魚", check: sameAs("R U R' U R U2 R'"), known: "R U R' U R U2 R'" },
  {
    id: "邊三循環",
    size: 3,
    ask: "黑點的三個邊順時針輪換（從上面看），其他都不動",
    marks: ["UF", "UL", "UR"],
    // seen from above a clockwise turn carries F to L, so UF → UL → UR → UF (a U-perm)
    check: effect([["UF", "UL"], ["UL", "UR"], ["UR", "UF"]]),
    known: "R2 U R U R' U' R' U' R' U R'",
  },
  {
    id: "只換兩邊",
    size: 3,
    ask: "只交換兩個黑點的邊，其他都不動",
    marks: ["UF", "UB"],
    check: effect([["UF", "UB"], ["UB", "UF"]]),
    impossible: true,
  },
  { id: "4階PLL parity", size: 4, ask: "4 階 PLL parity", check: sameAs("2R2 U2 2R2 Uw2 2R2 Uw2"), known: "2R2 U2 2R2 Uw2 2R2 Uw2" },
  {
    id: "底面全黃",
    size: 3,
    ask: `方塊現在是這樣（每面由上排到下排，W 白 Y 黃 R 紅 O 橘 G 綠 B 藍；U 從上面看、上排靠 B 面；D 從下面看、上排靠 F 面；F R B L 從正面看、上排靠 U 面）：\n${netAfter(SCRAMBLE, 3)}\n把底面轉成都是黃色的`,
    check: downAllYellow(SCRAMBLE),
    known: "D' F2 U' R B2 D L' F U2 R'",
  },
  { id: "中層三邊輪換", size: 3, ask: "把3×3的側邊三條邊輪換", check: threeCycle("middle-edge"), known: "R F L R2 U R U R' U' R' U' R' U R' L' F' R'" },
  { id: "三角輪換", size: 3, ask: "交換3×3的三個角塊", check: threeCycle("corner"), known: "x R' U R' D2 R U' R' D2 R2 x'" },
];
