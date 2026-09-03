import type { FindingPriority } from "@/lib/db/findings";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * A finding's SLA (this prompt: findings now carry a real due date, not
 * the unset column every finding got before this feature). Calendar
 * days from the day it's raised, not UAE working days — the same choice
 * already made for the RFI due date (lib/rfi/issue.ts), for the same
 * reason: nothing in this prompt asks for working-day arithmetic here.
 * Tighter for a higher priority, since priority already encodes how
 * badly the requirement failed.
 */
const DUE_DATE_SLA_DAYS: Record<FindingPriority, number> = {
  high: 7,
  medium: 14,
  low: 30,
};

/** raisedAtIso: an ISO date (YYYY-MM-DD) or timestamp — only the date portion is used. */
export function defaultFindingDueDate(priority: FindingPriority, raisedAtIso: string): string {
  const raised = new Date(`${raisedAtIso.slice(0, 10)}T00:00:00Z`);
  const due = new Date(raised.getTime() + DUE_DATE_SLA_DAYS[priority] * MS_PER_DAY);
  return due.toISOString().slice(0, 10);
}
