/**
 * The sequences your own-sequence list starts with, in groups.
 */
import { tr } from "./i18n.js";

/*
 * Built in, each checked on the model (tests/macros.test.ts): the beginner's method as the lessons
 * teach it (the lessons' own names), two-look OLL (the usual English names and OLL numbers; the
 * Chinese beside them is a translation, not a standard), the usual PLLs by their standard names,
 * written with face turns only, and two Pyraminx edge cycles.
 */
export const BUILT_IN: [string, [string, string][]][] = [
  [tr("入門", "Beginner"), [
    [tr("翻邊", "Flip edge"), "D R F' R'"],
    [tr("插角", "Insert corner"), "R' D' R D"],
    [tr("往右", "Right"), "U R U' R' U' F' U F"],
    [tr("往左", "Left"), "U' L' U L U F U' F'"],
    [tr("黃十字", "Yellow cross"), "F R U R' U' F'"],
    [tr("小魚", "Fish"), "R U R' U R U2 R'"],
    [tr("換角", "Swap corners"), "R' F R' B2 R F' R' B2 R2"],
    [tr("換邊", "Swap edges"), "R U' R U R U R U' R' U' R2"],
  ]],
  ["OLL", [
    [tr("一字 Line", "Line"), "F R U R' U' F'"],
    [tr("L字 L-shape", "L-shape"), "F U R U' R' F'"],
    [tr("點 Dot", "Dot"), "F R U R' U' F' U2 F U R U' R' F'"],
    [tr("小魚 Sune（OLL 27）", "Sune (OLL 27)"), "R U R' U R U2 R'"],
    [tr("反小魚 Antisune（OLL 26）", "Antisune (OLL 26)"), "R U2 R' U' R U' R'"],
    [tr("H（OLL 21）", "H (OLL 21)"), "R U R' U R U' R' U R U2 R'"],
    [tr("Pi（OLL 22）", "Pi (OLL 22)"), "R U2 R2 U' R2 U' R2 U2 R"],
    [tr("車燈 Headlights（OLL 23）", "Headlights (OLL 23)"), "R2 D R' U2 R D' R' U2 R'"],
    [tr("T（OLL 24）", "T (OLL 24)"), "Rw U R' U' Rw' F R F'"],
    [tr("領結 Bowtie（OLL 25）", "Bowtie (OLL 25)"), "F' Rw U R' U' Rw' F R"],
  ]],
  ["PLL", [
    ["T", "R U R' U' R' F R2 U' R' U' R U R' F'"],
    ["Ua", "R U' R U R U R U' R' U' R2"],
    ["Ub", "R2 U R U R' U' R' U' R' U R'"],
    ["Aa", "R' F R' B2 R F' R' B2 R2"],
    ["Ab", "R2 B2 R F R' B2 R F' R"],
    ["Ja", "R' U L' U2 R U' R' U2 R L"],
    ["Jb", "R U R' F' R U R' U' R' F R2 U' R'"],
    ["Y", "F R U' R' U' R U R' F' R U R' U' R' F R F'"],
    ["H", "R2 U2 R U2 R2 U2 R2 U2 R U2 R2"],
    ["Z", "R' U' R U' R U R U' R' U R U R2 U' R'"],
    ["F", "R' U' F' R U R' U' R' F R2 U' R' U' R U R' U R"],
    ["Ra", "R U' R' U' R U R D R' U' R D' R' U2 R'"],
    ["Rb", "R2 F R U R U' R' F' R U2 R' U2 R"],
    ["V", "R' U R' U' R D' R' D R' U D' R2 U' R2 D R2"],
    ["E", "R2 U R' U' y R U R' U' R U R' U' R U R' y' R U' R2"],
  ]],
  [tr("金字塔", "Pyraminx"), [
    [tr("換三邊", "Three edges"), "R U' R' U' R U' R'"],
    [tr("反換三邊", "Three edges back"), "R U R' U R U R'"],
  ]],
];
