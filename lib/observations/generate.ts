import { observationResponseSchema, promptVersion, systemPrompt } from "@/lib/ai/prompts/observations/v1";
import { kindForRuleOutcome, stripStatusLikeKeys } from "@/lib/observations/kinds";
import { getRule } from "@/lib/rules/compliance/registry";
import type { AiObservationKind } from "@/lib/db/evidence";
import type { FactValue } from "@/lib/facts/ledger";
import type { RuleOutcome } from "@/lib/rules/compliance/types";

/**
 * The observation generator: the layer between facts, rules and the
 * assessor (this prompt). The model writes the narrative; everything that
 * could affect a compliance judgement is decided here in code.
 *
 * Pure over injected ports, no "server-only" — the adapter is
 * lib/observations/generate-supabase.ts. What that buys is the ability to
 * prove, without a network or a database, that the generator cannot emit
 * a status, cannot pick its own kind, and cannot keep an observation with
 * no source.
 */

/** One confirmed fact available to the narrative, with the provenance an observation must cite. */
export interface ObservationFact {
  factKey: string;
  value: FactValue;
  unit: string | null;
  pageRef: string | null;
  verbatimQuote: string | null;
  evidenceFileId: string;
}

/** One stored rule result the narrative is written about. Its outcome — not the model — decides the observation's kind. */
export interface ObservationRuleResult {
  ruleEvaluationId: string;
  ruleCode: string;
  outcome: RuleOutcome;
  computedExplanation: string;
  legalReference: string | null;
}

/** A finding raised for this entity and requirement in the previous cycle, for continuity. */
export interface PreviousFinding {
  title: string;
  priority: string;
  status: string;
  cycleName: string | null;
}

export interface ObservationInputs {
  assessmentItemId: string;
  requirementId: string;
  requirementSlNo: number;
  requirementTitle: string;
  /** The clause text an assessor reads. Null where the client hasn't supplied it yet (0010_seed_checklist_templates_v1.sql). */
  requirementDetailText: string | null;
  facts: ObservationFact[];
  ruleResults: ObservationRuleResult[];
  previousFindings: PreviousFinding[];
}

export interface GeneratedObservation {
  assessmentItemId: string;
  requirementId: string;
  /** Set by kindForRuleOutcome, never by the model. */
  kind: AiObservationKind;
  title: string;
  body: string;
  ruleCode: string;
  ruleEvaluationId: string;
  /** Validated against the facts actually supplied — a key the model invented is dropped. */
  sourceFactKeys: string[];
  pageRef: string | null;
  evidenceFileId: string | null;
  promptVersion: string;
  model: string;
}

export interface DiscardedObservation {
  ruleCode: string | null;
  reason: string;
}

