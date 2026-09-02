import type { z } from "zod";
import type { DbModule } from "@/lib/db/common";
import type { FactValue } from "@/lib/facts/ledger";

/**
 * The compliance rule engine. This is code, not AI (this prompt) —
 * nothing under lib/rules/compliance/ imports lib/ai, and a test enforces
 * that (lib/rules/compliance/no-model-call.test.ts). CONTEXT.md rule 2
 * says the model never performs arithmetic or comparison; this module is
 * where that arithmetic actually happens, deterministically, with the
 * working shown.
 *
 * Kept separate from lib/rules/validation.ts and lib/rules/aggregate.ts,
 * which are a different job: those validate an assessor's chosen
 * compliance status and compute report header metrics. These rules
 * evaluate evidence against thresholds.
 */

/**
 * insufficient_data is a first-class result (this prompt) — it is not a
 * soft pass, it is the engine stating that it could not evaluate. Nothing
 * in this module ever maps it to "pass", and every explanation for it
 * says so in words.
 */
export type RuleOutcome = "pass" | "fail" | "insufficient_data";

/**
 * Everything a rule is allowed to read. Facts come exclusively from
 * fact_ledger_confirmed (this prompt) — the view that only returns values
 * a person has accepted or edited, so a `proposed` value physically
 * cannot reach a rule. `quantitative` is the assessor-entered numbers for
 * the item under evaluation.
 */
export interface RuleInputs {
  facts: Readonly<Record<string, FactValue>>;
  quantitative: Readonly<Record<string, unknown>>;
  /** The assessment's date — the reference point every expiry rule compares against. ISO yyyy-mm-dd. */
  assessmentDate: string;
}

export interface RuleResult {
  outcome: RuleOutcome;
  /** The working, in words: the arithmetic, the threshold, and the verdict. */
  computedExplanation: string;
  /** Which declared inputs were absent. Populated only for insufficient_data. */
  missingKeys: string[];
  /** The values actually used, stored alongside the evaluation so a report is reproducible. */
  observed: Record<string, unknown>;
}

/** What a rule declares about itself, independently of any one evaluation. */
export interface RuleSpec<TThresholds> {
  code: string;
  title: string;
  module: DbModule;
  /** Which checklist requirement (by sl_no, within `module`'s active template) this rule evaluates. */
  requirementSlNo: number;
  /** Declared fact keys, read from fact_ledger_confirmed. */
  inputFactKeys: readonly string[];
  /** Declared assessor-entered quantitative keys. */
  quantitativeKeys: readonly string[];
  defaultThresholds: TThresholds;
  /** Validates thresholds loaded from rule_definitions, which an admin can edit. */
  thresholdsSchema: z.ZodType<TThresholds>;
  legalReference: string;
  /** Human-readable template; {tokens} are filled by the rule with real values. */
  explanationTemplate: string;
  evaluate(inputs: RuleInputs, thresholds: TThresholds): RuleResult;
}

export type RunOutcome =
  | { ok: true; result: RuleResult; thresholds: unknown }
  /**
   * A stored threshold that doesn't match its rule's schema is an admin
   * configuration error, not a data problem — so it is reported loudly
   * rather than folded into insufficient_data, and no evaluation row is
   * written for it. Silently falling back to the default thresholds would
   * be worse: the evaluation would be stamped with one threshold and
   * computed with another.
   */
  | { ok: false; configError: string };

/** A rule with its thresholds validation wired in — what the registry holds and the runner calls. */
export interface CompiledRule {
  readonly code: string;
  readonly title: string;
  readonly module: DbModule;
  readonly requirementSlNo: number;
  readonly inputFactKeys: readonly string[];
  readonly quantitativeKeys: readonly string[];
  readonly defaultThresholds: unknown;
  readonly legalReference: string;
  readonly explanationTemplate: string;
  /** `thresholds` undefined means "use this rule's declared defaults". */
  run(inputs: RuleInputs, thresholds?: unknown): RunOutcome;
}

export function defineRule<TThresholds>(spec: RuleSpec<TThresholds>): CompiledRule {
  return {
    code: spec.code,
    title: spec.title,
    module: spec.module,
    requirementSlNo: spec.requirementSlNo,
    inputFactKeys: spec.inputFactKeys,
    quantitativeKeys: spec.quantitativeKeys,
    defaultThresholds: spec.defaultThresholds,
    legalReference: spec.legalReference,
    explanationTemplate: spec.explanationTemplate,
    run(inputs, thresholds) {
      if (thresholds === undefined) {
        return { ok: true, result: spec.evaluate(inputs, spec.defaultThresholds), thresholds: spec.defaultThresholds };
      }
      const parsed = spec.thresholdsSchema.safeParse(thresholds);
      if (!parsed.success) {
        const detail = parsed.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`).join("; ");
        return { ok: false, configError: `${spec.code}: stored thresholds are not valid (${detail}).` };
      }
      return { ok: true, result: spec.evaluate(inputs, parsed.data), thresholds: parsed.data };
    },
  };
}
