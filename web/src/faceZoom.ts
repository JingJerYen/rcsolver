/**
 * One face of the net blown up to full width, for fixing colours with a finger instead of a pin.
 * With the photo of that face, each sticker gets a small chip of the colour that was read on top
 * of the photo, so a wrong read stands out against the real sticker under it. Without a photo
 * (a saved or shared cube) the cells are just big swatches. A row of the six colours sits under
 * the face: pick one, then tap as many cells as should have it.
 */
import { COLORS, type Color, type Face } from "./api.js";
import { COLOR_HEX, COLOR_NAME, LOW_CONFIDENCE, UNKNOWN, cellAt, hexOf, isEdited, setCell, type NetState } from "./net.js";
import { tr } from "./i18n.js";

/** Tabs in the order the faces were photographed. */
const TAB_ORDER: Face[] = ["F", "R", "B", "L", "U", "D"];

const NET_ICON =
  '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M8 3h5v5H8zM3 8h5v5H3zM8 8h5v5H8zM13 8h5v5h-5zM18 8h3v5h-3zM8 13h5v5H8z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>';

export interface FaceZoomOptions {
  face: Face;
  /** data: URL of the photo of this face, if it was taken in this session. */
  photo?: string;
  onChange: () => void;
  /** Another face's tab was tapped. */
  onFace: (face: Face) => void;
  /** Back to the whole net. */
  onBack: () => void;
}

const isLow = (s: NetState, f: Face, r: number, c: number) => Number(s.confidence[f][r]![c]) < LOW_CONFIDENCE;

/** The colour a tap on a cell paints; kept across faces and re-renders until another is picked. */
let brush: Color | null = null;

const colorName = (k: Color) => tr(COLOR_NAME[k], ({ W: "white", Y: "yellow", R: "red", O: "orange", G: "green", B: "blue" } as const)[k]);

/** A face still has an unsure sticker nobody has looked at: flagged and not changed. */
function needsLook(s: NetState, f: Face): boolean {
  for (let r = 0; r < s.size; r++) for (let c = 0; c < s.size; c++) if (isLow(s, f, r, c) && !isEdited(s, f, r, c)) return true;
  return false;
}

function miniFace(s: NetState, f: Face, current: boolean): string {
  let cells = "";
  for (let r = 0; r < s.size; r++) for (let c = 0; c < s.size; c++) cells += `<i style="background:${hexOf(cellAt(s.current[f], r, c))}"></i>`;
  const dot = needsLook(s, f) ? "<em></em>" : "";
  return `<button type="button" class="zoom-tab${current ? " current" : ""}" data-tab="${f}" aria-label="${f}" style="grid-template-columns:repeat(${s.size},1fr)">${cells}${dot}</button>`;
}

export function renderFaceZoom(root: HTMLElement, s: NetState, o: FaceZoomOptions) {
  const n = s.size;
  const f = o.face;
  const tabs = TAB_ORDER.map((t) => miniFace(s, t, t === f)).join("");
  let cells = "";
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const color = cellAt(s.current[f], r, c);
      const blank = color === UNKNOWN;
      const cls = `zcell${isLow(s, f, r, c) ? " low" : ""}${isEdited(s, f, r, c) ? " edited" : ""}${blank ? " blank" : ""}`;
      const chip = `<span style="background:${hexOf(color)}">${blank ? "?" : ""}</span>`;
      cells += `<button type="button" class="${cls}" data-row="${r}" data-col="${c}" aria-label="${f} ${r + 1}-${c + 1} ${blank ? "?" : colorName(color as Color)}">${chip}</button>`;
    }
  }
  const bg = o.photo ? ` style="background-image:url('${o.photo}')"` : "";
  const swatches = COLORS.map(
    (k) => `<button type="button" data-brush="${k}" class="${k === brush ? "on" : ""}" aria-pressed="${k === brush}" style="background:${COLOR_HEX[k]}" aria-label="${colorName(k)}"></button>`,
  ).join("");
  root.innerHTML = `
    <div class="zoom-head"><button type="button" class="icon-btn small-btn" data-back aria-label="${tr("回到展開圖", "Back to the whole net")}">${NET_ICON}</button><div class="zoom-tabs">${tabs}</div></div>
    <div class="zoom-face${o.photo ? " photo" : ""}"${bg}><div class="zoom-grid" style="grid-template-columns:repeat(${n},1fr);grid-template-rows:repeat(${n},1fr)">${cells}</div></div>
    <div class="brush-row">${swatches}</div>
    <p class="brush-hint">${tr("選一個顏色，再點格子；可以連續點", "Pick a colour, then tap the stickers; keep tapping")}</p>`;

  root.onclick = (e) => {
    const t = e.target as HTMLElement;
    if (t.closest("[data-back]")) return o.onBack();
    const tab = t.closest<HTMLElement>("[data-tab]");
    if (tab) return o.onFace(tab.dataset.tab as Face);
    const pick = t.closest<HTMLElement>("[data-brush]");
    if (pick) {
      brush = pick.dataset.brush as Color;
      root.querySelectorAll<HTMLElement>("[data-brush]").forEach((b) => {
        b.classList.toggle("on", b === pick);
        b.setAttribute("aria-pressed", String(b === pick));
      });
      return;
    }
    const cell = t.closest<HTMLElement>(".zcell");
    if (!cell) return;
    if (!brush) {
      // no colour picked yet: point at the row of colours
      const row = root.querySelector<HTMLElement>(".brush-row")!;
      row.classList.remove("nudge");
      void row.offsetWidth;
      row.classList.add("nudge");
      return;
    }
    const r = Number(cell.dataset.row);
    const c = Number(cell.dataset.col);
    if (cellAt(s.current[f], r, c) === brush) return;
    setCell(s.current[f], r, c, brush);
    o.onChange();
    renderFaceZoom(root, s, o);
  };
}
