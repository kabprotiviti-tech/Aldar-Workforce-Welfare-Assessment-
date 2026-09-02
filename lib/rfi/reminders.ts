import type { RfiReminderKind } from "@/lib/db/rfi";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((new Date(`${toIso}T00:00:00Z`).getTime() - new Date(`${fromIso}T00:00:00Z`).getTime()) / MS_PER_DAY);
}

/**
 * Reminder schedule (this prompt): due date minus 3 days, on the due date,
 * and once overdue. Pure — given today and a due date, which single
 * reminder (if any) applies today. The caller (lib/rfi/send-reminders.ts)
 * skips it if rfi_reminders_sent already has a row for it, so calling this
 * once a day is enough — a scheduler that runs more than once a day, or
 * misses a day, still lands on the right reminder without double-sending.
 *
 * "Overdue" fires exactly once, the first day the due date has passed —
 * not a daily repeat — since the brief lists three distinct milestones,
 * not an escalating nag. See docs/decisions.md.
 */
export function reminderKindForDueDate(dueDateIso: string, todayIso: string): RfiReminderKind | null {
  const daysUntilDue = daysBetween(todayIso, dueDateIso);
  if (daysUntilDue === 3) return "due_minus_3";
  if (daysUntilDue === 0) return "due_date";
  if (daysUntilDue < 0) return "overdue";
  return null;
}
