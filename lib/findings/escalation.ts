import type { FindingPriority, FindingStatus } from "@/lib/db/findings";

export const ESCALATION_KINDS = ["owner_overdue_30", "admin_overdue_60", "admin_high_priority"] as const;
export type EscalationKind = (typeof ESCALATION_KINDS)[number];

function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((new Date(`${toIso}T00:00:00Z`).getTime() - new Date(`${fromIso}T00:00:00Z`).getTime()) / (24 * 60 * 60 * 1000));
}

export interface EscalationInput {
  status: FindingStatus;
  priority: FindingPriority;
  dueDate: string | null;
  today: string;
}

/**
 * Escalation rules (this prompt): "overdue by 30 days notifies the
 * assessment owner; overdue by 60 days or any high-priority safety
 * finding notifies an admin." Pure — given a finding's current state and
 * today's date, which escalation(s) apply right now. The caller
 * (lib/findings/send-escalations.ts) dedupes against
 * finding_escalations_sent's own unique (finding_id, kind) constraint,
 * the same insert-and-catch-the-unique-violation pattern as
 * lib/rfi/send-reminders.ts, so calling this once a day is enough.
 *
 * The two overdue thresholds are independent, not exclusive: a finding
 * 65 days overdue has already crossed both, and each still fires its own
 * one-time notification exactly once (dedupe is per-kind). A closed
 * finding is never escalated — there's nothing left to chase.
 *
 * "Any high-priority safety finding" fires the moment it's high
 * priority, independent of its due date — this platform has no separate
 * safety classification, so "high priority" (lib/findings/priority.ts:
 * a key requirement rated Not Compliant) is read as the safety signal
 * this rule means. See docs/decisions.md.
 */
export function escalationKindsFor(input: EscalationInput): EscalationKind[] {
  if (input.status === "closed") return [];

  const kinds: EscalationKind[] = [];
  if (input.priority === "high") kinds.push("admin_high_priority");

  if (input.dueDate) {
    const overdueDays = daysBetween(input.dueDate, input.today);
    if (overdueDays >= 30) kinds.push("owner_overdue_30");
    if (overdueDays >= 60) kinds.push("admin_overdue_60");
  }

  return kinds;
}
