/**
 * Cost tracking (this prompt: "persist every call ... with model,
 * prompt_version, tokens and cost"). Pure — no "server-only", no env
 * access — so it's testable without a live Anthropic client, and reusable
 * anywhere cost needs computing or displaying (the UI, in particular).
 *
 * Anthropic first-party per-token rates for claude-sonnet-4-6 as of this
 * writing: $3.00 / 1M input tokens, $15.00 / 1M output tokens. Update
 * alongside lib/ai/client.ts's EXTRACTION_MODEL if the model ever changes.
 */
export const INPUT_COST_PER_MILLION_USD = 3.0;
export const OUTPUT_COST_PER_MILLION_USD = 15.0;

export function computeCostUsd(inputTokens: number, outputTokens: number): number {
  const cost = (inputTokens / 1_000_000) * INPUT_COST_PER_MILLION_USD + (outputTokens / 1_000_000) * OUTPUT_COST_PER_MILLION_USD;
  return Math.round(cost * 1_000_000) / 1_000_000;
}
