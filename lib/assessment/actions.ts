"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { dbComplianceRatingSchema } from "@/lib/db/assessments";
import { evidenceDetailSchema, validateItemDecision, type ItemDecision } from "@/lib/assessment/decision";

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
    })
    .eq("id", assessmentItemId)
    .select("id, decided_at")
    .maybeSingle();
  if (error) {
    // The trigger's own message is the clearest thing to show here.
    return { ok: false, message: error.message };
  }
  if (!data) return { ok: false, message: "That requirement no longer exists, or you can't decide it." };

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
