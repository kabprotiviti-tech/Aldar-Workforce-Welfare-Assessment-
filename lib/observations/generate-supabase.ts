import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { callClaudeForText } from "@/lib/ai/client";
import { writeAudit } from "@/lib/audit";
import { getRule } from "@/lib/rules/compliance/registry";
import type { GeneratedObservation, ObservationFact, ObservationInputs, ObservationRuleResult, PreviousFinding } from "@/lib/observations/generate";
import type { CallNarrativeFn } from "@/lib/observations/generate";
import type { ObservationView } from "@/lib/observations/store";
import type { AiObservationKind, AiObservationStatus } from "@/lib/db/evidence";

/**
 * The observation layer's data access. The narrative call is the only
 * model call here; everything that shapes a compliance judgement —
 * the kind, the source validation — happens in
 * lib/observations/generate.ts before anything is written.
 */

export const callNarrative: CallNarrativeFn = async (input) => {
  const result = await callClaudeForText(input);
  return { text: result.text, model: result.model, inputTokens: result.inputTokens, outputTokens: result.outputTokens };
};

const OBSERVATION_COLUMNS =
  "id, assessment_item_id, requirement_id, kind, title, body, status, source_fact_keys, page_ref, evidence_file_id, rule_code, rejection_reason, authored_by, actioned_at";

interface ObservationRow {
  id: string;
  assessment_item_id: string;
  requirement_id: string | null;
  kind: string;
  title: string;
  body: string | null;
  status: string;
  source_fact_keys: string[] | null;
  page_ref: string | null;
  evidence_file_id: string | null;
  rule_code: string | null;
  rejection_reason: string | null;
  authored_by: string;
  actioned_at: string | null;
}

function toView(row: ObservationRow): ObservationView {
  return {
    id: row.id,
    assessmentItemId: row.assessment_item_id,
    requirementId: row.requirement_id,
    kind: row.kind as AiObservationKind,
    title: row.title,
    body: row.body,
    status: row.status as AiObservationStatus,
    sourceFactKeys: row.source_fact_keys ?? [],
    pageRef: row.page_ref,
    evidenceFileId: row.evidence_file_id,
    ruleCode: row.rule_code,
    rejectionReason: row.rejection_reason,
    authoredBy: row.authored_by === "assessor" ? "assessor" : "model",
    actionedAt: row.actioned_at,
  };
}

/**
 * Assembles the generator's four inputs (this prompt): confirmed facts,
 * rule evaluation results, the requirement detail text, and the previous
 * cycle's findings for this entity and requirement.
 *
 * Facts are narrowed to the keys the item's own rules declare, rather
 * than every confirmed fact on the assessment — an observation about
 * working hours has no business being handed the insurance policy dates.
 */
export async function loadObservationInputs(
  supabase: SupabaseClient,
  input: { assessmentItemId: string },
): Promise<ObservationInputs | { error: string }> {
  const { data: item, error: itemError } = await supabase
    .from("assessment_items")
    .select("id, assessment_id, requirement_id, requirements(sl_no, title, detail_text), assessments(entity_id, module)")
    .eq("id", input.assessmentItemId)
    .maybeSingle();
  if (itemError) throw itemError;
  if (!item) return { error: "That assessment item no longer exists." };

  const requirement = (Array.isArray(item.requirements) ? item.requirements[0] : item.requirements) as
    | { sl_no: number; title: string; detail_text: string | null }
    | null;
  const assessment = (Array.isArray(item.assessments) ? item.assessments[0] : item.assessments) as
    | { entity_id: string; module: string }
    | null;
  if (!requirement || !assessment) return { error: "That assessment item is missing its requirement or assessment." };

  // Latest evaluation per rule code for this item.
  const { data: evaluationRows, error: evaluationError } = await supabase
    .from("rule_evaluations")
    .select("id, rule_code, result, computed_explanation, legal_reference, evaluated_at")
    .eq("assessment_item_id", input.assessmentItemId)
    .order("evaluated_at", { ascending: false });
  if (evaluationError) throw evaluationError;

  const ruleResults: ObservationRuleResult[] = [];
  const seen = new Set<string>();
  for (const row of evaluationRows ?? []) {
    const code = row.rule_code as string;
    if (seen.has(code)) continue;
    seen.add(code);
    ruleResults.push({
      ruleEvaluationId: row.id as string,
      ruleCode: code,
      outcome: row.result as ObservationRuleResult["outcome"],
      computedExplanation: (row.computed_explanation as string | null) ?? "",
      legalReference: (row.legal_reference as string | null) ?? null,
    });
  }

  const declaredFactKeys = new Set(ruleResults.flatMap((result) => getRule(result.ruleCode)?.inputFactKeys ?? []));

  const { data: factRows, error: factError } =
    declaredFactKeys.size > 0
      ? await supabase
          .from("fact_ledger_confirmed")
          .select("fact_key, confirmed_value, unit, page_ref, verbatim_quote, evidence_file_id, resolved_at")
          .eq("assessment_id", item.assessment_id)
          .in("fact_key", [...declaredFactKeys])
          .order("resolved_at", { ascending: true })
      : { data: [], error: null };
  if (factError) throw factError;

  const factByKey = new Map<string, ObservationFact>();
  for (const row of factRows ?? []) {
    factByKey.set(row.fact_key as string, {
      factKey: row.fact_key as string,
      value: row.confirmed_value as ObservationFact["value"],
      unit: (row.unit as string | null) ?? null,
      pageRef: (row.page_ref as string | null) ?? null,
      verbatimQuote: (row.verbatim_quote as string | null) ?? null,
      evidenceFileId: row.evidence_file_id as string,
    });
  }

  return {
    assessmentItemId: input.assessmentItemId,
    requirementId: item.requirement_id as string,
    requirementSlNo: requirement.sl_no,
    requirementTitle: requirement.title,
    requirementDetailText: requirement.detail_text,
    facts: [...factByKey.values()],
    ruleResults,
    previousFindings: await loadPreviousFindings(supabase, {
      entityId: assessment.entity_id,
      requirementId: item.requirement_id as string,
      excludeAssessmentId: item.assessment_id as string,
    }),
  };
}

