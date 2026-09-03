import { describe, expect, it } from "vitest";
import { deadlineWarningKindForDueDate } from "./deadline-warnings";

describe("deadlineWarningKindForDueDate", () => {
  it("fires due_minus_3 exactly 3 days before the due date", () => {
    expect(deadlineWarningKindForDueDate("2026-03-10", "2026-03-07")).toBe("due_minus_3");
  });

  it("fires due_minus_1 exactly 1 day before the due date", () => {
    expect(deadlineWarningKindForDueDate("2026-03-10", "2026-03-09")).toBe("due_minus_1");
  });

  it("is null on the due date itself", () => {
    expect(deadlineWarningKindForDueDate("2026-03-10", "2026-03-10")).toBeNull();
  });

  it("is null once overdue", () => {
    expect(deadlineWarningKindForDueDate("2026-03-10", "2026-03-11")).toBeNull();
  });

  it("is null for any other day out (e.g. 2 or 4 days before)", () => {
    expect(deadlineWarningKindForDueDate("2026-03-10", "2026-03-08")).toBeNull();
    expect(deadlineWarningKindForDueDate("2026-03-10", "2026-03-06")).toBeNull();
  });
});
