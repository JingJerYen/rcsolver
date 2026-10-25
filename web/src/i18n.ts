/**
 * Two languages: Traditional Chinese on a device whose first language is Chinese, English on any
 * other. The page decides and passes its choice to the solve worker with every request, so the
 * teaching text the worker writes always matches the page around it.
 */
export type Lang = "zh" | "en";

const first = globalThis.navigator?.languages?.[0] ?? globalThis.navigator?.language ?? "zh";
export let LANG: Lang = first.toLowerCase().startsWith("zh") ? "zh" : "en";

/** The solve worker adopts the page's language before writing any text. */
export function setLang(lang: Lang) {
  LANG = lang;
}

/** Pick the text for this device: `tr("中文", "English")`. */
export const tr = (zh: string, en: string): string => (LANG === "zh" ? zh : en);

/** English names for the buttons and canvases labelled in index.html, read out by screen readers. */
const LABELS_EN: Record<string, string> = {
  回到開始: "Home",
  怎麼拍: "How to shoot",
  取消: "Cancel",
  分享: "Share",
  開始拍攝: "Start taking photos",
  重新拍攝: "Retake all",
  重拍上一面: "Retake the last face",
  "辨識出來的方塊，可拖曳旋轉": "The cube as read; drag to turn it",
  貼上方塊狀態: "Paste a cube state",
  複製整段轉法: "Copy all the moves",
  自動播放: "Play",
  示範怎麼轉方塊的動畫: "Animation of how to turn the cube",
  每步停留時間: "Time per move",
  步驟: "Step",
  "教學模式：一層一層慢慢解": "Teaching mode: solve it layer by layer",
  改標題: "Rename",
  拍這一面: "Take this face",
  從相簿選擇: "Choose from photos",
  導覽模式: "Guide mode",
  可拖曳旋轉視角的方塊: "Cube; drag to change the view",
  再看一次這條公式: "Replay this formula",
  再拍一組: "Take a new set",
  再來一次: "Again",
  全部還原: "Undo all fixes",
  儲存: "Save",
  修正顏色: "Fix colours",
  下一步: "Next move",
  上一步: "Previous move",
  研究模式: "Study mode",
  求解: "Solve",
  轉法: "Moves",
  選方塊大小: "Choose a cube size",
  回到求解: "Back to the solve",
  轉回正面: "Back to the front view",
  只看標記的塊: "Show only the marked pieces",
  說明: "Help",
  請稍候: "Please wait",
  手轉: "Turn layers by hand",
};

/** On an English device, switch the page language and the Chinese labels written in index.html. */
export function localizePage(root: Document) {
  if (LANG === "zh") return;
  root.documentElement.lang = "en";
  for (const el of root.querySelectorAll<HTMLElement>("[aria-label]")) {
    const en = LABELS_EN[el.getAttribute("aria-label")!];
    if (en) el.setAttribute("aria-label", en);
  }
}
