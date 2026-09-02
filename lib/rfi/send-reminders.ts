import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { reminderKindForDueDate } from "@/lib/rfi/reminders";
import { sendEmail } from "@/lib/email/send";
import type { RfiReminderKind } from "@/lib/db/rfi";

export interface SendRemindersResult {
  sent: number;
}

const REMINDER_SUBJECT: Record<RfiReminderKind, string> = {
  due_minus_3: "Reminder: documents due in 3 days",
  due_date: "Reminder: documents due today",
  overdue: "Overdue: documents requested",
};

/**
 * Reminder schedule (this prompt): due date minus 3 days, on the due
 * date, and once overdue. Meant to be called once a day by
 * app/api/rfi/reminders/route.ts (Vercel Cron). Runs through the
 * service-role client — there's no interactive staff session behind a
 * cron trigger — and relies on rfi_reminders_sent's own unique
 * (rfi_request_id, kind) constraint as the atomic dedupe guard: the
 * insert either succeeds (first time this reminder has ever been due for
 * this request) or fails with a unique violation (already sent), which is
 * race-safe in a way a separate select-then-insert wouldn't be.
 */
export async function sendDueReminders(todayIso: string = new Date().toISOString().slice(0, 10)): Promise<SendRemindersResult> {
  const supabase = createSupabaseAdminClient();

  const { data: requests, error } = await supabase
    .from("rfi_requests")
    .select("id, due_date, entity_contacts(name, email), assessments(subject_code)")
    .eq("status", "open")
    .is("deleted_at", null);
  if (error) throw error;

  let sent = 0;
  for (const request of requests ?? []) {
    const kind = reminderKindForDueDate(request.due_date as string, todayIso);
    if (!kind) continue;

    const { error: insertError } = await supabase.from("rfi_reminders_sent").insert({ rfi_request_id: request.id, kind });
    if (insertError) {
      if (insertError.code === "23505") continue; // Already sent this reminder for this request.
      throw insertError;
    }

    const contactRaw = request.entity_contacts as { name: string; email: string | null } | { name: string; email: string | null }[] | null;
    const contact = Array.isArray(contactRaw) ? contactRaw[0] : contactRaw;
    const assessmentRaw = request.assessments as { subject_code: string } | { subject_code: string }[] | null;
    const assessment = Array.isArray(assessmentRaw) ? assessmentRaw[0] : assessmentRaw;
    if (!contact?.email) continue;

    await sendEmail({
      to: contact.email,
      subject: `${REMINDER_SUBJECT[kind]} — ${assessment?.subject_code ?? ""}`,
      text: `Documents requested for ${assessment?.subject_code ?? "your assessment"} are due ${request.due_date as string}. Please use the link previously sent to upload them.`,
    });
    sent += 1;
  }

  return { sent };
}
