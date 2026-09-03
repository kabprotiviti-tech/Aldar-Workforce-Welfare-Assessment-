"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { loadAndRunQaChecklist } from "@/lib/qa/checklist-supabase";
import { qaChecklistPasses } from "@/lib/qa/checklist";
import { validateApprove, validateOpenRevision, validateOpenReview, validatePassReview, validateReturnToAssessor } from "@/lib/qa/lifecycle";
import { generateAndApproveReport } from "@/lib/reports/generate";
import { supabaseReportGenerationDb } from "@/lib/reports/generate-supabase";
import type { ApprovalStatus, QaStatus } from "@/lib/db/assessments";

export type QaActionResult = { ok: true } | { ok: false; message: string };

/**
 * 0004_assessments.sql's own comment: "restricting qa_reviewer to only
 * [qa_completed_at/approved_at] is an application-layer rule, not a
 * database one" — RLS on assessments is row-level (is_staff(), which
 * covers admin/assessor/qa_reviewer alike), so which of those three may
 * call which action here is exactly that documented application-layer
 * rule, checked once, in one place.
 */
async function currentUserRole(supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>, userId: string): Promise<string | null> {
  const { data } = await supabase.from("users").select("role").eq("id", userId).maybeSingle();
  return (data?.role as string | undefined) ?? null;
}

async function requireRole(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  userId: string,
  allowed: readonly string[],
): Promise<QaActionResult | null> {
  const role = await currentUserRole(supabase, userId);
  if (!role || !allowed.includes(role)) {
    return { ok: false, message: "You don't have permission to do that." };
  }
  return null;
}

async function getAssessmentGovernanceState(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  assessmentId: string,
): Promise<{ qaStatus: QaStatus; approvalStatus: ApprovalStatus } | null> {
  const { data } = await supabase.from("assessments").select("qa_status, approval_status").eq("id", assessmentId).maybeSingle();
  if (!data) return null;
  return { qaStatus: data.qa_status as QaStatus, approvalStatus: data.approval_status as ApprovalStatus };
}

async function openQueryCount(supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>, assessmentId: string): Promise<number> {
  const { count } = await supabase
    .from("qa_queries")
    .select("id", { count: "exact", head: true })
    .eq("assessment_id", assessmentId)
    .eq("status", "open");
  return count ?? 0;
}

function revalidateAssessment(assessmentId: string): void {
  revalidatePath(`/app/assessments/${assessmentId}`);
}

/** "QA reviewer role opens the assessment in review mode" (this prompt). */
export async function openQaReview(assessmentId: string): Promise<QaActionResult> {
  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return { ok: false, message: "Sign in required." };

  const permission = await requireRole(supabase, userData.user.id, ["admin", "qa_reviewer"]);
  if (permission) return permission;

  const state = await getAssessmentGovernanceState(supabase, assessmentId);
  if (!state) return { ok: false, message: "That assessment no longer exists." };

  const validation = validateOpenReview(state.qaStatus);
  if (!validation.ok) return { ok: false, message: validation.message };

  const { error } = await supabase.from("assessments").update({ qa_status: "in_review" }).eq("id", assessmentId);
  if (error) return { ok: false, message: error.message };

  revalidateAssessment(assessmentId);
  return { ok: true };
}

/** "Raises queries against specific requirements" (this prompt). */
export async function raiseQaQuery(assessmentId: string, assessmentItemId: string, queryText: string): Promise<QaActionResult> {
  if (!queryText.trim()) return { ok: false, message: "A query needs some text." };

  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return { ok: false, message: "Sign in required." };

  const permission = await requireRole(supabase, userData.user.id, ["admin", "qa_reviewer"]);
  if (permission) return permission;

  const { error } = await supabase.from("qa_queries").insert({
    assessment_id: assessmentId,
    assessment_item_id: assessmentItemId,
    query_text: queryText.trim(),
    raised_by: userData.user.id,
  });
  if (error) return { ok: false, message: error.message };

  revalidateAssessment(assessmentId);
  return { ok: true };
}

