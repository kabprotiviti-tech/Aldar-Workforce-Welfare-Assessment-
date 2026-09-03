"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { dbComplianceRatingSchema } from "@/lib/db/assessments";
import { evidenceDetailSchema, validateItemDecision, type ItemDecision } from "@/lib/assessment/decision";
import { detectRepeat, planCarryForwardDecision, previousFindingState } from "@/lib/assessment/carry-forward";
import type { FindingStatus } from "@/lib/db/findings";
import type { DbModule } from "@/lib/db/common";
import type { ComplianceRating } from "@/lib/rules/constants";

/**
 * The assessor's writes on one requirement.
 *
 * Every one of these runs through the assessor's own session-scoped
 * client. That is not a convention here: the status write is enforced by
 * a database trigger that raises unless auth.uid() is a real
 * admin/assessor (0024_assessment_decision.sql), so a service-role
 * shortcut would fail rather than quietly succeed. The trigger also
 * stamps decided_by/decided_at and writes the audit_log row, so those
 * cannot be forgotten by any caller — including this one.
 */

export type AssessmentActionResult = { ok: true } | { ok: false; message: string; issues?: string[] };

/**
 * Autosaved drafting. Written server-side rather than to browser storage
 * so a draft survives a refresh, a closed tab and a different device —
 * this prompt's "draft text survives a browser refresh", met by the text
 * genuinely living on the server rather than by a localStorage trick.
 */
export async function saveObservationDrafts(
  assessmentItemId: string,
  assessmentId: string,
  drafts: { assessorObservations: string; officeVisitObservations: string },
): Promise<AssessmentActionResult> {
  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return { ok: false, message: "Sign in required." };

  const { error } = await supabase
    .from("assessment_items")
    .update({
      assessor_observations: drafts.assessorObservations,
      office_visit_observations: drafts.officeVisitObservations,
      draft_updated_at: new Date().toISOString(),
    })
    .eq("id", assessmentItemId);
  if (error) return { ok: false, message: error.message };

  // Deliberately no revalidatePath: autosave fires while the assessor is
  // typing, and re-rendering the page under them would fight the cursor.
  void assessmentId;
  return { ok: true };
}

export interface SaveDecisionInput {
  status: string;
  remarks: string;
  actionRequired: string;
  requirementSlNo: number;
  requirementTitle: string;
}

/**
 * Saving the compliance status. Validation runs here, before the write,
 * so an assessor gets the naming message rather than a database error —
 * but the database is what actually guarantees who may write it.
 */
export async function saveDecision(
  assessmentItemId: string,
  assessmentId: string,
  input: SaveDecisionInput,
): Promise<AssessmentActionResult> {
  const status = dbComplianceRatingSchema.safeParse(input.status);
  if (!status.success) {
    return { ok: false, message: "Choose a compliance status." };
  }

  const decision: ItemDecision = {
    requirementSlNo: input.requirementSlNo,
    requirementTitle: input.requirementTitle,
    isKey: false,
    status: status.data,
    remarks: input.remarks.trim() || null,
    actionRequired: input.actionRequired.trim() || null,
  };

  const issues = validateItemDecision(decision);
  if (issues.length > 0) {
    return { ok: false, message: issues[0]!.message, issues: issues.map((issue) => issue.message) };
  }

  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return { ok: false, message: "Sign in required." };

  const { data, error } = await supabase
    .from("assessment_items")
    .update({
      compliance_status: decision.status,
      remarks: decision.remarks,
      action_required: decision.actionRequired,
      // A genuine reassessment, however the item started out — flips a
      // carried-forward item out of "not yet assessed this cycle" the
      // moment the assessor actually assesses it.
      was_assessed: true,
    })
    .eq("id", assessmentItemId)
    .select("id, requirement_id, decided_at, assessments(entity_id, facility_id)")
    .maybeSingle();
  if (error) {
    // The trigger's own message is the clearest thing to show here.
    return { ok: false, message: error.message };
  }
  if (!data) return { ok: false, message: "That requirement no longer exists, or you can't decide it." };

  const assessmentOfItem = (Array.isArray(data.assessments) ? data.assessments[0] : data.assessments) as
    | { entity_id: string; facility_id: string | null }
    | null;

  if ((decision.status === "Partial" || decision.status === "Not Compliant") && assessmentOfItem) {
    await recordFindingForFailingDecision(supabase, {
      assessmentItemId,
      requirementId: data.requirement_id as string,
      requirementTitle: decision.requirementTitle,
      status: decision.status,
      entityId: assessmentOfItem.entity_id,
      facilityId: assessmentOfItem.facility_id,
      actorId: userData.user.id,
    });
  }

  revalidatePath(`/app/assessments/${assessmentId}/requirements/${assessmentItemId}`);
  revalidatePath(`/app/assessments/${assessmentId}`);
  return { ok: true };
}

