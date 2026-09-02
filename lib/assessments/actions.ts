"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { computeReportDueDate, holidaySetFromDates } from "@/lib/scheduling/working-days";

function optStr(formData: FormData, key: string): string | null {
  const value = String(formData.get(key) ?? "").trim();
  return value === "" ? null : value;
}

/** Proposed/confirmed visit date and the permission-required flag — this prompt's "visit schedule." */
export async function updateVisitSchedule(assessmentId: string, formData: FormData): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("assessments")
    .update({
      proposed_visit_date: optStr(formData, "proposed_visit_date"),
      confirmed_visit_date: optStr(formData, "confirmed_visit_date"),
      permission_required: formData.get("permission_required") === "on",
    })
    .eq("id", assessmentId);
  if (error) {
    redirect(`/app/assessments/${assessmentId}?error=${encodeURIComponent(error.message)}`);
  }
  revalidatePath(`/app/assessments/${assessmentId}`);
  redirect(`/app/assessments/${assessmentId}?success=${encodeURIComponent("Visit schedule updated.")}`);
}

/**
 * Records the date the visit actually happened and computes+stores
 * report_due_date from it (this prompt: "report due = actual_visit_date +
 * 10 working days ... stored not calculated on read"). Reads the current
 * UAE holiday calendar (public.public_holidays, editable in Settings) at
 * the moment this is called — a later edit to the calendar does not
 * retroactively change a deadline already stored, matching "stored, not
 * calculated on read" for the holiday table too, not just the arithmetic.
 */
export async function recordActualVisitDate(assessmentId: string, formData: FormData): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const actualVisitDate = optStr(formData, "actual_visit_date");
  if (!actualVisitDate) {
    redirect(`/app/assessments/${assessmentId}?error=${encodeURIComponent("Actual visit date is required.")}`);
  }

  const { data: holidayRows, error: holidayError } = await supabase
    .from("public_holidays")
    .select("holiday_date")
    .is("deleted_at", null);
  if (holidayError) {
    redirect(`/app/assessments/${assessmentId}?error=${encodeURIComponent(holidayError.message)}`);
  }
  const holidays = holidaySetFromDates((holidayRows ?? []).map((r) => r.holiday_date as string));
  const reportDueDate = computeReportDueDate(actualVisitDate as string, holidays);

  const { error } = await supabase
    .from("assessments")
    .update({ actual_visit_date: actualVisitDate, report_due_date: reportDueDate })
    .eq("id", assessmentId);
  if (error) {
    redirect(`/app/assessments/${assessmentId}?error=${encodeURIComponent(error.message)}`);
  }
  revalidatePath(`/app/assessments/${assessmentId}`);
  redirect(`/app/assessments/${assessmentId}?success=${encodeURIComponent(`Actual visit date recorded — report due ${reportDueDate}.`)}`);
}

export async function assignAssessmentOwner(assessmentId: string, formData: FormData): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const ownerId = optStr(formData, "owner_id");
  const { error } = await supabase.from("assessments").update({ owner_id: ownerId }).eq("id", assessmentId);
  if (error) {
    redirect(`/app/assessments/${assessmentId}?error=${encodeURIComponent(error.message)}`);
  }
  revalidatePath(`/app/assessments/${assessmentId}`);
  redirect(`/app/assessments/${assessmentId}`);
}

/** Same action, for the per-row owner selects on a cycle's assessment list. */
export async function assignAssessmentOwnerFromCycle(assessmentId: string, cycleId: string, formData: FormData): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const ownerId = optStr(formData, "owner_id");
  const { error } = await supabase.from("assessments").update({ owner_id: ownerId }).eq("id", assessmentId);
  if (error) {
    redirect(`/app/cycles/${cycleId}?error=${encodeURIComponent(error.message)}`);
  }
  revalidatePath(`/app/cycles/${cycleId}`);
  redirect(`/app/cycles/${cycleId}`);
}

/**
 * The client's supporting access letter for a permission-required visit
 * (this prompt) — stored as any other evidence file
 * (public.evidence_files, document_class = 'access_letter') rather than a
 * dedicated table/column. Requires a Storage bucket named "evidence" to
 * already exist in the Supabase project (created once via the dashboard
 * or a project-specific storage migration — see docs/decisions.md; the
 * local Postgres test harness has no storage schema to migrate against).
 */
export async function uploadAccessLetter(assessmentId: string, formData: FormData): Promise<void> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    redirect(`/app/assessments/${assessmentId}?error=${encodeURIComponent("Choose a file to upload.")}`);
  }

  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();
  const storagePath = `access-letters/${assessmentId}/${Date.now()}-${(file as File).name}`;

  const { error: uploadError } = await supabase.storage.from("evidence").upload(storagePath, file as File);
  if (uploadError) {
    redirect(`/app/assessments/${assessmentId}?error=${encodeURIComponent(uploadError.message)}`);
  }

  const { error } = await supabase.from("evidence_files").insert({
    assessment_id: assessmentId,
    storage_path: storagePath,
    original_name: (file as File).name,
    mime_type: (file as File).type || "application/octet-stream",
    size_bytes: (file as File).size,
    document_class: "access_letter",
    uploaded_by: userData.user?.id,
  });
  if (error) {
    redirect(`/app/assessments/${assessmentId}?error=${encodeURIComponent(error.message)}`);
  }
  revalidatePath(`/app/assessments/${assessmentId}`);
  redirect(`/app/assessments/${assessmentId}?success=${encodeURIComponent("Access letter uploaded.")}`);
}
