import { describe, expect, it } from "vitest";
import { escalationKindsFor } from "./escalation";

describe("escalationKindsFor", () => {
  it("is empty for a finding not yet overdue and not high priority", () => {
    expect(escalationKindsFor({ status: "open", priority: "medium", dueDate: "2026-07-01", today: "2026-06-20" })).toEqual([]);
  });

  it("notifies the assessment owner at 30 days overdue", () => {
    expect(escalationKindsFor({ status: "in_progress", priority: "medium", dueDate: "2026-06-01", today: "2026-07-01" })).toEqual([
      "owner_overdue_30",
    ]);
  });

  it("notifies an admin at 60 days overdue, on top of the owner notification", () => {
    const kinds = escalationKindsFor({ status: "in_progress", priority: "medium", dueDate: "2026-06-01", today: "2026-07-31" });
    expect(kinds).toContain("owner_overdue_30");
    expect(kinds).toContain("admin_overdue_60");
  });

  it("notifies an admin immediately for a high-priority finding, regardless of due date", () => {
    expect(escalationKindsFor({ status: "open", priority: "high", dueDate: "2026-12-01", today: "2026-06-20" })).toEqual([
      "admin_high_priority",
    ]);
  });

  it("never escalates a closed finding", () => {
    expect(escalationKindsFor({ status: "closed", priority: "high", dueDate: "2026-01-01", today: "2026-12-31" })).toEqual([]);
  });

  it("a finding with no due date can still be escalated for high priority", () => {
    expect(escalationKindsFor({ status: "open", priority: "high", dueDate: null, today: "2026-06-20" })).toEqual(["admin_high_priority"]);
  });

  it("a finding with no due date and not high priority never escalates on overdue grounds", () => {
    expect(escalationKindsFor({ status: "open", priority: "low", dueDate: null, today: "2026-06-20" })).toEqual([]);
  });
});
