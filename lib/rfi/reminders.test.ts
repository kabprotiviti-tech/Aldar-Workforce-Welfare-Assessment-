import { describe, expect, it } from "vitest";
import { reminderKindForDueDate } from "./reminders";

describe("reminderKindForDueDate", () => {
  it("returns due_minus_3 exactly 3 days before the due date", () => {
    expect(reminderKindForDueDate("2026-06-20", "2026-06-17")).toBe("due_minus_3");
  });

  it("returns due_date on the due date itself", () => {
    expect(reminderKindForDueDate("2026-06-20", "2026-06-20")).toBe("due_date");
  });

  it("returns overdue the day after the due date", () => {
    expect(reminderKindForDueDate("2026-06-20", "2026-06-21")).toBe("overdue");
  });

  it("keeps returning overdue for every day after (dedupe is the caller's job)", () => {
    expect(reminderKindForDueDate("2026-06-20", "2026-07-01")).toBe("overdue");
  });

  it("returns null on days with no reminder due", () => {
    expect(reminderKindForDueDate("2026-06-20", "2026-06-15")).toBeNull();
    expect(reminderKindForDueDate("2026-06-20", "2026-06-19")).toBeNull();
  });
});
