// Ask Claude Sonnet for move sequences and check each answer on the app's cube model.
//   RCSOLVER_ANTHROPIC_KEY=… npx tsx scripts/algtest/run.ts [runs per question, default 5]
//   npx tsx scripts/algtest/run.ts --dry   checks the checkers against known-good sequences, no API calls
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { QUESTIONS } from "./questions.js";

const MODEL = "claude-sonnet-5-5";
const EFFORT = "medium" as const;

const SYSTEM = `You write Rubik's cube move sequences for a phone app. The user describes what they want (a named algorithm, or an effect on pieces they marked with a dot) and you answer with one sequence the app will play.

Notation the app reads, and nothing else:
- Faces U D F B L R, turned clockwise as seen from that face; ' is anticlockwise, 2 is a half turn.
- Rw (or r) turns the two outer layers from R together; 3Rw the three outer layers; likewise for every face.
- 2R turns only the second layer from R (an inner slice); 3R only the third. There is no M, E or S: write M as 2L, E as 2D, S as 2F (3×3).
- x y z rotate the whole cube like R, U and F.
The cube is held with U on top and F facing the user. Marked pieces are named by the faces they touch (UFR is the corner at U, F and R; UF the edge between U and F).

Give a short name of at most 2 characters for the button. If what they ask is impossible on this cube, leave moves empty and say why in one short sentence in the user's language.`;

const Answer = z.object({
  name: z.string(),
  moves: z.string(),
  error: z.string().nullable(),
});

const PRICE_IN = 2 / 1e6;
const PRICE_OUT = 10 / 1e6;

async function main() {
  const dry = process.argv.includes("--dry");
  const runs = Number(process.argv.find((a) => /^\d+$/.test(a)) ?? 5);
  if (dry) {
    for (const q of QUESTIONS) {
      if (!q.known) continue;
      const verdict = q.check(q.known, q.size);
      console.log(`${verdict === null ? "✓" : "✗"} ${q.id}: ${q.known}${verdict ? ` → ${verdict}` : ""}`);
    }
    return;
  }
  const key = process.env.RCSOLVER_ANTHROPIC_KEY;
  if (!key) throw new Error("set RCSOLVER_ANTHROPIC_KEY");
  const client = new Anthropic({ apiKey: key });
  let cost = 0;
  let ok = 0;
  let total = 0;
  for (const q of QUESTIONS) {
    console.log(`\n■ ${q.id}（${q.size}×${q.size}）${q.ask}${q.marks ? `  黑點：${q.marks.join(", ")}` : ""}`);
    for (let i = 0; i < runs; i++) {
      const started = Date.now();
      const user = `Cube: ${q.size}×${q.size}.${q.marks ? ` Marked pieces: ${q.marks.join(", ")}.` : ""}\nRequest: ${q.ask}`;
      const res = await client.messages.parse({
        model: MODEL,
        max_tokens: 16000,
        system: SYSTEM,
        messages: [{ role: "user", content: user }],
        output_config: { effort: EFFORT, format: zodOutputFormat(Answer) },
      });
      const a = res.parsed_output;
      cost += res.usage.input_tokens * PRICE_IN + res.usage.output_tokens * PRICE_OUT;
      total++;
      const secs = ((Date.now() - started) / 1000).toFixed(1);
      if (!a) {
        console.log(`  ✗ 沒有可讀的回答 (${res.stop_reason}) ${secs}s`);
        continue;
      }
      if (!a.moves.trim()) {
        const good = q.impossible === true;
        if (good) ok++;
        console.log(`  ${good ? "✓" : "✗"} 說做不到：${a.error ?? ""} ${secs}s`);
        continue;
      }
      const verdict = q.impossible ? "其實做不到，卻給了轉法" : q.check(a.moves, q.size);
      if (verdict === null) ok++;
      console.log(`  ${verdict === null ? "✓" : "✗"} [${a.name}] ${a.moves}${verdict ? `  → ${verdict}` : ""}  ${secs}s ${res.usage.output_tokens}tok`);
    }
  }
  console.log(`\n答對 ${ok}/${total}，約 US$${cost.toFixed(3)}（平均每次 US$${(cost / total).toFixed(4)}）`);
}

main().catch((e) => {
  console.error(e instanceof Anthropic.APIError ? `API ${e.status}: ${e.message}` : e);
  process.exit(1);
});