export interface GenerationResult {
  observations: GeneratedObservation[];
  /** Observations the generator refused to keep, and why. Surfaced rather than swallowed. */
  discarded: DiscardedObservation[];
  /** Status-like keys the model tried to return, for the caller to log (this prompt). */
  strippedStatusKeys: string[];
  /** Set when the response could not be used at all. */
  error: string | null;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export interface CallNarrativeResult {
  text: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export type CallNarrativeFn = (input: { systemPrompt: string; userText: string }) => Promise<CallNarrativeResult>;

function stripCodeFence(raw: string): string {
  const trimmed = raw.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return fenced ? fenced[1]!.trim() : trimmed;
}

/**
 * The request body. Facts are given with their provenance so the model
 * can only cite a source that exists, and each rule result is given with
 * its computed working so the model has nothing left to calculate.
 *
 * The outcome word (pass/fail/insufficient_data) is deliberately NOT
 * sent: the model doesn't need it to describe what the working says, and
 * withholding it removes the temptation to editorialise about a verdict.
 * Code maps the outcome to the kind separately.
 */
export function buildUserText(inputs: ObservationInputs): string {
  const lines: string[] = [];

  lines.push(`Requirement ${inputs.requirementSlNo}: ${inputs.requirementTitle}`);
  lines.push(inputs.requirementDetailText ? `Clause detail: ${inputs.requirementDetailText}` : "Clause detail: not supplied.");
  lines.push("");

  lines.push("Confirmed facts (each has been reviewed and confirmed by an assessor):");
  if (inputs.facts.length === 0) {
    lines.push("- none");
  } else {
    for (const fact of inputs.facts) {
      const value = Array.isArray(fact.value) ? fact.value.join(", ") : String(fact.value);
      const unit = fact.unit ? ` ${fact.unit}` : "";
      const page = fact.pageRef ? `, ${fact.pageRef}` : "";
      const quote = fact.verbatimQuote ? `, quoted as "${fact.verbatimQuote}"` : "";
      lines.push(`- ${fact.factKey}: ${value}${unit}${page}${quote}`);
    }
  }
  lines.push("");

  lines.push("Rule results, with the working already computed:");
  for (const result of inputs.ruleResults) {
    lines.push(`- ${result.ruleCode}: ${result.computedExplanation}${result.legalReference ? ` [${result.legalReference}]` : ""}`);
  }
  lines.push("");

  lines.push("Findings raised for this requirement in the previous cycle:");
  if (inputs.previousFindings.length === 0) {
    lines.push("- none");
  } else {
    for (const finding of inputs.previousFindings) {
      lines.push(`- ${finding.title} (priority ${finding.priority}, currently ${finding.status}${finding.cycleName ? `, ${finding.cycleName}` : ""})`);
    }
  }
  lines.push("");
  lines.push(`Write one observation for each of these ${inputs.ruleResults.length} rule result(s). Return JSON only.`);

  return lines.join("\n");
}

/**
 * Generates the observations for one assessment item. Never throws: a
 * malformed or hostile response produces an error and no observations,
 * the same posture as the extraction service.
 */
export async function generateObservations(callNarrative: CallNarrativeFn, inputs: ObservationInputs): Promise<GenerationResult> {
  const empty = { observations: [], discarded: [], strippedStatusKeys: [], model: "", inputTokens: 0, outputTokens: 0 };

  if (inputs.ruleResults.length === 0) {
    // Every observation's kind derives from a rule result (this prompt),
    // so with no rule results there is nothing this generator can
    // legitimately produce. Saying so beats inventing a narrative whose
    // kind nothing determines.
    return { ...empty, error: "No rule results for this requirement, so no observation can be generated." };
  }

  let call: CallNarrativeResult;
  try {
    call = await callNarrative({ systemPrompt, userText: buildUserText(inputs) });
  } catch (err) {
    return { ...empty, error: err instanceof Error ? err.message : String(err) };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCodeFence(call.text));
  } catch (err) {
    return {
      ...empty,
      model: call.model,
      inputTokens: call.inputTokens,
      outputTokens: call.outputTokens,
      error: `The model's response was not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // Strip first, then validate: the schema is strict, so a status key
  // left in place would fail the whole response and throw away the
  // usable narrative with it.
  const { value: cleaned, strippedPaths } = stripStatusLikeKeys(parsed);

  const validated = observationResponseSchema.safeParse(cleaned);
  if (!validated.success) {
    return {
      ...empty,
      strippedStatusKeys: strippedPaths,
      model: call.model,
      inputTokens: call.inputTokens,
      outputTokens: call.outputTokens,
      error: `The model's response did not match the expected shape: ${validated.error.issues
        .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
        .join("; ")}`,
    };
  }

  const factByKey = new Map(inputs.facts.map((fact) => [fact.factKey, fact]));
  const resultByCode = new Map(inputs.ruleResults.map((result) => [result.ruleCode, result]));

  const observations: GeneratedObservation[] = [];
  const discarded: DiscardedObservation[] = [];

  for (const narrative of validated.data.observations) {
    const ruleResult = resultByCode.get(narrative.rule_code);
    if (!ruleResult) {
      discarded.push({ ruleCode: narrative.rule_code, reason: "Names a rule result that was not part of the request." });
      continue;
    }

    // Source references are checked against the facts actually supplied.
    // A model-invented fact key is not a source, and citing one is
    // exactly how a plausible-looking observation gets untethered from
    // the evidence.
    const sourceFactKeys = narrative.source_fact_keys.filter((key) => factByKey.has(key));
    const sourceFacts = sourceFactKeys.map((key) => factByKey.get(key)!);

    const pageRef = narrative.page_ref ?? sourceFacts.find((fact) => fact.pageRef)?.pageRef ?? null;
    const evidenceFileId = sourceFacts[0]?.evidenceFileId ?? null;

    /**
     * "An observation with no source reference is discarded" (this
     * prompt). A cited fact key or an evidence file is a source
     * reference. So is the rule evaluation itself — but only for a rule
     * that reads no facts at all (R16_HOURS and ACM_TOILET_RATIO
     * evaluate assessor-entered figures, so there is no fact key in
     * existence for their observations to cite, and the traceable origin
     * is the stored evaluation and its working). A rule that *does* read
     * facts must have one cited: that is precisely the case where a
     * plausible-sounding narrative gets untethered from the evidence.
     * An unrecognised rule code has to produce a real fact or file
     * source. See docs/decisions.md.
     */
    const rule = getRule(ruleResult.ruleCode);
    const ruleReadsFacts = rule ? rule.inputFactKeys.length > 0 : true;
    if (sourceFactKeys.length === 0 && evidenceFileId === null && ruleReadsFacts) {
      discarded.push({
        ruleCode: narrative.rule_code,
        reason: "No source reference: cited no supplied fact key and no evidence file.",
      });
      continue;
    }

    observations.push({
      assessmentItemId: inputs.assessmentItemId,
      requirementId: inputs.requirementId,
      kind: kindForRuleOutcome(ruleResult.outcome),
      title: narrative.title.trim(),
      body: narrative.body.trim(),
      ruleCode: ruleResult.ruleCode,
      ruleEvaluationId: ruleResult.ruleEvaluationId,
      sourceFactKeys,
      pageRef,
      evidenceFileId,
      promptVersion,
      model: call.model,
    });
  }

  return {
    observations,
    discarded,
    strippedStatusKeys: strippedPaths,
    error: null,
    model: call.model,
    inputTokens: call.inputTokens,
    outputTokens: call.outputTokens,
  };
}
