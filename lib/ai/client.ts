import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { serverEnv } from "@/lib/env/server";
import { EXTRACTION_MODEL, MAX_OUTPUT_TOKENS } from "@/lib/ai/model";

export { EXTRACTION_MODEL, MAX_OUTPUT_TOKENS };

// Generous for a single-document vision request but still short enough
// to fail fast inside a background batch (lib/ai/queue.ts) rather than
// let one stuck call hold up the whole queue indefinitely.
const REQUEST_TIMEOUT_MS = 120_000;

// The SDK's own retry logic (not a hand-rolled loop — see docs/decisions.md)
// backs off with jitter on 408/409/429/5xx and connection errors. 4 gives
// a call ~5 attempts total before giving up, appropriate for a background
// batch where a slower final success still beats a failed document.
const MAX_RETRIES = 4;

let cachedClient: Anthropic | null = null;

function getClient(): Anthropic {
  if (!cachedClient) {
    cachedClient = new Anthropic({
      apiKey: serverEnv.ANTHROPIC_API_KEY,
      timeout: REQUEST_TIMEOUT_MS,
      maxRetries: MAX_RETRIES,
    });
  }
  return cachedClient;
}

/**
 * Send PDFs as document blocks and images as image blocks (this prompt) —
 * both are read visually by the model, never through a text-extraction
 * pass this app performs itself (CONTEXT.md/this prompt: some source
 * reports have broken font encoding that makes text-layer extraction
 * return garbage). image mediaType is restricted to what
 * lib/evidence/upload-validation.ts actually accepts (jpg/jpeg -> the
 * same "image/jpeg", or png).
 */
export type ExtractionContent =
  | { kind: "pdf"; base64Data: string }
  | { kind: "image"; mediaType: "image/jpeg" | "image/png"; base64Data: string };

export interface CallClaudeForExtractionInput {
  systemPrompt: string;
  userText: string;
  content: ExtractionContent;
}

export interface CallClaudeForExtractionResult {
  text: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  stopReason: Anthropic.StopReason | null;
}

export async function callClaudeForExtraction(input: CallClaudeForExtractionInput): Promise<CallClaudeForExtractionResult> {
  const client = getClient();

  const fileBlock: Anthropic.DocumentBlockParam | Anthropic.ImageBlockParam =
    input.content.kind === "pdf"
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: input.content.base64Data } }
      : { type: "image", source: { type: "base64", media_type: input.content.mediaType, data: input.content.base64Data } };

  const response = await client.messages.create({
    model: EXTRACTION_MODEL,
    max_tokens: MAX_OUTPUT_TOKENS,
    system: input.systemPrompt,
    messages: [
      {
        role: "user",
        content: [fileBlock, { type: "text", text: input.userText }],
      },
    ],
  });

  const textBlock = response.content.find((block): block is Anthropic.TextBlock => block.type === "text");

  return {
    text: textBlock?.text ?? "",
    model: response.model,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    stopReason: response.stop_reason,
  };
}

// Cost computation (computeCostUsd) lives in lib/ai/cost.ts — pure, no
// "server-only", so it stays importable from a plain Vitest test and from
// client-side UI code without dragging in this module's Anthropic client
// construction or env validation.
export { computeCostUsd } from "@/lib/ai/cost";
