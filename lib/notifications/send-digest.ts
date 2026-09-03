import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { buildDigestEmail } from "@/lib/notifications/digest";
import { loadSignalsForAssessments } from "@/lib/dashboard/signals-supabase";
import { sendEmail } from "@/lib/email/send";

export interface SendDigestsResult {
  sent: number;
}

/**
 * "Daily digest per assessor" (this prompt) — one email per active
 * assessor/admin, scoped to their own portfolio (assessments.owner_id)
 * across every cycle, not just the current one. Meant to be called once
 * a day by app/api/notifications/digest/route.ts (Vercel Cron), with
 * notification_digests_sent's unique (assessor_id, digest_date)
 * constraint as the dedupe guard — the same insert-and-catch-the-
 * unique-violation pattern as every other scheduled send in this app.
 */
export async function sendDailyDigests(todayIso: string = new Date().toISOString().slice(0, 10)): Promise<SendDigestsResult> {
  const supabase = createSupabaseAdminClient();

  const { data: assessors, error: assessorsError } = await supabase.from("users").select("id, full_name").in("role", ["admin", "assessor"]).eq("active", true);
  if (assessorsError) throw assessorsError;

  let sent = 0;
  for (const assessor of assessors ?? []) {
    const { error: insertError } = await supabase.from("notification_digests_sent").insert({ assessor_id: assessor.id, digest_date: todayIso });
    if (insertError) {
      if (insertError.code === "23505") continue; // Already sent today's digest to this assessor.
      throw insertError;
    }

    const { data: assessmentRows, error: assessmentsError } = await supabase
      .from("assessments")
      .select("id, subject_code, issued_at, report_due_date")
      .eq("owner_id", assessor.id as string)
      .is("deleted_at", null);
    if (assessmentsError) throw assessmentsError;

    const signals = await loadSignalsForAssessments(
      supabase,
      (assessmentRows ?? []).map((row) => ({
        id: row.id as string,
        subjectCode: row.subject_code as string,
        issuedAt: (row.issued_at as string | null) ?? null,
        reportDueDate: (row.report_due_date as string | null) ?? null,
      })),
      todayIso,
    );
    const email = buildDigestEmail(assessor.full_name as string, signals);

    const { data: user } = await supabase.auth.admin.getUserById(assessor.id as string);
    if (!user?.user?.email) continue;

    await sendEmail({ to: user.user.email, subject: email.subject, text: email.text });
    sent += 1;
  }

  return { sent };
}
