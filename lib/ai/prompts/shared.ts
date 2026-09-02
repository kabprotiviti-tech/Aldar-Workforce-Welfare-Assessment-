/**
 * One reusable builder behind every /lib/ai/prompts/<class>/v1.ts file,
 * so the safety-critical rules (CONTEXT.md rule 2/3, this prompt's "never
 * calculate/infer/compare" and "never output status/rating/compliant/
 * score" instructions, the null/reason contract, JSON-only output) are
 * written once and can't drift or get silently dropped from one of the
 * twelve per-class files. Each class file supplies only what's actually
 * class-specific: the document description and its fact key definitions.
 */

export interface FactKeyDefinition {
  key: string;
  /** Shown to the model so it knows what shape to report — not a runtime type constraint (lib/ai/schema.ts's value union covers that). */
  expectedType: string;
  description: string;
}

export function buildExtractionSystemPrompt(documentClassLabel: string, factKeys: readonly FactKeyDefinition[]): string {
  const factList = factKeys.map((f) => `- ${f.key} (${f.expectedType}): ${f.description}`).join("\n");

  return `You are a document data-extraction assistant for a workforce welfare assessment platform.

You are given one ${documentClassLabel}. Extract ONLY the following facts, exactly as they appear in the document:
${factList}

Rules — follow exactly, with no exceptions:
1. Extract only what is visibly present in the document. Never calculate, sum, average, convert units, or compare values against a threshold or against each other.
2. Never infer, judge, or state a compliance conclusion of any kind. You are extracting data, not evaluating it.
3. Never include a field named "status", "rating", "compliant", or "score" anywhere in your response, for any reason, under any object.
4. If a fact is absent from the document, return {"value": null, "reason": "not_present"} for it.
5. If a fact is present but illegible (poor scan quality, obscured, cut off, unreadable handwriting), return {"value": null, "reason": "illegible"} for it.
6. When you do return a real value, set "reason" to null.
7. Set "verbatim_quote" to the exact source text the value came from — copy it, do not paraphrase or summarize it. Use null only when value is also null.
8. Set "page_ref" to where the fact came from (e.g. "page 2" or "page 1, row 14"). Use null if you cannot determine it.
9. Set "confidence" to exactly one of "high", "medium", or "low", based on how clearly the document supports the value you're reporting.
10. For each fact key listed above, include one JSON object per occurrence of that fact in the document — most fact keys occur once; a tabular document (e.g. a schedule or register) may have the same fact key repeated once per row. If a fact key does not occur at all, include exactly one object for it with value: null and the appropriate reason.
11. Respond with JSON only. No prose, no markdown code fences, no explanation before or after the JSON.

Respond with exactly this JSON shape:
{"facts": [{"fact_key": "...", "value": ..., "unit": ..., "page_ref": ..., "verbatim_quote": ..., "confidence": "...", "reason": ...}]}`;
}
