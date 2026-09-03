import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { planAssessmentItems, type PreviousItemForGeneration, type RequirementForGeneration } from "@/lib/assessment/generate-items";
import type { ComplianceRating } from "@/lib/rules/constants";

/**
 * Real adapter for lib/assessment/generate-items.ts. Session-scoped
 * client throughout: assessment_items already grants insert to
 * `authenticated` under `can_write_operational()`
 * (0004_assessments.sql), and this generator never sets
 * `compliance_status` itself, so 0024's insert trigger sees a `null`
 * status and does nothing more than let the row through — no assessor
 * "decided" anything yet, because nobody has.
 */
export async function generateAssessmentItems(supabase: SupabaseClient, assessmentId: string): Promise<{ count: number }> {
  const { data: assessment, error: assessmentError } = await supabase
    .from("assessments")
    .select("id, template_id, previous_assessment_id")
    .eq("id", assessmentId)
    .maybeSingle();
  if (assessmentError) throw assessmentError;
  if (!assessment) throw new Error(`generateAssessmentItems: no assessment ${assessmentId}`);

  // Idempotent: a re-run (a retried request, a re-triggered job) must
  // not duplicate rows or re-carry-forward on top of work already begun.
  const { count: existingCount, error: existingError } = await supabase
    .from("assessment_items")
    .select("id", { count: "exact", head: true })
    .eq("assessment_id", assessmentId);
  if (existingError) throw existingError;
  if ((existingCount ?? 0) > 0) return { count: 0 };

  const { data: requirementRows, error: requirementsError } = await supabase
    .from("requirements")
    .select("id, sl_no")
    .eq("template_id", assessment.template_id)
    .is("deleted_at", null);
  if (requirementsError) throw requirementsError;

  const requirements: RequirementForGeneration[] = (requirementRows ?? []).map((row) => ({
    requirementId: row.id as string,
    slNo: row.sl_no as number,
  }));

  const previousItemsByRequirementId = new Map<string, PreviousItemForGeneration>();
  if (assessment.previous_assessment_id) {
    const { data: previousRows, error: previousError } = await supabase
      .from("assessment_items")
      .select("id, requirement_id, compliance_status, remarks, action_required")
      .eq("assessment_id", assessment.previous_assessment_id);
    if (previousError) throw previousError;

    for (const row of previousRows ?? []) {
      previousItemsByRequirementId.set(row.requirement_id as string, {
        itemId: row.id as string,
        complianceStatus: row.compliance_status as ComplianceRating | null,
        remarks: row.remarks as string | null,
        actionRequired: row.action_required as string | null,
      });
    }
  }

  const plan = planAssessmentItems(requirements, previousItemsByRequirementId);
  if (plan.length === 0) return { count: 0 };

  const { data, error } = await supabase
    .from("assessment_items")
    .insert(
      plan.map((row) => ({
        assessment_id: assessmentId,
        requirement_id: row.requirementId,
        was_assessed: row.wasAssessed,
        previous_compliance_status: row.snapshot.previousComplianceStatus,
        previous_remarks: row.snapshot.previousRemarks,
        previous_action_required: row.snapshot.previousActionRequired,
        carried_forward_from_item_id: row.snapshot.carriedForwardFromItemId,
      })),
    )
    .select("id");
  if (error) throw error;

  return { count: data?.length ?? 0 };
}

/**
 * Generates items for every assessment in one cycle+module that doesn't
 * have any yet — the counterpart to
 * lib/scheduling/generate-cycle.ts's bulk assessment creation, called
 * right after it (lib/cycles/actions.ts). "Doesn't have any yet" is the
 * idempotency check itself: whichever assessments generateAssessmentSet
 * just inserted are exactly the ones with none, and a re-click that
 * skipped every target because they already existed correctly does
 * nothing here either.
 */
export async function generateItemsForCycleAssessments(
  supabase: SupabaseClient,
  cycleId: string,
  module: string,
): Promise<{ assessmentsPopulated: number; itemsCreated: number }> {
  const { data: assessments, error: assessmentsError } = await supabase
    .from("assessments")
    .select("id")
    .eq("cycle_id", cycleId)
    .eq("module", module);
  if (assessmentsError) throw assessmentsError;
  if (!assessments || assessments.length === 0) return { assessmentsPopulated: 0, itemsCreated: 0 };

  const assessmentIds = assessments.map((row) => row.id as string);
  const { data: existingItems, error: existingError } = await supabase
    .from("assessment_items")
    .select("assessment_id")
    .in("assessment_id", assessmentIds);
  if (existingError) throw existingError;

  const alreadyPopulated = new Set((existingItems ?? []).map((row) => row.assessment_id as string));
  const needing = assessmentIds.filter((id) => !alreadyPopulated.has(id));

  let assessmentsPopulated = 0;
  let itemsCreated = 0;
  for (const assessmentId of needing) {
    const { count } = await generateAssessmentItems(supabase, assessmentId);
    if (count > 0) assessmentsPopulated += 1;
    itemsCreated += count;
  }

  return { assessmentsPopulated, itemsCreated };
}
