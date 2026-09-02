import type { AiObservationKind } from "@/lib/db/evidence";
import type { RuleOutcome } from "@/lib/rules/compliance/types";
import { FORBIDDEN_FIELD_NAMES } from "@/lib/ai/forbidden-fields";

/**
 * The two things about an observation that the model is never allowed to
 * decide: its kind, and whether it carries a compliance status.
 *
 * The model writes the narrative and nothing else (this prompt). The kind
 * is a pure function of the rule result, computed here in code — so a
 * model that tries to upgrade its own finding from a gap to a pass has
 * nowhere to do it.
 */

/**
 * pass -> evidence_identified, fail -> requires_attention,
 * insufficient_data -> potential_gap (this prompt, verbatim).
 *
 * Note that insufficient_data becoming *potential_gap* rather than
 * evidence_identified is the same principle the rule engine already
 * holds: "we could not tell" is never "it was fine".
 */
const KIND_BY_OUTCOME: Record<RuleOutcome, AiObservationKind> = {
  pass: "evidence_identified",
  fail: "requires_attention",
  insufficient_data: "potential_gap",
};

export function kindForRuleOutcome(outcome: RuleOutcome): AiObservationKind {
  return KIND_BY_OUTCOME[outcome];
}

export interface StripResult<T> {
  value: T;
  /** Dotted paths of the keys removed, for the caller to log. Empty when the response was clean. */
  strippedPaths: string[];
}

const FORBIDDEN = new Set<string>(FORBIDDEN_FIELD_NAMES);

/**
 * Removes any status-like key from a model response, recursively, and
 * reports what it removed (this prompt: "a post-validation strips any
 * status-like key and logs it").
 *
 * Runs *before* schema validation rather than after. The response schema
 * is strict, so an unexpected key would otherwise fail the whole
 * response and lose the usable narrative with it — stripping first means
 * a model that adds `"status": "compliant"` still produces a valid
 * observation, with the offending key removed, recorded, and the kind
 * still set by code. The same vocabulary as the extraction guard
 * (lib/ai/forbidden-fields.ts): status, rating, compliant, score.
 *
 * Keys are matched, never values: a narrative sentence that happens to
 * contain the word "status" is left untouched.
 */
export function stripStatusLikeKeys<T>(value: T): StripResult<T> {
  const strippedPaths: string[] = [];
  const cleaned = walk(value, "", strippedPaths);
  return { value: cleaned as T, strippedPaths };
}

function walk(value: unknown, path: string, stripped: string[]): unknown {
  if (Array.isArray(value)) {
    return value.map((entry, index) => walk(entry, `${path}[${index}]`, stripped));
  }
  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      const childPath = path ? `${path}.${key}` : key;
      if (FORBIDDEN.has(key.toLowerCase())) {
        stripped.push(childPath);
        continue;
      }
      result[key] = walk(child, childPath, stripped);
    }
    return result;
  }
  return value;
}
