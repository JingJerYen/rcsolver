import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { Config } from "../config.js";
import { AppError } from "../errors.js";
import { log } from "../logger.js";
import { FACES, countWarnings, type Recognition } from "../cube.js";
import { ModelOutputSchema, shapeProblems, type RecognizeBody } from "../schemas.js";
import { RECOGNIZE_SYSTEM_PROMPT, buildRecognizeUserText } from "../prompts/recognize.js";
import { getClient } from "./client.js";
import { mockRecognition } from "./mock.js";

export interface RecognizeOutcome {
  /** Size the model counted (or the mock used). */
  size: number;
  /** Set when the user picked a size and the photos show a different one. */
  sizeMismatch: { requested: number; detected: number } | null;
  recognition: Recognition;
  warnings: string[];
  model: string;
  mock: boolean;
  ms: number;
  usage: { input_tokens: number; output_tokens: number } | null;
}

function buildContent(body: RecognizeBody): Anthropic.Beta.BetaContentBlockParam[] {
  const content: Anthropic.Beta.BetaContentBlockParam[] = [{ type: "text", text: buildRecognizeUserText(body.size) }];
  for (const f of FACES) {
    const img = body.faces[f];
    content.push({ type: "text", text: `Face ${f}:` });
    content.push({ type: "image", source: { type: "base64", media_type: img.mediaType, data: img.data } });
  }
  return content;
}

async function requestOnce(config: Config, body: RecognizeBody, attempt: number) {
  const client = getClient(config);
  const started = Date.now();
  const response = await client.beta.messages.create({
    model: config.model,
    max_tokens: config.maxTokens,
    system: RECOGNIZE_SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildContent(body) }],
    output_config: { effort: config.effort, format: zodOutputFormat(ModelOutputSchema) },
    // A safety decline is re-run server-side on Anthropic's recommended fallback model.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
  });
  const text = response.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  return { response, text, ms: Date.now() - started, attempt };
}

function describeApiError(err: unknown): Record<string, unknown> {
  if (err instanceof Anthropic.APIError) return { name: err.name, status: err.status, message: err.message };
  if (err instanceof Error) return { name: err.name, message: err.message };
  return { message: String(err) };
}

/**
 * Send the six face photos to the model and return the sticker grid. Output that does not
 * parse or has the wrong shape is retried once; API failures surface as UPSTREAM_ERROR.
 */
export async function recognizeCube(config: Config, body: RecognizeBody): Promise<RecognizeOutcome> {
  if (config.mockMode) {
    // So the page's "no cube in this photo" path can be exercised without a model: an almost
    // featureless image (a flat colour compresses to about 3 KB at 512px) counts as no cube.
    const missing = FACES.filter((f) => body.faces[f].data.length < 3500);
    if (missing.length) throw new AppError("NO_CUBE", "有幾張照片看不到方塊的面。", 422, { faces: missing });
    const size = body.size ?? 3;
    const recognition = mockRecognition(size, size * 7919);
    return { size, sizeMismatch: null, recognition, warnings: countWarnings(recognition.faces, size), model: "mock", mock: true, ms: 0, usage: null };
  }

  let lastError: string | null = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    let r: Awaited<ReturnType<typeof requestOnce>>;
    try {
      r = await requestOnce(config, body, attempt);
    } catch (err) {
      const info = describeApiError(err);
      log.error("model call failed", { attempt, ...info });
      throw new AppError("UPSTREAM_ERROR", "AI 服務暫時無法使用，請稍後再試。", 502, info);
    }

    const u = r.response.usage;
    log.info("model usage", {
      attempt,
      model: r.response.model,
      effort: config.effort,
      size_hint: body.size ?? null,
      input_tokens: u.input_tokens,
      output_tokens: u.output_tokens,
      stop_reason: r.response.stop_reason,
      ms: r.ms,
    });

    if (r.response.stop_reason === "refusal") {
      log.error("model refused", { stop_details: r.response.stop_details ?? null });
      throw new AppError("UPSTREAM_ERROR", "AI 拒絕處理這組照片，請重拍。", 502);
    }
    if (r.response.stop_reason === "max_tokens") {
      lastError = "truncated by max_tokens";
      log.warn("model output truncated", { attempt, max_tokens: config.maxTokens, output_tokens: u.output_tokens });
      continue;
    }

    try {
      const parsed = ModelOutputSchema.parse(JSON.parse(r.text));
      const problems = shapeProblems(parsed);
      if (problems.length) throw new Error(problems.join("; "));
      const { notes, size, ...faces } = parsed;
      const missing = FACES.filter((f) => !faces[f].found);
      if (missing.length) {
        log.info("no cube face in some photos", { missing });
        throw new AppError("NO_CUBE", "有幾張照片看不到方塊的面。", 422, { faces: missing });
      }
      const sizeMismatch = body.size && body.size !== size ? { requested: body.size, detected: size } : null;
      if (sizeMismatch) log.info("size differs from hint", sizeMismatch);
      const recognition: Recognition = {
        faces: Object.fromEntries(FACES.map((f) => [f, faces[f].rows])) as Recognition["faces"],
        confidence: Object.fromEntries(FACES.map((f) => [f, faces[f].confidence])) as Recognition["confidence"],
        notes,
      };
      return {
        size,
        sizeMismatch,
        recognition,
        warnings: countWarnings(recognition.faces, size),
        model: r.response.model,
        mock: false,
        ms: r.ms,
        usage: { input_tokens: u.input_tokens, output_tokens: u.output_tokens },
      };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      log.warn("model output invalid", { attempt, error: lastError, sample: r.text.slice(0, 300) });
    }
  }
  throw new AppError("MODEL_OUTPUT_INVALID", "AI 回覆的格式不正確，請再試一次。", 502, { error: lastError });
}
