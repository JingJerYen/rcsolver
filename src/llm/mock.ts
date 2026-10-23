import { COLORS, FACES, type Color, type Recognition } from "../cube.js";

/** Deterministic pseudo-random so tests are stable. */
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** A scrambled-looking cube with the right colour counts, plus a few low-confidence cells. */
export function mockRecognition(size: number, seed = 42): Recognition {
  const rand = rng(seed);
  const pool: Color[] = [];
  for (const c of COLORS) for (let i = 0; i < size * size; i++) pool.push(c);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }
  const faces = {} as Recognition["faces"];
  const confidence = {} as Recognition["confidence"];
  let k = 0;
  for (const f of FACES) {
    faces[f] = [];
    confidence[f] = [];
    for (let r = 0; r < size; r++) {
      let row = "";
      let conf = "";
      for (let c = 0; c < size; c++) {
        row += pool[k++];
        conf += rand() < 0.1 ? String(Math.floor(rand() * 6)) : "9";
      }
      faces[f].push(row);
      confidence[f].push(conf);
    }
  }
  return { faces, confidence, notes: ["[MOCK] 這是假的辨識結果，沒有呼叫模型。"] };
}
