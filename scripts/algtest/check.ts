// Checks a move sequence against an expected effect, using the app's own cube model.
import { applyAlgorithm, fromNet, isSolved, parseMove, unrotate, type Sticker, type Vec } from "../../web/src/cubeState.js";
import { tokenize } from "../../web/src/study.js";

export function solved(size: number): Sticker[] {
  const faces = { U: "W", R: "R", F: "G", D: "Y", L: "O", B: "B" } as const;
  const net = Object.fromEntries(Object.entries(faces).map(([f, c]) => [f, Array.from({ length: size }, () => c.repeat(size))]));
  return fromNet(size, net as never);
}

/** Tokens → moves; null when a token is not valid notation for this size. */
export function movesOf(text: string, size: number) {
  try {
    return unrotate(tokenize(text), size).map((t) => parseMove(t, size));
  } catch {
    return null;
  }
}

const invert = (text: string) =>
  tokenize(text)
    .reverse()
    .map((t) => (t.endsWith("'") ? t.slice(0, -1) : t.endsWith("2") ? t : `${t}'`))
    .join(" ");

/** Same effect as `ref`, allowing a U turn before and after (the usual AUF freedom of last-layer algorithms). */
export function sameAs(ref: string, opts: { auf?: boolean } = {}) {
  const aufs = opts.auf === false ? [""] : ["", "U", "U2", "U'"];
  return (text: string, size: number): string | null => {
    const mv = movesOf(text, size);
    if (!mv) return "看不懂的記號";
    for (const a of aufs)
      for (const b of aufs) {
        const back = movesOf(`${b ? invert(b) : ""} ${invert(ref)} ${a ? invert(a) : ""}`, size)!;
        if (isSolved(applyAlgorithm(applyAlgorithm(solved(size), mv), back))) return null;
      }
    return "效果不同";
  };
}

/** Named pieces of an n×n cube: corners like "UFR", edges like "UF" (3×3), centres like "U". */
export function piece(name: string, size: number): Vec {
  const h = size - 1;
  const p: Vec = [0, 0, 0];
  for (const ch of name) {
    if (ch === "R") p[0] = h;
    if (ch === "L") p[0] = -h;
    if (ch === "U") p[1] = h;
    if (ch === "D") p[1] = -h;
    if (ch === "F") p[2] = h;
    if (ch === "B") p[2] = -h;
  }
  return p;
}

const eq = (a: Vec, b: Vec) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

/**
 * Pieces go where `moves` says ([from, to] pairs, by name) and every other piece stays exactly
 * where it was (same orientation). Moved pieces are checked by position only.
 */
export function effect(moves: [string, string][]) {
  return (text: string, size: number): string | null => {
    const mv = movesOf(text, size);
    if (!mv) return "看不懂的記號";
    const before = solved(size);
    const after = applyAlgorithm(before, mv);
    const targets = moves.map(([a, b]) => [piece(a, size), piece(b, size)] as const);
    const problems: string[] = [];
    let stray = 0;
    before.forEach((s, i) => {
      const t = targets.find(([a]) => eq(a, s.p));
      if (!t) {
        if (!eq(after[i]!.p, s.p) || !eq(after[i]!.n, s.n)) stray++;
        return;
      }
      if (!eq(after[i]!.p, t[1])) problems.push("黑點的塊沒到該去的位置");
    });
    if (stray) problems.push(`另外動到 ${stray} 張貼紙`);
    return problems.length ? [...new Set(problems)].join("；") : null;
  };
}
