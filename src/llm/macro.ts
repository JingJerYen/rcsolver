import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { Config } from "../config.js";
import { AppError } from "../errors.js";
import { log } from "../logger.js";
import { MacroOutputSchema, type MacroBody, type MacroOutput } from "../schemas.js";
import { MACRO_SYSTEM_PROMPT, buildMacroUserText } from "../prompts/macro.js";
import { getClient } from "./client.js";

export interface MacroOutcome extends MacroOutput {
  model: string;
  mock: boolean;
  ms: number;
}

/**
 * Ask the model for one custom sequence. The answer is passed on as it is: the page shows
 * unreadable moves in red like typed ones, and nothing checks what the moves do.
 */
export async function writeMacro(config: Config, body: MacroBody): Promise<MacroOutcome> {
  if (config.mockMode) {
    // "做不到" or "impossible" in the request exercises the page's no-sequence path
    if (/做不到|impossible/i.test(body.ask)) return { name: "", moves: "", error: "（模擬）這個做不到。", model: "mock", mock: true, ms: 0 };
    return { name: "Mk", moves: "R U R' U' R' F R2 U' R' U' R U R' F'", error: null, model: "mock", mock: true, ms: 0 };
  }

  const client = getClient(config);
  const started = Date.now();
  let response: Anthropic.Beta.BetaMessage;
  try {
    response = await client.beta.messages.create(
      {
        model: config.macroModel,
        max_tokens: 16000,
        system: MACRO_SYSTEM_PROMPT,
        messages: [{ role: "user", content: buildMacroUserText(body.size, body.ask, body.marks) }],
        output_config: { effort: config.macroEffort, format: zodOutputFormat(MacroOutputSchema) },
        // A safety decline is re-run server-side on Anthropic's recommended fallback model.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      },
      // one try within the time limit: a request the model has to think long about is not worth the wait
      { timeout: config.macroTimeoutMs, maxRetries: 0 },
    );
  } catch (err) {
    if (err instanceof Anthropic.APIConnectionTimeoutError) {
      log.warn("macro timed out", { ms: Date.now() - started, ask: body.ask });
      throw new AppError("AI_TIMEOUT", "AI 想太久了，換個說法試試。", 504);
    }
    const info = err instanceof Anthropic.APIError ? { status: err.status, message: err.message } : { message: String(err) };
    log.error("macro model call failed", info);
    throw new AppError("UPSTREAM_ERROR", "AI 服務暫時無法使用，請稍後再試。", 502, info);
  }

  const ms = Date.now() - started;
  const u = response.usage;
  log.info("macro usage", { model: response.model, input_tokens: u.input_tokens, output_tokens: u.output_tokens, stop_reason: response.stop_reason, ms });
  if (response.stop_reason === "refusal") throw new AppError("UPSTREAM_ERROR", "AI 不處理這個要求。", 502);

  const text = response.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  let out: MacroOutput;
  try {
    out = MacroOutputSchema.parse(JSON.parse(text));
  } catch (err) {
    log.warn("macro output invalid", { error: err instanceof Error ? err.message : String(err), sample: text.slice(0, 200) });
    throw new AppError("MODEL_OUTPUT_INVALID", "AI 的回答看不懂，請再試一次。", 502);
  }
  return { ...out, model: response.model, mock: false, ms };
}