/** Findings raised for this entity and requirement in an earlier assessment — continuity, not a verdict. */
export async function loadPreviousFindings(
  supabase: SupabaseClient,
  input: { entityId: string; requirementId: string; excludeAssessmentId: string },
): Promise<PreviousFinding[]> {
  const { data: items, error: itemsError } = await supabase
    .from("assessment_items")
    .select("id, assessment_id, assessments(cycle_id, cycles(name))")
    .eq("requirement_id", input.requirementId)
    .neq("assessment_id", input.excludeAssessmentId);
  if (itemsError) throw itemsError;
  if (!items || items.length === 0) return [];

  const cycleNameByItem = new Map<string, string | null>();
  for (const row of items) {
    const assessment = (Array.isArray(row.assessments) ? row.assessments[0] : row.assessments) as { cycles?: unknown } | null;
    const cycle = assessment ? ((Array.isArray(assessment.cycles) ? assessment.cycles[0] : assessment.cycles) as { name: string } | null) : null;
    cycleNameByItem.set(row.id as string, cycle?.name ?? null);
  }

  const { data: findings, error: findingsError } = await supabase
    .from("findings")
    .select("assessment_item_id, title, priority, status, created_at")
    .eq("entity_id", input.entityId)
    .in("assessment_item_id", [...cycleNameByItem.keys()])
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(5);
  if (findingsError) throw findingsError;

  return (findings ?? []).map((row) => ({
    title: row.title as string,
    priority: row.priority as string,
    status: row.status as string,
    cycleName: cycleNameByItem.get(row.assessment_item_id as string) ?? null,
  }));
}

/**
 * Stores generated observations as `open` — every one still needs an
 * assessor to confirm or reject it (this prompt's standing notice).
 * Written with the caller's own session: ai_observations now grants
 * insert to `authenticated` under can_write_operational()
 * (0023_observations.sql).
 */
export async function storeGeneratedObservations(supabase: SupabaseClient, observations: GeneratedObservation[]): Promise<number> {
  if (observations.length === 0) return 0;
  const { data, error } = await supabase
    .from("ai_observations")
    .insert(
      observations.map((observation) => ({
        assessment_item_id: observation.assessmentItemId,
        requirement_id: observation.requirementId,
        kind: observation.kind,
        title: observation.title,
        body: observation.body,
        status: "open",
        source_fact_keys: observation.sourceFactKeys,
        page_ref: observation.pageRef,
        evidence_file_id: observation.evidenceFileId,
        rule_code: observation.ruleCode,
        rule_evaluation_id: observation.ruleEvaluationId,
        model: observation.model,
        prompt_version: observation.promptVersion,
        authored_by: "model",
      })),
    )
    .select("id");
  if (error) throw error;
  return data?.length ?? 0;
}

/**
 * Records that the model tried to return a status-like key (this
 * prompt: "a post-validation strips any status-like key and logs it").
 * audit_log rather than a console line: this is the model attempting to
 * do the one thing it is never allowed to do, so the record has to
 * outlive a log buffer.
 */
export async function logStrippedStatusKeys(
  actorId: string | null,
  assessmentItemId: string,
  strippedKeys: string[],
  promptVersion: string,
): Promise<void> {
  if (strippedKeys.length === 0) return;
  await writeAudit(actorId, "ai_observation.status_key_stripped", "assessment_item", assessmentItemId, null, {
    stripped_keys: strippedKeys,
    prompt_version: promptVersion,
  });
}

/** Every observation for an assessment item, for the review panel. */
export async function listObservationsForItem(supabase: SupabaseClient, assessmentItemId: string): Promise<ObservationView[]> {
  const { data, error } = await supabase
    .from("ai_observations")
    .select(OBSERVATION_COLUMNS)
    .eq("assessment_item_id", assessmentItemId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row) => toView(row as unknown as ObservationRow));
}

/** Every observation for an assessment's items, for the evidence workspace panel. */
export async function listObservationsForAssessment(supabase: SupabaseClient, assessmentId: string): Promise<ObservationView[]> {
  const { data: items, error: itemsError } = await supabase.from("assessment_items").select("id").eq("assessment_id", assessmentId);
  if (itemsError) throw itemsError;
  const itemIds = (items ?? []).map((row) => row.id as string);
  if (itemIds.length === 0) return [];

  const { data, error } = await supabase
    .from("ai_observations")
    .select(OBSERVATION_COLUMNS)
    .in("assessment_item_id", itemIds)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row) => toView(row as unknown as ObservationRow));
}

/**
 * The confirmed observations for one requirement — what the assessor
 * workspace shows (this prompt's acceptance criterion). Rejected and
 * still-open observations are excluded by the status filter, not by
 * anything the caller remembers to do.
 */
export async function listConfirmedObservations(supabase: SupabaseClient, assessmentItemId: string): Promise<ObservationView[]> {
  const { data, error } = await supabase
    .from("ai_observations")
    .select(OBSERVATION_COLUMNS)
    .eq("assessment_item_id", assessmentItemId)
    .eq("status", "confirmed")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row) => toView(row as unknown as ObservationRow));
}
