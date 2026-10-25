// Checks a move sequence against an expected effect, using the app's own cube model.
import { applyAlgorithm, fromNet, isSolved, parseMove, toNet, unrotate, type Sticker, type Vec } from "../../web/src/cubeState.js";
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

/** Which pieces moved, as from → to cubie positions (rotations removed first). */
function movedPieces(text: string, size: number) {
  const mv = movesOf(text, size);
  if (!mv) return null;
  const before = solved(size);
  const after = applyAlgorithm(before, mv);
  const moved = new Map<string, Vec>();
  before.forEach((s, i) => {
    if (!eq(after[i]!.p, s.p) || !eq(after[i]!.n, s.n)) moved.set(s.p.join(","), after[i]!.p);
  });
  return [...moved].map(([k, to]) => ({ from: k.split(",").map(Number) as Vec, to }));
}

/**
 * Exactly three pieces of one kind move, each to another's place (a 3-cycle), and nothing else
 * moves. `where` says which pieces count: corners, or edges of the middle layer.
 */
export function threeCycle(kind: "corner" | "middle-edge") {
  return (text: string, size: number): string | null => {
    const moved = movedPieces(text, size);
    if (!moved) return "看不懂的記號";
    const h = size - 1;
    const ok = (p: Vec) =>
      kind === "corner" ? p.every((v) => Math.abs(v) === h) : p[1] === 0 && Math.abs(p[0]) === h && Math.abs(p[2]) === h;
    const wrongKind = moved.filter((m) => !ok(m.from)).length;
    if (wrongKind) return `另外動到 ${wrongKind} 個其他的塊`;
    if (moved.length !== 3) return `動到 ${moved.length} 個${kind === "corner" ? "角" : "中層邊"}，不是 3 個`;
    const stays = moved.filter((m) => eq(m.from, m.to)).length;
    if (stays) return "有塊只是原地翻轉，沒有輪換";
    return null;
  };
}

/** After the moves, starting from `start` (a scramble), the D face is all yellow. */
export function downAllYellow(start: string) {
  return (text: string, size: number): string | null => {
    const mv = movesOf(text, size);
    if (!mv) return "看不懂的記號";
    const scrambled = applyAlgorithm(solved(size), movesOf(start, size)!);
    const after = applyAlgorithm(scrambled, mv);
    const down = after.filter((s) => s.n[1] === -1);
    const yellow = down.filter((s) => s.c === "Y").length;
    return yellow === down.length ? null : `底面只有 ${yellow}/${down.length} 格是黃色`;
  };
}

/** The six faces after `start`, as rows of colour letters, for the prompt. */
export function netAfter(start: string, size: number): string {
  const net = toNet(size, applyAlgorithm(solved(size), movesOf(start, size)!));
  return Object.entries(net)
    .map(([f, rows]) => `${f}: ${rows.join(" / ")}`)
    .join("\n");
}
