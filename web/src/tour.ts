/**
 * A step-by-step tour: the screen goes dark except for one part, with a bubble explaining it, and
 * Next / Skip to move on. Each step names the elements to light up; several are lit as one box.
 */
import { tr } from "./i18n.js";

export interface TourStep {
  targets: HTMLElement[];
  title: string;
  body: string;
}

const PAD = 6;
const GAP = 14;

export function runTour(dialog: HTMLDialogElement, steps: TourStep[]) {
  const spot = dialog.querySelector<HTMLElement>(".tour-spot")!;
  const bubble = dialog.querySelector<HTMLElement>(".tour-bubble")!;
  const title = dialog.querySelector<HTMLElement>(".tour-title")!;
  const body = dialog.querySelector<HTMLElement>(".tour-body")!;
  const count = dialog.querySelector<HTMLElement>(".tour-count")!;
  const dots = dialog.querySelector<HTMLElement>(".tour-dots")!;
  const next = dialog.querySelector<HTMLButtonElement>(".tour-next")!;
  const skip = dialog.querySelector<HTMLButtonElement>(".tour-skip")!;
  // a step whose part is not on screen right now (hidden by a switch) is left out
  steps = steps.filter((s) => s.targets.some((t) => t.getClientRects().length));
  if (!steps.length) return;
  let at = 0;

  const place = () => {
    const step = steps[at]!;
    const rects = step.targets.map((t) => t.getBoundingClientRect()).filter((r) => r.width || r.height);
    if (!rects.length) return;
    const left = Math.min(...rects.map((r) => r.left)) - PAD;
    const top = Math.min(...rects.map((r) => r.top)) - PAD;
    const right = Math.max(...rects.map((r) => r.right)) + PAD;
    const bottom = Math.max(...rects.map((r) => r.bottom)) + PAD;
    Object.assign(spot.style, { left: `${left}px`, top: `${top}px`, width: `${right - left}px`, height: `${bottom - top}px` });
    // the bubble goes below the lit part when it fits there, else above; never off screen
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const h = bubble.offsetHeight;
    const below = bottom + GAP + h <= vh - 8 || top - GAP - h < 8;
    const y = below ? Math.min(bottom + GAP, vh - h - 8) : Math.max(8, top - GAP - h);
    bubble.style.top = `${y}px`;
    bubble.classList.toggle("below", below);
    const w = bubble.offsetWidth;
    const x = Math.max(8, Math.min(vw - w - 8, (left + right) / 2 - w / 2));
    bubble.style.left = `${x}px`;
    bubble.style.setProperty("--arrow-x", `${Math.max(18, Math.min(w - 18, (left + right) / 2 - x))}px`);
  };

  const show = () => {
    const step = steps[at]!;
    title.textContent = step.title;
    body.textContent = step.body;
    count.textContent = `${at + 1} / ${steps.length}`;
    dots.innerHTML = steps.map((_, i) => `<i class="${i === at ? "on" : ""}"></i>`).join("");
    next.textContent = at === steps.length - 1 ? tr("完成", "Done") : tr("下一步", "Next");
    step.targets[0]!.scrollIntoView({ block: "center" });
    requestAnimationFrame(place);
  };

  const close = () => dialog.close();
  next.onclick = () => {
    if (at === steps.length - 1) return close();
    at++;
    show();
  };
  skip.onclick = close;
  window.addEventListener("resize", place);
  dialog.addEventListener("close", () => window.removeEventListener("resize", place), { once: true });
  dialog.showModal();
  show();
}
