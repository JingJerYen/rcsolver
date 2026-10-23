import min2phase from "min2phase.js";

let ready = false;

/** Build the pruning tables (about 0.2 s); safe to call early and more than once. */
export function warmUp() {
  if (!ready) {
    min2phase.initFull();
    ready = true;
  }
}

/** Kociemba two-phase solution for a valid 3×3 facelet string, as a list of move tokens. */
export function solve3(facelets: string): string[] {
  warmUp();
  const s = min2phase.solve(facelets);
  if (!s) throw new Error("solver returned nothing");
  return s.split(/\s+/).filter(Boolean);
}
