/**
 * One face of the net blown up to full width, for fixing colours with a finger instead of a pin.
 * With the photo of that face, each sticker gets a small chip of the colour that was read on top
 * of the photo, so a wrong read stands out against the real sticker under it. Without a photo
 * (a saved or shared cube) the cells are just big swatches. Either way, tapping a cell opens a
 * row of the six colours next to it.
 */
import { COLORS, type Color, type Face } from "./api.js";
import { COLOR_HEX, LOW_CONFIDENCE, cellAt, setCell, type NetState } from "./net.js";
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
const isEdited = (s: NetState, f: Face, r: number, c: number) => cellAt(s.current[f], r, c) !== cellAt(s.original[f], r, c);

/** A face still has an unsure sticker nobody has looked at: flagged and not changed. */
function needsLook(s: NetState, f: Face): boolean {
  for (let r = 0; r < s.size; r++) for (let c = 0; c < s.size; c++) if (isLow(s, f, r, c) && !isEdited(s, f, r, c)) return true;
  return false;
}

function miniFace(s: NetState, f: Face, current: boolean): string {
  let cells = "";
  for (let r = 0; r < s.size; r++) for (let c = 0; c < s.size; c++) cells += `<i style="background:${COLOR_HEX[cellAt(s.current[f], r, c)]}"></i>`;
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
      const cls = `zcell${isLow(s, f, r, c) ? " low" : ""}${isEdited(s, f, r, c) ? " edited" : ""}`;
      const chip = `<span style="background:${COLOR_HEX[color]}"></span>`;
      cells += `<button type="button" class="${cls}" data-row="${r}" data-col="${c}" aria-label="${f} ${r + 1}-${c + 1} ${color}">${chip}</button>`;
    }
  }
  const bg = o.photo ? ` style="background-image:url('${o.photo}')"` : "";
  root.innerHTML = `
    <div class="zoom-head"><button type="button" class="icon-btn small-btn" data-back aria-label="${tr("回到展開圖", "Back to the whole net")}">${NET_ICON}</button><div class="zoom-tabs">${tabs}</div></div>
    <div class="zoom-face${o.photo ? " photo" : ""}"${bg}><div class="zoom-grid" style="grid-template-columns:repeat(${n},1fr);grid-template-rows:repeat(${n},1fr)">${cells}</div></div>`;

  const closePicker = () => {
    root.querySelector(".picker")?.remove();
    root.querySelector(".zcell.selected")?.classList.remove("selected");
  };

  const openPicker = (cell: HTMLElement) => {
    closePicker();
    const r = Number(cell.dataset.row);
    const c = Number(cell.dataset.col);
    cell.classList.add("selected");
    const now = cellAt(s.current[f], r, c);
    const picker = document.createElement("div");
    picker.className = "picker";
    picker.innerHTML = COLORS.map(
      (k) => `<button type="button" data-pick="${k}" class="${k === now ? "current" : ""}" style="background:${COLOR_HEX[k]}" aria-label="${k}">${k}</button>`,
    ).join("");
    root.appendChild(picker);
    // above the cell, or below it when there is no room; kept inside the panel sideways
    const box = root.getBoundingClientRect();
    const at = cell.getBoundingClientRect();
    const left = Math.max(0, Math.min(box.width - picker.offsetWidth, at.left - box.left + at.width / 2 - picker.offsetWidth / 2));
    let top = at.top - box.top - picker.offsetHeight - 6;
    if (top < 0) top = at.bottom - box.top + 6;
    picker.style.left = `${left}px`;
    picker.style.top = `${top}px`;
    picker.onclick = (e) => {
      const pick = (e.target as HTMLElement).closest<HTMLElement>("[data-pick]");
      if (!pick) return;
      e.stopPropagation();
      setCell(s.current[f], r, c, pick.dataset.pick as Color);
      o.onChange();
      renderFaceZoom(root, s, o);
    };
  };

  root.onclick = (e) => {
    const t = e.target as HTMLElement;
    if (t.closest(".picker")) return;
    if (t.closest("[data-back]")) return o.onBack();
    const tab = t.closest<HTMLElement>("[data-tab]");
    if (tab) return o.onFace(tab.dataset.tab as Face);
    const cell = t.closest<HTMLElement>(".zcell");
    if (cell && !cell.classList.contains("selected")) return openPicker(cell);
    closePicker();
  };
}
