import { tr } from "./i18n.js";

export type Face = "U" | "R" | "F" | "D" | "L" | "B";
export const FACES: Face[] = ["U", "R", "F", "D", "L", "B"];
export type Color = "W" | "Y" | "R" | "O" | "G" | "B";
export const COLORS: Color[] = ["W", "Y", "R", "O", "G", "B"];

export interface FaceImage {
  mediaType: "image/jpeg";
  data: string; // base64 without the data: prefix
  dataUrl: string; // for thumbnails
}

export interface Recognition {
  faces: Record<Face, string[]>;
  confidence: Record<Face, string[]>;
  notes: string[];
}

export interface RecognizeResponse {
  ok: true;
  /** Size the model counted. */
  size: number;
  sizeMismatch: { requested: number; detected: number } | null;
  recognition: Recognition;
  warnings: string[];
  model: string;
  mock: boolean;
  ms: number;
  usage: { input_tokens: number; output_tokens: number } | null;
}

export interface Health {
  ok: boolean;
  mock: boolean;
  mockReason: string | null;
  model: string;
  effort: string;
  dailyLimit: number;
  dailyUsed: number;
}

export class ApiError extends Error {
  constructor(public code: string, message: string, public status: number, public faces: Face[] = []) {
    super(message);
  }
}

async function parse<T>(res: Response): Promise<T> {
  let j: { ok?: boolean; error?: { code: string; message: string }; faces?: Face[] } & T;
  try {
    j = (await res.json()) as typeof j;
  } catch {
    throw new ApiError("BAD_RESPONSE", tr(`伺服器回應異常（${res.status}）`, `Unexpected server response (${res.status})`), res.status);
  }
  if (!res.ok || j.ok === false) throw new ApiError(j.error?.code ?? "ERROR", j.error?.message ?? tr("發生錯誤", "Something went wrong"), res.status, j.faces ?? []);
  return j;
}

export async function getHealth(): Promise<Health> {
  return parse<Health>(await fetch("/api/health"));
}

export async function recognize(size: number | null, faces: Record<Face, FaceImage>): Promise<RecognizeResponse> {
  const body = {
    size: size ?? undefined,
    faces: Object.fromEntries(FACES.map((f) => [f, { mediaType: faces[f].mediaType, data: faces[f].data }])),
  };
  return parse<RecognizeResponse>(
    await fetch("/api/recognize", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  );
}

export interface MacroResponse {
  ok: true;
  name: string;
  moves: string;
  /** Why there are no moves, in the user's language; null when there are. */
  error: string | null;
  model: string;
  mock: boolean;
  ms: number;
}

/** One custom sequence written by the model from a request in plain words. */
export async function askMacro(size: number, ask: string, marks: string[]): Promise<MacroResponse> {
  return parse<MacroResponse>(
    await fetch("/api/macro", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ size, ask, marks }) }),
  );
}
