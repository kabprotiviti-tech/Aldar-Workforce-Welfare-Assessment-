import type { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";
import { getPromptDefinition } from "@/lib/ai/prompts/registry";
import { findForbiddenField } from "@/lib/ai/forbidden-fields";
import { computeCostUsd } from "@/lib/ai/cost";
import { EXTRACTION_MODEL } from "@/lib/ai/model";
import type { ExtractedFact } from "@/lib/ai/schema";

/**
 * The document extraction orchestrator (this prompt). Deliberately free
 * of "server-only" and any Supabase/Anthropic client construction — both
 * the database access (ExtractionDb) and the model call (CallClaudeFn)
 * are injected, the same ports-and-adapters split as
 * lib/scheduling/generate-cycle.ts and lib/rfi/portal.ts. That's what
 * lets lib/ai/extract.test.ts exercise the real parsing, validation, and
 * fact fan-out logic — including the "malformed response never crashes"
 * and "three fixtures produce the expected fact keys" acceptance
 * criteria — deterministically, with no network access and no live
 * ANTHROPIC_API_KEY. The real adapters live in lib/ai/extract-supabase.ts
 * and lib/ai/client.ts. See docs/decisions.md.
 */

export type ExtractionContentLike = { kind: "pdf"; base64Data: string } | { kind: "image"; mediaType: string; base64Data: string };

export interface CallClaudeResultLike {
  text: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  stopReason?: Anthropic.StopReason | null;
}

export type CallClaudeFn = (input: {
  systemPrompt: string;
  userText: string;
  content: ExtractionContentLike;
}) => Promise<CallClaudeResultLike>;

export interface FactInsert {
  factKey: string;
  valueText: string | null;
  valueNumber: number | null;
  valueDate: string | null;
  valueBoolean: boolean | null;
  valueJson: unknown | null;
  unit: string | null;
  pageRef: string | null;
  verbatimQuote: string | null;
  confidence: "high" | "medium" | "low";
  reason: "not_present" | "illegible" | null;
}

export interface InsertExtractionInput {
  evidenceFileId: string;
  model: string;
  promptVersion: string;
  rawResponse: unknown;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  error: string | null;
}

export interface ExtractionDb {
  insertExtraction(input: InsertExtractionInput): Promise<{ extractionId: string }>;
  insertFacts(input: { extractionId: string; evidenceFileId: string; facts: FactInsert[] }): Promise<number>;
}

export interface ExtractDocumentInput {
  evidenceFileId: string;
  documentClass: string | null;
  content: ExtractionContentLike;
}

export type ExtractDocumentResult =
  | { outcome: "skipped"; reason: string }
  | { outcome: "succeeded"; extractionId: string; factCount: number; costUsd: number }
  | { outcome: "failed"; extractionId: string; error: string };

const EXTRACTION_USER_TEXT = "Extract the facts listed in your instructions from this document.";

function stripCodeFence(raw: string): string {
  const trimmed = raw.trim();
  const fenceMatch = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return fenceMatch ? fenceMatch[1]!.trim() : trimmed;
}

export type JsonParseResult = { ok: true; json: unknown } | { ok: false; error: string };

/** A malformed model response never crashes the request (this prompt) — this never throws. */
export function tryParseModelJson(rawText: string): JsonParseResult {
  const jsonText = stripCodeFence(rawText);
  try {
    return { ok: true, json: JSON.parse(jsonText) };
  } catch (err) {
    return { ok: false, error: `The model's response was not valid JSON: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/** Which typed value_* column a fact's generic value belongs in (lib/db/evidence.ts's extracted_facts shape). */
export function factToInsert(fact: ExtractedFact): FactInsert {
  const base: FactInsert = {
    factKey: fact.fact_key,
    unit: fact.unit,
    pageRef: fact.page_ref,
    verbatimQuote: fact.verbatim_quote,
    confidence: fact.confidence,
    reason: fact.reason,
    valueText: null,
    valueNumber: null,
    valueDate: null,
    valueBoolean: null,
    valueJson: null,
  };

  const value = fact.value;
  if (value === null) return base;
  if (typeof value === "boolean") return { ...base, valueBoolean: value };
  if (typeof value === "number") return { ...base, valueNumber: value };
  if (Array.isArray(value)) return { ...base, valueJson: value };
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return { ...base, valueDate: value };
  return { ...base, valueText: value };
}

export async function extractDocument(db: ExtractionDb, callClaude: CallClaudeFn, input: ExtractDocumentInput): Promise<ExtractDocumentResult> {
  const prompt = getPromptDefinition(input.documentClass);
  if (!prompt) {
    return {
      outcome: "skipped",
      reason: `No extraction prompt is registered for document class "${input.documentClass ?? "(none)"}" yet.`,
    };
  }

  let callResult: CallClaudeResultLike;
  try {
    callResult = await callClaude({ systemPrompt: prompt.systemPrompt, userText: EXTRACTION_USER_TEXT, content: input.content });
  } catch (err) {
    // The API call itself failed (even after the SDK's own retries) —
    // persisted as a failed extraction rather than thrown, so a batch
    // (lib/ai/queue.ts) can record it and move on to the next document.
    const message = err instanceof Error ? err.message : String(err);
    const { extractionId } = await db.insertExtraction({
      evidenceFileId: input.evidenceFileId,
      model: EXTRACTION_MODEL,
      promptVersion: prompt.version,
      rawResponse: null,
      inputTokens: null,
      outputTokens: null,
      costUsd: null,
      error: message,
    });
    return { outcome: "failed", extractionId, error: message };
  }

  const costUsd = computeCostUsd(callResult.inputTokens, callResult.outputTokens);
  const parsed = tryParseModelJson(callResult.text);

  if (!parsed.ok) {
    const { extractionId } = await db.insertExtraction({
      evidenceFileId: input.evidenceFileId,
      model: callResult.model,
      promptVersion: prompt.version,
      rawResponse: { raw_text: callResult.text },
      inputTokens: callResult.inputTokens,
      outputTokens: callResult.outputTokens,
      costUsd,
      error: parsed.error,
    });
    return { outcome: "failed", extractionId, error: parsed.error };
  }

  const forbiddenField = findForbiddenField(parsed.json);
  if (forbiddenField) {
    const error = `The model's response included a forbidden field: "${forbiddenField}".`;
    const { extractionId } = await db.insertExtraction({
      evidenceFileId: input.evidenceFileId,
      model: callResult.model,
      promptVersion: prompt.version,
      rawResponse: parsed.json,
      inputTokens: callResult.inputTokens,
      outputTokens: callResult.outputTokens,
      costUsd,
      error,
    });
    return { outcome: "failed", extractionId, error };
  }

  const validated = (prompt.responseSchema as z.ZodTypeAny).safeParse(parsed.json);
  if (!validated.success) {
    const error = `The model's response did not match the expected shape: ${validated.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ")}`;
    const { extractionId } = await db.insertExtraction({
      evidenceFileId: input.evidenceFileId,
      model: callResult.model,
      promptVersion: prompt.version,
      rawResponse: parsed.json,
      inputTokens: callResult.inputTokens,
      outputTokens: callResult.outputTokens,
      costUsd,
      error,
    });
    return { outcome: "failed", extractionId, error };
  }

  const data = validated.data as { facts: ExtractedFact[] };

  const { extractionId } = await db.insertExtraction({
    evidenceFileId: input.evidenceFileId,
    model: callResult.model,
    promptVersion: prompt.version,
    rawResponse: data,
    inputTokens: callResult.inputTokens,
    outputTokens: callResult.outputTokens,
    costUsd,
    error: null,
  });

  const factCount = await db.insertFacts({
    extractionId,
    evidenceFileId: input.evidenceFileId,
    facts: data.facts.map(factToInsert),
  });

  return { outcome: "succeeded", extractionId, factCount, costUsd };
}
