/**
 * "3-day/1-day deadline warnings" (this prompt) for a report due date
 * (`assessments.report_due_date`) — distinct from the RFI reminder
 * schedule (lib/rfi/reminders.ts), which warns about a document
 * deadline, not the report itself. Same pure "given today and a due
 * date, which warning (if any) fires today" shape.
 */

export const DEADLINE_WARNING_KINDS = ["due_minus_3", "due_minus_1"] as const;
export type DeadlineWarningKind = (typeof DEADLINE_WARNING_KINDS)[number];

function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((new Date(`${toIso}T00:00:00Z`).getTime() - new Date(`${fromIso}T00:00:00Z`).getTime()) / (24 * 60 * 60 * 1000));
}

export function deadlineWarningKindForDueDate(dueDateIso: string, todayIso: string): DeadlineWarningKind | null {
  const daysUntilDue = daysBetween(todayIso, dueDateIso);
  if (daysUntilDue === 3) return "due_minus_3";
  if (daysUntilDue === 1) return "due_minus_1";
  return null;
}
