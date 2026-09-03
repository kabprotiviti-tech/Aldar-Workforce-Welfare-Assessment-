import { describe, expect, it } from "vitest";
import { deriveLifecycleStage, groupByLifecycleStage, LIFECYCLE_STAGES, type LifecycleSignals } from "./lifecycle";

function signals(overrides: Partial<Omit<LifecycleSignals, "assessmentId">> = {}): Omit<LifecycleSignals, "assessmentId"> {
  return {
    hasIssuedRfi: false,
    hasOpenRfi: false,
    confirmedVisitDate: null,
    actualVisitDate: null,
    totalItems: 0,
    decidedItems: 0,
    issuedAt: null,
    openFindingsCount: 0,
    ...overrides,
  };
}

describe("deriveLifecycleStage", () => {
  it("is plan when nothing has happened yet", () => {
    expect(deriveLifecycleStage(signals())).toBe("plan");
  });

  it("is request while an RFI is open", () => {
    expect(deriveLifecycleStage(signals({ hasIssuedRfi: true, hasOpenRfi: true }))).toBe("request");
  });

  it("is collect once every issued RFI is resolved, before a visit is confirmed", () => {
    expect(deriveLifecycleStage(signals({ hasIssuedRfi: true, hasOpenRfi: false }))).toBe("collect");
  });

  it("is review once a visit is confirmed but hasn't happened yet", () => {
    expect(deriveLifecycleStage(signals({ hasIssuedRfi: true, confirmedVisitDate: "2026-03-01" }))).toBe("review");
  });

  it("is assess once the visit actually happened, decisions still incomplete", () => {
    expect(deriveLifecycleStage(signals({ actualVisitDate: "2026-03-05", totalItems: 23, decidedItems: 10 }))).toBe("assess");
  });

  it("is report once every requirement is decided but not yet issued", () => {
    expect(deriveLifecycleStage(signals({ actualVisitDate: "2026-03-05", totalItems: 23, decidedItems: 23 }))).toBe("report");
  });

  it("never reports 'report' for an assessment with zero generated items, even though decidedItems >= totalItems trivially", () => {
    expect(deriveLifecycleStage(signals({ totalItems: 0, decidedItems: 0 }))).toBe("plan");
  });

  it("is act once issued with at least one open finding", () => {
    expect(deriveLifecycleStage(signals({ issuedAt: "2026-04-01T00:00:00Z", openFindingsCount: 1 }))).toBe("act");
  });

  it("is monitor once issued with no open findings", () => {
    expect(deriveLifecycleStage(signals({ issuedAt: "2026-04-01T00:00:00Z", openFindingsCount: 0 }))).toBe("monitor");
  });

  it("issued always wins over an in-progress reassessment's other signals", () => {
    expect(
      deriveLifecycleStage(
        signals({ issuedAt: "2026-04-01T00:00:00Z", openFindingsCount: 0, hasOpenRfi: true, totalItems: 23, decidedItems: 5 }),
      ),
    ).toBe("monitor");
  });
});

describe("groupByLifecycleStage", () => {
  it("counts and lists every assessment id under its derived stage, covering every stage even at zero", () => {
    const groups = groupByLifecycleStage([
      { assessmentId: "a1", ...signals() },
      { assessmentId: "a2", ...signals({ hasIssuedRfi: true, hasOpenRfi: true }) },
      { assessmentId: "a3", ...signals({ issuedAt: "2026-04-01T00:00:00Z", openFindingsCount: 2 }) },
    ]);

    expect(groups.map((g) => g.stage)).toEqual([...LIFECYCLE_STAGES]);
    const byStage = new Map(groups.map((g) => [g.stage, g]));
    expect(byStage.get("plan")).toEqual({ stage: "plan", count: 1, assessmentIds: ["a1"] });
    expect(byStage.get("request")).toEqual({ stage: "request", count: 1, assessmentIds: ["a2"] });
    expect(byStage.get("act")).toEqual({ stage: "act", count: 1, assessmentIds: ["a3"] });
    expect(byStage.get("collect")).toEqual({ stage: "collect", count: 0, assessmentIds: [] });
  });

  it("handles an empty portfolio without throwing", () => {
    const groups = groupByLifecycleStage([]);
    expect(groups.every((g) => g.count === 0)).toBe(true);
  });
});
