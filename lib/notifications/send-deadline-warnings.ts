import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { deadlineWarningKindForDueDate, type DeadlineWarningKind } from "@/lib/notifications/deadline-warnings";
import { sendEmail } from "@/lib/email/send";

export interface SendDeadlineWarningsResult {
  sent: number;
}

const SUBJECT: Record<DeadlineWarningKind, string> = {
  due_minus_3: "Report due in 3 days",
  due_minus_1: "Report due tomorrow",
};

/**
 * "3-day/1-day deadline warnings" (this prompt) for
 * `assessments.report_due_date`. Meant to be called once a day by
 * app/api/notifications/deadline-warnings/route.ts (Vercel Cron) — the
 * same shape as lib/rfi/send-reminders.ts, including its dedupe guard:
 * report_deadline_warnings_sent's unique (assessment_id, kind)
 * constraint is what actually makes this race-safe.
 *
 * assessments.owner_id is an auth.users row — the same "PostgREST can't
 * embed across schemas" gap lib/findings/send-escalations.ts documents
 * — so the owner's email comes from the Admin API, not a table select.
 * An assessment with no owner assigned yet is skipped: there's no one
 * to warn.
 */
export async function sendDueDeadlineWarnings(todayIso: string = new Date().toISOString().slice(0, 10)): Promise<SendDeadlineWarningsResult> {
  const supabase = createSupabaseAdminClient();

  const { data: assessments, error } = await supabase
    .from("assessments")
    .select("id, subject_code, report_due_date, owner_id")
    .is("issued_at", null)
    .not("report_due_date", "is", null)
    .is("deleted_at", null);
  if (error) throw error;

  let sent = 0;
  for (const assessment of assessments ?? []) {
    const kind = deadlineWarningKindForDueDate(assessment.report_due_date as string, todayIso);
    if (!kind) continue;

    const { error: insertError } = await supabase.from("report_deadline_warnings_sent").insert({ assessment_id: assessment.id, kind });
    if (insertError) {
      if (insertError.code === "23505") continue; // Already sent this warning for this assessment.
      throw insertError;
    }

    if (!assessment.owner_id) continue;
    const { data: user } = await supabase.auth.admin.getUserById(assessment.owner_id as string);
    if (!user?.user?.email) continue;

    await sendEmail({
      to: user.user.email,
      subject: `${SUBJECT[kind]} — ${assessment.subject_code as string}`,
      text: `The report for ${assessment.subject_code as string} is due ${assessment.report_due_date as string}.`,
    });
    sent += 1;
  }

  return { sent };
}
