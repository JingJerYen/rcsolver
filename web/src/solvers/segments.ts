/**
 * What each stretch of a solution is doing, so the page can show the stage, light up the pieces
 * being worked on and explain the strategy. Every solver reports these alongside its moves.
 */
import type { Face } from "../api.js";
import { inG1, netToFacelets } from "../cube3.js";

export type Segment =
  | { kind: "centres"; from: number; to: number; orbit: number; orbits: number; stage: number }
  | { kind: "edges"; from: number; to: number; orbit: number; orbits: number }
  | { kind: "parity"; from: number; to: number }
  | { kind: "cube3"; from: number; to: number; phase: 1 | 2 }
  | { kind: "optimal"; from: number; to: number };

const PHASE2 = new Set(["U", "U'", "U2", "D", "D'", "D2", "R2", "L2", "F2", "B2"]);

/**
 * Split a Kociemba solution into its two phases: phase 1 ends at the first point where the cube
 * is in the half-turn subgroup and every remaining move stays inside it. `net3After(k)` is the
 * (reduced) 3×3 net after k of the moves.
 */
export function cube3Segments(from: number, tokens: string[], net3After: (k: number) => Record<Face, string[]>): Segment[] {
  if (!tokens.length) return [];
  let split = tokens.length;
  for (let k = 0; k <= tokens.length; k++) {
    if (tokens.slice(k).some((t) => !PHASE2.has(t))) continue;
    const conv = netToFacelets(net3After(k));
    if (conv && inG1(conv.facelets)) {
      split = k;
      break;
    }
  }
  const out: Segment[] = [];
  if (split > 0) out.push({ kind: "cube3", from, to: from + split, phase: 1 });
  if (split < tokens.length) out.push({ kind: "cube3", from: from + split, to: from + tokens.length, phase: 2 });
  return out;
}
