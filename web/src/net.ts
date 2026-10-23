import { COLORS, FACES, type Color, type Face, type Recognition } from "./api.js";

export const COLOR_HEX: Record<Color, string> = { W: "#f9fcff", Y: "#ffda35", R: "#ed4954", O: "#ff9435", G: "#21bb86", B: "#3485ed" };
export const COLOR_NAME: Record<Color, string> = { W: "白", Y: "黃", R: "紅", O: "橘", G: "綠", B: "藍" };

/** Where each face sits in the 4×3 net: [column, row]. */
const NET_POS: Record<Face, [number, number]> = { U: [1, 0], L: [0, 1], F: [1, 1], R: [2, 1], B: [3, 1], D: [1, 2] };

export const LOW_CONFIDENCE = 7;

export interface NetState {
  size: number;
  original: Record<Face, string[]>;
  current: Record<Face, string[]>;
  confidence: Record<Face, string[]>;
}

export function makeState(size: number, r: Recognition): NetState {
  const copy = (g: Record<Face, string[]>) => Object.fromEntries(FACES.map((f) => [f, [...g[f]]])) as Record<Face, string[]>;
  return { size, original: copy(r.faces), current: copy(r.faces), confidence: copy(r.confidence) };
}

export function cellAt(grid: string[], r: number, c: number): Color {
  return grid[r]![c] as Color;
}

export function setCell(grid: string[], r: number, c: number, color: Color) {
  const row = grid[r]!;
  grid[r] = row.slice(0, c) + color + row.slice(c + 1);
}

export function colorCounts(grid: Record<Face, string[]>): Record<Color, number> {
  const counts = Object.fromEntries(COLORS.map((c) => [c, 0])) as Record<Color, number>;
  for (const f of FACES) for (const row of grid[f]) for (const ch of row) counts[ch as Color]++;
  return counts;
}

export interface Accuracy {
  cells: number;
  corrected: number;
  correctedByFace: Record<Face, number>;
  lowConfidence: number;
  /** Low-confidence cells that the user did change: how well the model knows what it does not know. */
  lowConfidenceCorrected: number;
}

export function accuracy(s: NetState): Accuracy {
  const byFace = Object.fromEntries(FACES.map((f) => [f, 0])) as Record<Face, number>;
  let corrected = 0;
  let low = 0;
  let lowCorrected = 0;
  for (const f of FACES) {
    for (let r = 0; r < s.size; r++) {
      for (let c = 0; c < s.size; c++) {
        const changed = cellAt(s.original[f], r, c) !== cellAt(s.current[f], r, c);
        const isLow = Number(s.confidence[f][r]![c]) < LOW_CONFIDENCE;
        if (changed) {
          corrected++;
          byFace[f]++;
        }
        if (isLow) low++;
        if (isLow && changed) lowCorrected++;
      }
    }
  }
  return { cells: 6 * s.size * s.size, corrected, correctedByFace: byFace, lowConfidence: low, lowConfidenceCorrected: lowCorrected };
}

/** Draw the net; the cells are too small to hit one by one, so tapping a face hands it to `onFace` to open up. */
export function renderNet(root: HTMLElement, s: NetState, onFace?: (face: Face) => void) {
  root.innerHTML = "";
  for (const f of FACES) {
    const [col, row] = NET_POS[f];
    const face = document.createElement("div");
    face.className = onFace ? "face tap" : "face";
    if (onFace) face.addEventListener("click", () => onFace(f));
    face.style.gridColumn = String(col + 1);
    face.style.gridRow = String(row + 1);
    face.style.gridTemplateColumns = `repeat(${s.size},1fr)`;
    const label = document.createElement("span");
    label.className = "face-label";
    label.textContent = f;
    face.appendChild(label);
    for (let r = 0; r < s.size; r++) {
      for (let c = 0; c < s.size; c++) {
        const cell = document.createElement("div");
        const color = cellAt(s.current[f], r, c);
        cell.className = "cell";
        cell.style.background = COLOR_HEX[color];
        cell.textContent = s.size <= 5 ? color : "";
        cell.classList.toggle("edited", color !== cellAt(s.original[f], r, c));
        cell.dataset.face = f;
        cell.dataset.row = String(r);
        cell.dataset.col = String(c);
        if (Number(s.confidence[f][r]![c]) < LOW_CONFIDENCE) cell.classList.add("low");
        cell.title = `${f} 第 ${r + 1} 列第 ${c + 1} 格，信心 ${s.confidence[f][r]![c]}`;
        face.appendChild(cell);
      }
    }
    root.appendChild(face);
  }
}

/** Colour chips with counts only (no words): a chip turns red when its count is not N². */
export function renderLegend(root: HTMLElement, s: NetState) {
  const counts = colorCounts(s.current);
  const expected = s.size * s.size;
  root.innerHTML = COLORS.map((c) => {
    const off = counts[c] !== expected ? " off" : "";
    return `<span class="${off.trim()}"><i style="background:${COLOR_HEX[c]};border:1px solid #bbb"></i>${counts[c]}</span>`;
  }).join("");
}

/** Flag the given net cells as impossible (pulsing red); pass [] to clear. */
export function markBadCells(root: HTMLElement, cells: { face: Face; row: number; col: number }[]) {
  root.querySelectorAll(".cell.bad").forEach((el) => el.classList.remove("bad"));
  for (const c of cells) {
    root.querySelector(`.cell[data-face="${c.face}"][data-row="${c.row}"][data-col="${c.col}"]`)?.classList.add("bad");
  }
}
