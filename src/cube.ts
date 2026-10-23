/** Face names in the order the API, the prompt and the net use. */
export const FACES = ["U", "R", "F", "D", "L", "B"] as const;
export type Face = (typeof FACES)[number];

/** Sticker colour letters: white, yellow, red, orange, green, blue. */
export const COLORS = ["W", "Y", "R", "O", "G", "B"] as const;
export type Color = (typeof COLORS)[number];

export const MIN_SIZE = 2;
export const MAX_SIZE = 7;

export type FaceGrid = string[]; // N rows of N colour letters

export interface Recognition {
  faces: Record<Face, FaceGrid>;
  /** Same shape as faces: one digit 0-9 per sticker, 9 = certain. */
  confidence: Record<Face, string[]>;
  notes: string[];
}

/** Count every colour letter across all six faces. */
export function colorCounts(faces: Record<Face, FaceGrid>): Record<Color, number> {
  const counts = Object.fromEntries(COLORS.map((c) => [c, 0])) as Record<Color, number>;
  for (const f of FACES) for (const row of faces[f]) for (const ch of row) counts[ch as Color]++;
  return counts;
}

/** Human-readable warnings for a recognition that cannot be a real cube as read. */
export function countWarnings(faces: Record<Face, FaceGrid>, size: number): string[] {
  const expected = size * size;
  const counts = colorCounts(faces);
  const out: string[] = [];
  for (const c of COLORS) {
    if (counts[c] !== expected) out.push(`${c} 有 ${counts[c]} 格，應該是 ${expected} 格`);
  }
  return out;
}
