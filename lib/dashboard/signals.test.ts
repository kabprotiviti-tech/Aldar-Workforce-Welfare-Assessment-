import { describe, expect, it } from "vitest";
import {
  buildAtRiskDeadlinesSignal,
  buildEvidenceAwaitingReviewSignal,
  buildExpiringCertificatesSignal,
  buildOverdueActionsSignal,
  buildRepeatFindingsSignal,
} from "./signals";

describe("buildEvidenceAwaitingReviewSignal", () => {
  it("carries every row through with a drill-down link to its evidence library", () => {
    const signal = buildEvidenceAwaitingReviewSignal([
      { id: "e1", originalName: "payroll.pdf", subjectCode: "2026-EP-IN-1", assessmentId: "a1" },
    ]);
    expect(signal.kind).toBe("evidence_awaiting_review");
    expect(signal.query).toContain("review_status");
    expect(signal.items).toEqual([{ id: "e1", label: "payroll.pdf", detail: "2026-EP-IN-1", href: "/app/assessments/a1/evidence" }]);
  });
});

describe("buildOverdueActionsSignal", () => {
  it("keeps only findings whose due date has already passed", () => {
    const signal = buildOverdueActionsSignal(
      [
        { id: "f1", title: "Late wages", dueDate: "2026-01-01", subjectCode: "2026-EP-IN-1" },
        { id: "f2", title: "Not yet due", dueDate: "2026-06-01", subjectCode: "2026-EP-IN-2" },
      ],
      "2026-03-01",
    );
    expect(signal.items.map((i) => i.id)).toEqual(["f1"]);
  });
});

describe("buildAtRiskDeadlinesSignal", () => {
  it("keeps deadlines within the risk window, including already-overdue ones", () => {
    const signal = buildAtRiskDeadlinesSignal(
      [
        { assessmentId: "a1", subjectCode: "2026-EP-IN-1", reportDueDate: "2026-03-05" }, // 4 days out
        { assessmentId: "a2", subjectCode: "2026-EP-IN-2", reportDueDate: "2026-02-20" }, // overdue
        { assessmentId: "a3", subjectCode: "2026-EP-IN-3", reportDueDate: "2026-04-01" }, // far out
      ],
      "2026-03-01",
    );
    expect(signal.items.map((i) => i.id).sort()).toEqual(["a1", "a2"]);
  });

  it("includes a deadline exactly at the boundary of the risk window", () => {
    const signal = buildAtRiskDeadlinesSignal([{ assessmentId: "a1", subjectCode: "2026-EP-IN-1", reportDueDate: "2026-03-08" }], "2026-03-01");
    expect(signal.items).toHaveLength(1);
  });
});

describe("buildRepeatFindingsSignal", () => {
  it("passes through every row given (adapter already filters to open + repeat-linked)", () => {
    const signal = buildRepeatFindingsSignal([{ id: "f1", title: "Recurs", subjectCode: "2026-EP-IN-1", repeatOfFindingId: "f0" }]);
    expect(signal.items).toHaveLength(1);
    expect(signal.items[0]!.href).toBe("/app/findings?open=f1");
  });
});

describe("buildExpiringCertificatesSignal", () => {
  it("keeps only certificates expiring within the window", () => {
    const signal = buildExpiringCertificatesSignal(
      [
        { assessmentItemId: "i1", assessmentId: "a1", subjectCode: "2026-ACM-IN-1", certificateType: "Fire safety", validTo: "2026-03-15" }, // 14 days
        { assessmentItemId: "i2", assessmentId: "a2", subjectCode: "2026-ACM-IN-2", certificateType: "Utilities", validTo: "2026-08-01" }, // far out
      ],
      "2026-03-01",
    );
    expect(signal.items.map((i) => i.id)).toEqual(["i1"]);
    expect(signal.items[0]!.href).toBe("/app/assessments/a1");
  });

  it("also flags an already-expired certificate", () => {
    const signal = buildExpiringCertificatesSignal(
      [{ assessmentItemId: "i1", assessmentId: "a1", subjectCode: "2026-ACM-IN-1", certificateType: "Fire safety", validTo: "2026-01-01" }],
      "2026-03-01",
    );
    expect(signal.items).toHaveLength(1);
  });
});
