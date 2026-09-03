import { describe, expect, it } from "vitest";
import { buildFindingHistory, outcomeForStatus } from "./history";

describe("outcomeForStatus", () => {
  it("maps open to raised", () => {
    expect(outcomeForStatus("open")).toBe("raised");
  });
  it("maps closed to closed", () => {
    expect(outcomeForStatus("closed")).toBe("closed");
  });
  it("maps every in-between status to actioned", () => {
    expect(outcomeForStatus("in_progress")).toBe("actioned");
    expect(outcomeForStatus("evidence_submitted")).toBe("actioned");
    expect(outcomeForStatus("under_review")).toBe("actioned");
  });
});

describe("buildFindingHistory", () => {
  it("orders oldest first and labels outcome + recurrence per finding", () => {
    const history = buildFindingHistory([
      { id: "b", createdAt: "2026-06-01T00:00:00Z", status: "closed", repeatOfFindingId: null },
      { id: "a", createdAt: "2025-01-01T00:00:00Z", status: "closed", repeatOfFindingId: null },
      { id: "c", createdAt: "2026-12-01T00:00:00Z", status: "open", repeatOfFindingId: "b" },
    ]);

    expect(history.map((entry) => entry.id)).toEqual(["a", "b", "c"]);
    expect(history[2]).toMatchObject({ id: "c", outcome: "raised", isRecurrence: true });
    expect(history[1]).toMatchObject({ id: "b", outcome: "closed", isRecurrence: false });
  });
});
