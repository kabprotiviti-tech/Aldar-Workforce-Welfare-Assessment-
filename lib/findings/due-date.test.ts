import { describe, expect, it } from "vitest";
import { defaultFindingDueDate } from "./due-date";

describe("defaultFindingDueDate", () => {
  it("gives a high-priority finding 7 days", () => {
    expect(defaultFindingDueDate("high", "2026-06-01")).toBe("2026-06-08");
  });

  it("gives a medium-priority finding 14 days", () => {
    expect(defaultFindingDueDate("medium", "2026-06-01")).toBe("2026-06-15");
  });

  it("gives a low-priority finding 30 days", () => {
    expect(defaultFindingDueDate("low", "2026-06-01")).toBe("2026-07-01");
  });

  it("only uses the date portion of a full timestamp", () => {
    expect(defaultFindingDueDate("high", "2026-06-01T15:32:00.000Z")).toBe("2026-06-08");
  });
});
