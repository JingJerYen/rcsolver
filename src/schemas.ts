import { z } from "zod";
import { COLORS, FACES, MAX_SIZE, MIN_SIZE } from "./cube.js";

export const MediaTypeSchema = z.enum(["image/jpeg", "image/png", "image/webp"]);
export type MediaType = z.infer<typeof MediaTypeSchema>;

const base64 = z.string().regex(/^[A-Za-z0-9+/]+=*$/, "not base64");

export const FaceImageSchema = z.object({
  mediaType: MediaTypeSchema,
  data: base64,
});

export const RecognizeBodySchema = z.object({
  /** What the user picked, if anything; the model counts the stickers itself and its count wins. */
  size: z.number().int().min(MIN_SIZE).max(MAX_SIZE).optional(),
  faces: z.object(Object.fromEntries(FACES.map((f) => [f, FaceImageSchema])) as Record<(typeof FACES)[number], typeof FaceImageSchema>),
});
export type RecognizeBody = z.infer<typeof RecognizeBodySchema>;

/** What the model must return: the shape is fixed, row lengths are checked separately against the cube size. */
const FaceReadSchema = z.object({
  rows: z.array(z.string()).describe("N strings of N colour letters (W Y R O G B), top row first, left to right as seen in the photo"),
  confidence: z.array(z.string()).describe("N strings of N digits 0-9, one per sticker, same layout as rows; 9 = certain"),
});

export const ModelOutputSchema = z.object({
  size: z.number().int().min(MIN_SIZE).max(MAX_SIZE).describe("Stickers per row on one face: 2 for a 2×2 cube, 3 for a 3×3, up to 7"),
  U: FaceReadSchema,
  R: FaceReadSchema,
  F: FaceReadSchema,
  D: FaceReadSchema,
  L: FaceReadSchema,
  B: FaceReadSchema,
  notes: z.array(z.string()).describe("Short remarks about stickers you were unsure of, in Traditional Chinese"),
});
export type ModelOutput = z.infer<typeof ModelOutputSchema>;

const colorRow = new RegExp(`^[${COLORS.join("")}]+$`);

/** Check that every face is N×N of valid letters and digits; returns the problems found. */
export function shapeProblems(out: ModelOutput, size = out.size): string[] {
  const problems: string[] = [];
  for (const f of FACES) {
    const face = out[f];
    if (face.rows.length !== size) problems.push(`${f}: ${face.rows.length} rows, expected ${size}`);
    face.rows.forEach((row, i) => {
      if (row.length !== size) problems.push(`${f} row ${i}: ${row.length} cells, expected ${size}`);
      else if (!colorRow.test(row)) problems.push(`${f} row ${i}: bad letters "${row}"`);
    });
    if (face.confidence.length !== size) problems.push(`${f}: ${face.confidence.length} confidence rows, expected ${size}`);
    face.confidence.forEach((row, i) => {
      if (row.length !== size || !/^[0-9]+$/.test(row)) problems.push(`${f} confidence row ${i}: "${row}"`);
    });
  }
  return problems;
}
