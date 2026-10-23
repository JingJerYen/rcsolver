import Anthropic from "@anthropic-ai/sdk";
import type { Config } from "../config.js";

let client: Anthropic | null = null;
let clientKey: string | undefined;

/** Lazily build the SDK client with the app-specific key (never ANTHROPIC_API_KEY). */
export function getClient(config: Config): Anthropic {
  if (!config.apiKey) {
    throw new Error("RCSOLVER_ANTHROPIC_KEY is not set; real model calls are unavailable");
  }
  if (!client || clientKey !== config.apiKey) {
    client = new Anthropic({ apiKey: config.apiKey, maxRetries: 2, timeout: 120_000 });
    clientKey = config.apiKey;
  }
  return client;
}
