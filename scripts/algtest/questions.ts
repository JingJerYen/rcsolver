// The questions to ask, each with its own check. `known` is a correct answer, for --dry.
import { effect, sameAs } from "./check.js";

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
];