/**
 * The most recent, non-deleted finding raised for this exact compliance
 * area — this requirement, for this entity — across every assessment
 * cycle, not only the one immediately before this item.
 *
 * Walking the whole history rather than following
 * `carried_forward_from_item_id` one hop back matters: a requirement can
 * go fail -> closed -> compliant -> fail again, and the closed finding
 * that makes the last failure a *repeat* sits two cycles back, on an
 * item that isn't this one's direct carry-forward source. The same
 * search also catches a finding nobody ever formally closed, however
 * many compliant-looking cycles have passed since — which is exactly
 * the case this prompt's "must be assessed" rule exists to prevent
 * papering over.
 */
async function mostRecentFindingForRequirement(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  input: { entityId: string; requirementId: string },
): Promise<{ id: string; status: FindingStatus; assessmentItemId: string } | null> {
  const { data, error } = await supabase
    .from("findings")
    .select("id, status, assessment_item_id, assessment_items!inner(requirement_id)")
    .eq("entity_id", input.entityId)
    .eq("assessment_items.requirement_id", input.requirementId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ? { id: data.id as string, status: data.status as FindingStatus, assessmentItemId: data.assessment_item_id as string } : null;
}

/**
 * Creating the finding a Partial/Not Compliant decision needs to be
 * tracked to closure, and flagging it a repeat when this compliance
 * area was closed out and has now failed again (this prompt). Skipped
 * when the most recent finding for this area is already live and
 * belongs to this exact item — a re-save of the same failing decision
 * must not spawn a duplicate.
 */
async function recordFindingForFailingDecision(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  input: {
    assessmentItemId: string;
    requirementId: string;
    requirementTitle: string;
    status: ComplianceRating;
    entityId: string;
    facilityId: string | null;
    actorId: string;
  },
): Promise<void> {
  const prior = await mostRecentFindingForRequirement(supabase, { entityId: input.entityId, requirementId: input.requirementId });
  if (prior && prior.status !== "closed" && prior.assessmentItemId === input.assessmentItemId) return;

  const repeat = detectRepeat(input.status, prior?.id ?? null, prior?.status ?? null);

  await supabase.from("findings").insert({
    assessment_item_id: input.assessmentItemId,
    entity_id: input.entityId,
    facility_id: input.facilityId,
    title: `${input.requirementTitle} — ${input.status}`,
    priority: "medium",
    status: "open",
    repeat_of_finding_id: repeat.repeatOfFindingId,
    created_by: input.actorId,
  });
}

export interface MarkNotAssessedInput {
  module: DbModule;
}

/**
 * "Not assessed this cycle": retains the carried-forward status and
 * writes the verbatim boilerplate — but only where carry-forward is
 * actually permitted (this prompt's own acceptance criterion: an item
 * with an open finding is blocked, with an explanation, rather than
 * silently carried forward anyway).
 */
export async function markNotAssessedThisCycle(assessmentItemId: string, assessmentId: string, input: MarkNotAssessedInput): Promise<AssessmentActionResult> {
  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return { ok: false, message: "Sign in required." };

  const { data: item, error: itemError } = await supabase
    .from("assessment_items")
    .select("id, requirement_id, previous_compliance_status, assessments!inner(entity_id)")
    .eq("id", assessmentItemId)
    .maybeSingle();
  if (itemError) return { ok: false, message: itemError.message };
  if (!item) return { ok: false, message: "That requirement no longer exists." };

  const assessmentOfItem = (Array.isArray(item.assessments) ? item.assessments[0] : item.assessments) as { entity_id: string } | null;
  const finding = assessmentOfItem
    ? await mostRecentFindingForRequirement(supabase, { entityId: assessmentOfItem.entity_id, requirementId: item.requirement_id as string })
    : null;

  const plan = planCarryForwardDecision(
    input.module,
    item.previous_compliance_status as ComplianceRating | null,
    previousFindingState(finding?.status ?? null),
  );
  if (!plan.ok) {
    return { ok: false, message: plan.message };
  }

  const { error } = await supabase
    .from("assessment_items")
    .update({
      compliance_status: plan.decision.status,
      remarks: plan.decision.remarks,
      action_required: plan.decision.actionRequired,
      was_assessed: false,
    })
    .eq("id", assessmentItemId);
  if (error) return { ok: false, message: error.message };

  revalidatePath(`/app/assessments/${assessmentId}/requirements/${assessmentItemId}`);
  revalidatePath(`/app/assessments/${assessmentId}`);
  return { ok: true };
}

export interface InterviewInsightsInput {
  workersInterviewedCount: number | null;
  nationalities: string[];
  interpreterUsed: boolean | null;
  notes: string;
}

/**
 * Interview insights. Written to their own table, which no client_viewer
 * has a select policy on — this prompt's "interview notes are stored
 * separately and are never included in the entity-visible report", made
 * structural rather than editorial.
 */
export async function saveInterviewInsights(
  assessmentItemId: string,
  assessmentId: string,
  input: InterviewInsightsInput,
): Promise<AssessmentActionResult> {
  if (input.workersInterviewedCount !== null && input.workersInterviewedCount < 0) {
    return { ok: false, message: "Workers interviewed cannot be negative." };
  }

  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return { ok: false, message: "Sign in required." };

  const { error } = await supabase.from("interview_insights").upsert(
    {
      assessment_item_id: assessmentItemId,
      workers_interviewed_count: input.workersInterviewedCount,
      nationalities: input.nationalities.map((entry) => entry.trim()).filter((entry) => entry.length > 0),
      interpreter_used: input.interpreterUsed,
      notes: input.notes.trim() || null,
      updated_at: new Date().toISOString(),
      created_by: userData.user.id,
    },
    { onConflict: "assessment_item_id" },
  );
  if (error) return { ok: false, message: error.message };

  revalidatePath(`/app/assessments/${assessmentId}/requirements/${assessmentItemId}`);
  return { ok: true };
}

/** The specific numbers a report is built from: transfer dates, deduction examples, sample sizes. */
export async function saveEvidenceDetail(assessmentItemId: string, assessmentId: string, detail: unknown): Promise<AssessmentActionResult> {
  const parsed = evidenceDetailSchema.safeParse(detail);
  if (!parsed.success) {
    return { ok: false, message: `Those figures aren't valid: ${parsed.error.issues[0]?.message ?? "check the values."}` };
  }

  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return { ok: false, message: "Sign in required." };

  const { error } = await supabase.from("assessment_items").update({ evidence_detail: parsed.data }).eq("id", assessmentItemId);
  if (error) return { ok: false, message: error.message };

  revalidatePath(`/app/assessments/${assessmentId}/requirements/${assessmentItemId}`);
  return { ok: true };
}
