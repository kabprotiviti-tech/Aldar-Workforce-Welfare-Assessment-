import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { EvaluationDb, EvaluationSubject, LoadedRuleDefinition, StoredEvaluation } from "@/lib/rules/compliance/evaluate";
import type { FactValue } from "@/lib/facts/ledger";

/**
 * The rule engine's data access. Note where the facts come from:
 * public.fact_ledger_confirmed, never extracted_facts. That's this
 * prompt's "input comes exclusively from fact_ledger_confirmed" —
 * enforced by the view itself, which returns only values a person
 * accepted or edited (0021_fact_ledger.sql), so a proposed value cannot
 * reach a rule even if this query were wrong.
 *
 * Session-scoped client throughout: rule_definitions and
 * rule_evaluations already grant select to `authenticated` under
 * staff-only policies, and insert to can_write_operational()
 * (0006_rules_measurement.sql), so RLS is doing the authorization.
 */
export function supabaseEvaluationDb(supabase: SupabaseClient): EvaluationDb {
  return {
    async loadDefinitions(codes): Promise<LoadedRuleDefinition[]> {
      if (codes.length === 0) return [];
      const { data, error } = await supabase
        .from("rule_definitions")
        .select("id, code, version, threshold, legal_reference")
        .in("code", codes)
        .eq("active", true)
        .is("deleted_at", null);
      if (error) throw error;
      return (data ?? []).map((row) => ({
        id: row.id as string,
        code: row.code as string,
        version: row.version as number,
        threshold: row.threshold ?? null,
        legalReference: (row.legal_reference as string | null) ?? null,
      }));
    },

    async storeEvaluations(evaluations: StoredEvaluation[]): Promise<number> {
      if (evaluations.length === 0) return 0;
      const { data, error } = await supabase
        .from("rule_evaluations")
        .insert(
          evaluations.map((evaluation) => ({
            assessment_item_id: evaluation.assessmentItemId,
            subject_ref: evaluation.subjectRef,
            rule_code: evaluation.ruleCode,
            rule_definition_id: evaluation.ruleDefinitionId,
            rule_version: evaluation.ruleVersion,
            result: evaluation.outcome,
            computed_explanation: evaluation.computedExplanation,
            missing_fact_keys: evaluation.missingFactKeys,
            inputs: evaluation.inputs,
            observed: evaluation.observed,
            thresholds: evaluation.thresholds,
            legal_reference: evaluation.legalReference,
          })),
        )
        .select("id");
      if (error) throw error;
      return data?.length ?? 0;
    },
  };
}

/**
 * The confirmed facts for one assessment, keyed by fact_key. Where the
 * same fact key was confirmed on more than one document, the most
 * recently resolved one wins — an assessor's later decision supersedes
 * an earlier one.
 */
export async function loadConfirmedFacts(supabase: SupabaseClient, assessmentId: string): Promise<Record<string, FactValue>> {
  const { data, error } = await supabase
    .from("fact_ledger_confirmed")
    .select("fact_key, confirmed_value, resolved_at")
    .eq("assessment_id", assessmentId)
    .order("resolved_at", { ascending: true });
  if (error) throw error;

  const facts: Record<string, FactValue> = {};
  for (const row of data ?? []) {
    facts[row.fact_key as string] = row.confirmed_value as FactValue;
  }
  return facts;
}

/** The assessor-entered quantitative fields for one assessment item. */
export async function loadQuantitative(supabase: SupabaseClient, assessmentItemId: string): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.from("assessment_items").select("quantitative").eq("id", assessmentItemId).maybeSingle();
  if (error) throw error;
  const quantitative = data?.quantitative;
  return quantitative && typeof quantitative === "object" ? (quantitative as Record<string, unknown>) : {};
}

/** Builds the subject for one assessment item from the two permitted input sources. */
export async function buildSubject(
  supabase: SupabaseClient,
  input: { assessmentId: string; assessmentItemId: string; assessmentDate: string; subjectRef?: string | null },
): Promise<EvaluationSubject> {
  const [facts, quantitative] = await Promise.all([
    loadConfirmedFacts(supabase, input.assessmentId),
    loadQuantitative(supabase, input.assessmentItemId),
  ]);

  return {
    assessmentItemId: input.assessmentItemId,
    subjectRef: input.subjectRef ?? null,
    inputs: { facts, quantitative, assessmentDate: input.assessmentDate },
  };
}

/** The stored evaluations for an assessment item — read back, never recomputed (this prompt). */
export async function loadStoredEvaluations(supabase: SupabaseClient, assessmentItemId: string) {
  const { data, error } = await supabase
    .from("rule_evaluations")
    .select("rule_code, rule_version, subject_ref, result, computed_explanation, missing_fact_keys, thresholds, legal_reference, evaluated_at")
    .eq("assessment_item_id", assessmentItemId)
    .order("evaluated_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}
