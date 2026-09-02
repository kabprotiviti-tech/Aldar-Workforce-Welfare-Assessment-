import { getRule } from "@/lib/rules/compliance/registry";
import type { RuleInputs, RuleOutcome } from "@/lib/rules/compliance/types";

/**
 * Running the rules and storing what they produced. Evaluations are
 * stored, not recomputed on read (this prompt), so a report issued today
 * still says the same thing next year even after a threshold is revised:
 * the row carries the outcome, the working, and the threshold and
 * citation it was computed against.
 *
 * Pure over an injected port, like the rest of this codebase's
 * orchestration (lib/ai/extract.ts, lib/facts/resolve.ts) — the adapter
 * is lib/rules/compliance/evaluate-supabase.ts.
 */

/** One rule definition as loaded from rule_definitions — the version an evaluation gets stamped with. */
export interface LoadedRuleDefinition {
  id: string;
  code: string;
  version: number;
  /** Null means "no override stored"; the rule's own declared defaults are used and stamped. */
  threshold: unknown;
  legalReference: string | null;
}

/** One thing to evaluate: an assessment item, its inputs, and optionally which subject (a room, a vehicle) this run is about. */
export interface EvaluationSubject {
  assessmentItemId: string;
  subjectRef: string | null;
  inputs: RuleInputs;
}

export interface StoredEvaluation {
  assessmentItemId: string;
  subjectRef: string | null;
  ruleCode: string;
  ruleDefinitionId: string;
  ruleVersion: number;
  outcome: RuleOutcome;
  computedExplanation: string;
  missingFactKeys: string[];
  inputs: RuleInputs;
  observed: Record<string, unknown>;
  thresholds: unknown;
  legalReference: string | null;
}

export interface EvaluationDb {
  /** The current (active) definition for each of `codes`. */
  loadDefinitions(codes: readonly string[]): Promise<LoadedRuleDefinition[]>;
  /** Appends evaluations. Never updates: a re-run is a new row (0006_rules_measurement.sql). */
  storeEvaluations(evaluations: StoredEvaluation[]): Promise<number>;
}

export interface EvaluationRun {
  stored: StoredEvaluation[];
  /**
   * Rules that could not be run at all: no active definition, or stored
   * thresholds that don't match the rule's schema. Reported rather than
   * stored — an unrunnable rule has no outcome, and inventing
   * insufficient_data for it would hide an admin configuration error
   * behind a data-shaped one.
   */
  problems: { ruleCode: string; problem: string }[];
}

/**
 * Evaluates `ruleCodes` against each subject and returns what should be
 * stored. Nothing is written here; the caller stores the batch, so one
 * run is one append.
 */
export async function evaluateSubjects(
  db: EvaluationDb,
  ruleCodes: readonly string[],
  subjects: readonly EvaluationSubject[],
): Promise<EvaluationRun> {
  const definitions = await db.loadDefinitions(ruleCodes);
  const byCode = new Map(definitions.map((definition) => [definition.code, definition]));

  const stored: StoredEvaluation[] = [];
  const problems: { ruleCode: string; problem: string }[] = [];

  for (const code of ruleCodes) {
    const rule = getRule(code);
    if (!rule) {
      problems.push({ ruleCode: code, problem: `No rule is implemented for code "${code}".` });
      continue;
    }

    const definition = byCode.get(code);
    if (!definition) {
      problems.push({ ruleCode: code, problem: `No active rule_definitions row for "${code}".` });
      continue;
    }

    for (const subject of subjects) {
      // A null stored threshold means "use the rule's declared
      // defaults" — and run() reports back whichever it used, so the
      // stamped value is always the one the arithmetic ran on.
      const outcome = rule.run(subject.inputs, definition.threshold ?? undefined);
      if (!outcome.ok) {
        problems.push({ ruleCode: code, problem: outcome.configError });
        break;
      }

      stored.push({
        assessmentItemId: subject.assessmentItemId,
        subjectRef: subject.subjectRef,
        ruleCode: code,
        ruleDefinitionId: definition.id,
        ruleVersion: definition.version,
        outcome: outcome.result.outcome,
        computedExplanation: outcome.result.computedExplanation,
        missingFactKeys: outcome.result.missingKeys,
        inputs: subject.inputs,
        observed: outcome.result.observed,
        thresholds: outcome.thresholds,
        legalReference: definition.legalReference ?? rule.legalReference,
      });
    }
  }

  return { stored, problems };
}

export interface RunAndStoreResult extends EvaluationRun {
  storedCount: number;
}

export async function runAndStore(
  db: EvaluationDb,
  ruleCodes: readonly string[],
  subjects: readonly EvaluationSubject[],
): Promise<RunAndStoreResult> {
  const run = await evaluateSubjects(db, ruleCodes, subjects);
  const storedCount = run.stored.length > 0 ? await db.storeEvaluations(run.stored) : 0;
  return { ...run, storedCount };
}

export interface OutcomeTally {
  pass: number;
  fail: number;
  insufficient_data: number;
}

/**
 * Counts outcomes for a summary. insufficient_data is counted on its own
 * and never folded into either other bucket — the whole reason it exists
 * as a result is that "we could not tell" is not "it was fine".
 */
export function tallyOutcomes(evaluations: readonly { outcome: RuleOutcome }[]): OutcomeTally {
  const tally: OutcomeTally = { pass: 0, fail: 0, insufficient_data: 0 };
  for (const evaluation of evaluations) {
    tally[evaluation.outcome] += 1;
  }
  return tally;
}
