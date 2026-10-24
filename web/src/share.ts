/**
 * Compact share tokens: `#z=<base64url>` carrying a cube and, when shared from study mode, its
 * moves and the step reached. Every link opens in study mode. Older links shared from a solve
 * carry the starting cube and the step only; the solvers are deterministic, so the receiver
 * re-solves to rebuild the cube at that step.
 *
 * Bytes: version(1) size(1) flags(1, v2 only: bit 0 = teaching solve) index(2) movesCount(2)
 * stickers(⌈6N²/3⌉, three colours per byte) moves(1 each)
 */
import type { Face } from "./api.js";
import { FACE_ORDER, parseMove } from "./cubeState.js";

const COLORS = "WYROGB";
const FACES_STR = "URFDLB";
const VERSION = 2;
const FLAG_TEACH = 1;

export interface SharePayload {
  size: number;
  faces: Record<Face, string[]>;
  index: number;
  /** Omitted when the solver reproduces the solution on its own. */
  moves?: string[];
  /** The receiver solves with the teaching method (3×3 layer by layer). */
  teach?: boolean;
}

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function unb64url(text: string): Uint8Array | null {
  try {
    const s = atob(text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (text.length % 4)) % 4));
    return Uint8Array.from(s, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

/** Move token → one byte: face·18 + depth·6 + wide·3 + turn (depth 0..2 = 1st..3rd layer); 108+ = whole-cube rotation. */
function encodeMove(token: string, size: number): number {
  const rot = /^([xyz])(['2]?)$/.exec(token);
  if (rot) return 108 + "xyz".indexOf(rot[1]!) * 3 + (rot[2] === "" ? 0 : rot[2] === "2" ? 1 : 2);
  const mv = parseMove(token, size);
  const m = /^(\d*)([URFDLBurfdlb])(w?)(['2]?)$/.exec(token)!;
  const wide = m[3] === "w" || m[2] !== m[2]!.toUpperCase();
  const num = m[1] ? Number(m[1]) : wide ? 2 : 1;
  const depth = wide ? num - 2 : num - 1; // wide: 2 layers = depth 0; inner: 2nd layer = depth 1
  const turn = mv.q === 1 ? 0 : mv.q === 2 ? 1 : 2;
  return FACES_STR.indexOf(mv.face) * 18 + depth * 6 + (wide ? 3 : 0) + turn;
}

function decodeMove(code: number): string {
  if (code >= 108) return `${"xyz"[Math.floor((code - 108) / 3)]}${["", "2", "'"][(code - 108) % 3]}`;
  const face = FACES_STR[Math.floor(code / 18)]!;
  const depth = Math.floor((code % 18) / 6);
  const wide = Math.floor((code % 6) / 3) === 1;
  const turn = ["", "2", "'"][code % 3]!;
  const num = wide ? depth + 2 : depth + 1;
  const prefix = wide ? (num === 2 ? "" : String(num)) : num === 1 ? "" : String(num);
  return `${prefix}${face}${wide ? "w" : ""}${turn}`;
}

export function encodeShare(p: SharePayload): string {
  const n = p.size;
  const stickers: number[] = [];
  for (const f of FACE_ORDER) for (const row of p.faces[f]) for (const ch of row) stickers.push(COLORS.indexOf(ch));
  const moves = p.moves ?? [];
  const bytes: number[] = [VERSION, n, p.teach ? FLAG_TEACH : 0, p.index >> 8, p.index & 255, moves.length >> 8, moves.length & 255];
  for (let i = 0; i < stickers.length; i += 3) bytes.push((stickers[i] ?? 0) + 6 * (stickers[i + 1] ?? 0) + 36 * (stickers[i + 2] ?? 0));
  for (const t of moves) bytes.push(encodeMove(t, n));
  return b64url(Uint8Array.from(bytes));
}

export function decodeShare(token: string): SharePayload | null {
  const b = unb64url(token);
  if (!b || b.length < 6 || (b[0] !== 1 && b[0] !== VERSION)) return null;
  const n = b[1]!;
  if (n < 2 || n > 7) return null;
  // version 1 had no flags byte
  const head = b[0] === 1 ? 2 : 3;
  const flags = b[0] === 1 ? 0 : b[2]!;
  const index = (b[head]! << 8) | b[head + 1]!;
  const count = (b[head + 2]! << 8) | b[head + 3]!;
  const total = 6 * n * n;
  const packed = Math.ceil(total / 3);
  const start = head + 4;
  if (b.length !== start + packed + count) return null;
  const stickers: string[] = [];
  for (let i = 0; i < packed; i++) {
    let v = b[start + i]!;
    for (let k = 0; k < 3 && stickers.length < total; k++) {
      stickers.push(COLORS[v % 6]!);
      v = Math.floor(v / 6);
    }
  }
  const faces = {} as Record<Face, string[]>;
  let idx = 0;
  for (const f of FACE_ORDER) {
    faces[f] = [];
    for (let r = 0; r < n; r++) faces[f].push(stickers.slice(idx, (idx += n)).join(""));
  }
  const moves: string[] = [];
  for (let i = 0; i < count; i++) moves.push(decodeMove(b[start + packed + i]!));
  return { size: n, faces, index, ...(count ? { moves } : {}), ...(flags & FLAG_TEACH ? { teach: true } : {}) };
}