/** Resolving a query is the assessor's (or admin's) job — the point of a query is that someone else answers it. */
export async function resolveQaQuery(queryId: string, assessmentId: string, resolutionNote: string): Promise<QaActionResult> {
  if (!resolutionNote.trim()) return { ok: false, message: "Say how this query was addressed." };

  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return { ok: false, message: "Sign in required." };

  const permission = await requireRole(supabase, userData.user.id, ["admin", "assessor"]);
  if (permission) return permission;

  const { error } = await supabase
    .from("qa_queries")
    .update({ status: "resolved", resolution_note: resolutionNote.trim(), resolved_by: userData.user.id, resolved_at: new Date().toISOString() })
    .eq("id", queryId)
    .eq("status", "open");
  if (error) return { ok: false, message: error.message };

  revalidateAssessment(assessmentId);
  return { ok: true };
}

/** "...and returns it to the assessor..." (this prompt). */
export async function returnToAssessor(assessmentId: string): Promise<QaActionResult> {
  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return { ok: false, message: "Sign in required." };

  const permission = await requireRole(supabase, userData.user.id, ["admin", "qa_reviewer"]);
  if (permission) return permission;

  const state = await getAssessmentGovernanceState(supabase, assessmentId);
  if (!state) return { ok: false, message: "That assessment no longer exists." };

  const validation = validateReturnToAssessor(state.qaStatus, await openQueryCount(supabase, assessmentId));
  if (!validation.ok) return { ok: false, message: validation.message };

  const { error } = await supabase.from("assessments").update({ qa_status: "returned" }).eq("id", assessmentId);
  if (error) return { ok: false, message: error.message };

  revalidateAssessment(assessmentId);
  return { ok: true };
}

/** "...or passes it" (this prompt). Both gates — the automated checklist and every query resolved — are checked here and again by 0030_governance.sql's own trigger. */
export async function passQaReview(assessmentId: string): Promise<QaActionResult> {
  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return { ok: false, message: "Sign in required." };

  const permission = await requireRole(supabase, userData.user.id, ["admin", "qa_reviewer"]);
  if (permission) return permission;

  const state = await getAssessmentGovernanceState(supabase, assessmentId);
  if (!state) return { ok: false, message: "That assessment no longer exists." };

  const [checklist, openCount] = await Promise.all([loadAndRunQaChecklist(supabase, assessmentId), openQueryCount(supabase, assessmentId)]);
  const validation = validatePassReview(state.qaStatus, openCount, qaChecklistPasses(checklist));
  if (!validation.ok) return { ok: false, message: validation.message };

  const { error } = await supabase.from("assessments").update({ qa_status: "passed" }).eq("id", assessmentId);
  if (error) return { ok: false, message: error.message };

  revalidateAssessment(assessmentId);
  return { ok: true };
}

/**
 * "On client approval, the assessment and all its items lock:
 * immutable, with a report version generated" (this prompt). Admin
 * only — approve_assessment_and_generate_report (0030_governance.sql)
 * checks this itself too.
 */
export async function approveAssessment(assessmentId: string): Promise<QaActionResult> {
  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return { ok: false, message: "Sign in required." };

  const permission = await requireRole(supabase, userData.user.id, ["admin"]);
  if (permission) return permission;

  const state = await getAssessmentGovernanceState(supabase, assessmentId);
  if (!state) return { ok: false, message: "That assessment no longer exists." };

  const validation = validateApprove(state.approvalStatus);
  if (!validation.ok) return { ok: false, message: validation.message };

  try {
    await generateAndApproveReport(supabaseReportGenerationDb(supabase), assessmentId);
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Could not approve this assessment." };
  }

  revalidateAssessment(assessmentId);
  revalidatePath("/app/reports");
  return { ok: true };
}

/**
 * "Any post-approval change requires a formal revision creating version
 * n+1, preserving version n in full" (this prompt). Admin only —
 * open_assessment_revision (0030_governance.sql) checks this itself
 * too, and is what actually preserves version n: it never touches the
 * existing reports row, only records which one it was.
 */
export async function openAssessmentRevision(assessmentId: string, reason: string): Promise<QaActionResult> {
  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return { ok: false, message: "Sign in required." };

  const permission = await requireRole(supabase, userData.user.id, ["admin"]);
  if (permission) return permission;

  const state = await getAssessmentGovernanceState(supabase, assessmentId);
  if (!state) return { ok: false, message: "That assessment no longer exists." };

  const validation = validateOpenRevision(state.approvalStatus, reason);
  if (!validation.ok) return { ok: false, message: validation.message };

  const { error } = await supabase.rpc("open_assessment_revision", { p_assessment_id: assessmentId, p_reason: reason.trim() });
  if (error) return { ok: false, message: error.message };

  revalidateAssessment(assessmentId);
  return { ok: true };
}
