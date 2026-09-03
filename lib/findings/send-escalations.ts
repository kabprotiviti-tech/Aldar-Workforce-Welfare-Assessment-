import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { escalationKindsFor, type EscalationKind } from "@/lib/findings/escalation";
import { sendEmail } from "@/lib/email/send";
import type { FindingPriority, FindingStatus } from "@/lib/db/findings";

export interface SendEscalationsResult {
  sent: number;
}

const ESCALATION_SUBJECT: Record<EscalationKind, string> = {
  owner_overdue_30: "Overdue finding — 30 days",
  admin_overdue_60: "Overdue finding — 60 days",
  admin_high_priority: "High-priority finding raised",
};

/**
 * Escalation rules (this prompt): "overdue by 30 days notifies the
 * assessment owner; overdue by 60 days or any high-priority safety
 * finding notifies an admin." Meant to be called once a day by
 * app/api/findings/escalations/route.ts (Vercel Cron) — the same shape
 * as lib/rfi/send-reminders.ts, including its dedupe guard:
 * finding_escalations_sent's unique (finding_id, kind) constraint is
 * what actually makes this race-safe, not the select-then-insert below.
 *
 * assessments.owner_id and admin users are auth.users rows — the same
 * "PostgREST can't embed across schemas" gap lib/scheduling/portfolio.ts
 * documents — so their emails come from the Admin API
 * (auth.admin.getUserById), not a table select.
 */
export async function sendDueEscalations(todayIso: string = new Date().toISOString().slice(0, 10)): Promise<SendEscalationsResult> {
  const supabase = createSupabaseAdminClient();

  const { data: findings, error } = await supabase
    .from("findings")
    .select("id, status, priority, due_date, title, assessment_items!inner(assessments(owner_id, subject_code))")
    .neq("status", "closed")
    .is("deleted_at", null);
  if (error) throw error;

  const { data: admins, error: adminsError } = await supabase.from("users").select("id").eq("role", "admin").eq("active", true);
  if (adminsError) throw adminsError;

  let sent = 0;
  for (const finding of findings ?? []) {
    const item = (Array.isArray(finding.assessment_items) ? finding.assessment_items[0] : finding.assessment_items) as
      | { assessments: { owner_id: string | null; subject_code: string } | { owner_id: string | null; subject_code: string }[] | null }
      | null;
    const assessment = item ? (Array.isArray(item.assessments) ? item.assessments[0] : item.assessments) : null;

    const kinds = escalationKindsFor({
      status: finding.status as FindingStatus,
      priority: finding.priority as FindingPriority,
      dueDate: (finding.due_date as string | null) ?? null,
      today: todayIso,
    });

    for (const kind of kinds) {
      const { error: insertError } = await supabase.from("finding_escalations_sent").insert({ finding_id: finding.id, kind });
      if (insertError) {
        if (insertError.code === "23505") continue; // Already sent this escalation for this finding.
        throw insertError;
      }

      const recipients = kind === "owner_overdue_30" ? (assessment?.owner_id ? [assessment.owner_id] : []) : (admins ?? []).map((a) => a.id as string);

      for (const userId of recipients) {
        const { data: user } = await supabase.auth.admin.getUserById(userId);
        if (!user?.user?.email) continue;
        await sendEmail({
          to: user.user.email,
          subject: `${ESCALATION_SUBJECT[kind]} — ${assessment?.subject_code ?? ""}`,
          text: `${finding.title as string} (${assessment?.subject_code ?? "an assessment"}) needs attention.`,
        });
      }
      sent += 1;
    }
  }

  return { sent };
}
