/**
 * On a computer, a short label under an icon button while the mouse rests on it: the button's
 * aria-label, which already says what it does. Phones have no hover, so nothing changes there.
 */
export function initHoverTips(root: Document) {
  if (!matchMedia("(hover: hover) and (pointer: fine)").matches) return;
  const tip = root.createElement("div");
  tip.className = "hover-tip";
  tip.setAttribute("aria-hidden", "true");
  root.body.appendChild(tip);
  let timer = 0;
  let current: HTMLElement | null = null;
  const hide = () => {
    clearTimeout(timer);
    current = null;
    tip.classList.remove("on");
  };
  const show = (el: HTMLElement, text: string) => {
    // inside an open dialog the tip must be in it too, or the dialog would cover it
    const host = el.closest("dialog") ?? root.body;
    if (tip.parentElement !== host) host.appendChild(tip);
    tip.textContent = text;
    tip.classList.add("on");
    const r = el.getBoundingClientRect();
    const t = tip.getBoundingClientRect();
    const below = r.bottom + 8 + t.height <= innerHeight - 4;
    const left = Math.max(4, Math.min(innerWidth - t.width - 4, r.left + r.width / 2 - t.width / 2));
    tip.style.left = `${left}px`;
    tip.style.top = `${below ? r.bottom + 8 : r.top - 8 - t.height}px`;
  };
  root.addEventListener("pointerover", (e) => {
    if (e.pointerType !== "mouse") return;
    const el = (e.target as HTMLElement).closest<HTMLElement>("button[aria-label], label[aria-label]");
    if (el === current) return;
    hide();
    const text = el?.getAttribute("aria-label")?.trim();
    // a button whose own text already says it needs no tip
    if (!el || !text || text === el.textContent?.trim()) return;
    current = el;
    timer = window.setTimeout(() => show(el, text), 400);
  });
  root.addEventListener("pointerout", (e) => {
    if (current && !current.contains(e.relatedTarget as Node | null)) hide();
  });
  root.addEventListener("pointerdown", hide, true);
  addEventListener("scroll", hide, true);
}
