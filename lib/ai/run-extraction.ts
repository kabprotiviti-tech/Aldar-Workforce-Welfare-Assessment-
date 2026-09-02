import "server-only";
import type { CallClaudeFn } from "@/lib/ai/extract";
import { runBatch } from "@/lib/ai/queue";
import { supabaseQueueDb, supabaseFetchFile } from "@/lib/ai/queue-supabase";
import { supabaseExtractionDb } from "@/lib/ai/extract-supabase";
import { callClaudeForExtraction } from "@/lib/ai/client";

/**
 * Bridges lib/ai/queue.ts's CallClaudeFn (a generic mediaType: string, so
 * lib/ai/extract.ts stays free of the Anthropic SDK's exact literal
 * types) to lib/ai/client.ts's callClaudeForExtraction (a literal
 * "image/jpeg" | "image/png" union). Safe: the only caller of this
 * function is runExtractionBatch below, and the only producer of image
 * content is lib/ai/queue.ts's buildExtractionContent, which never emits
 * a mediaType outside that pair (IMAGE_MIME_TYPES).
 */
const callClaude: CallClaudeFn = async (input) => {
  const content =
    input.content.kind === "pdf"
      ? input.content
      : { kind: "image" as const, mediaType: input.content.mediaType as "image/jpeg" | "image/png", base64Data: input.content.base64Data };

  const result = await callClaudeForExtraction({ systemPrompt: input.systemPrompt, userText: input.userText, content });
  return { text: result.text, model: result.model, inputTokens: result.inputTokens, outputTokens: result.outputTokens, stopReason: result.stopReason };
};

/**
 * Drains one batch end to end, wiring the real Supabase/Anthropic
 * adapters into lib/ai/queue.ts's pure runBatch. Invoked from
 * next/server's after() by app/api/ai/batches's POST handler, so the HTTP
 * response returns immediately while this keeps running — "a batch of 18
 * documents extracts in the background" (this prompt).
 */
export async function runExtractionBatch(batchId: string): Promise<void> {
  await runBatch(supabaseQueueDb(), supabaseExtractionDb(), callClaude, supabaseFetchFile(), batchId);
}
