import { describe, expect, it } from "vitest";
import {
  canReopen,
  canRecordReviewDecision,
  canSubmitClosureEvidence,
  statusAfterClosureSubmitted,
  statusAfterReviewDecision,
  statusAfterWorkStarted,
  validateReviewDecision,
} from "./lifecycle";

describe("statusAfterWorkStarted", () => {
  it("moves open to in_progress", () => {
    expect(statusAfterWorkStarted("open")).toBe("in_progress");
  });

  it("leaves every other status unchanged", () => {
    expect(statusAfterWorkStarted("in_progress")).toBe("in_progress");
    expect(statusAfterWorkStarted("under_review")).toBe("under_review");
    expect(statusAfterWorkStarted("closed")).toBe("closed");
  });
});

describe("statusAfterClosureSubmitted", () => {
  it("always lands on under_review", () => {
    expect(statusAfterClosureSubmitted()).toBe("under_review");
  });
});

describe("canSubmitClosureEvidence / canRecordReviewDecision / canReopen", () => {
  it("closure evidence can be submitted at any status except closed", () => {
    expect(canSubmitClosureEvidence("open")).toBe(true);
    expect(canSubmitClosureEvidence("in_progress")).toBe(true);
    expect(canSubmitClosureEvidence("under_review")).toBe(true);
    expect(canSubmitClosureEvidence("closed")).toBe(false);
  });

  it("a review decision can only be recorded once evidence has been submitted", () => {
    expect(canRecordReviewDecision("open")).toBe(false);
    expect(canRecordReviewDecision("in_progress")).toBe(false);
    expect(canRecordReviewDecision("evidence_submitted")).toBe(true);
    expect(canRecordReviewDecision("under_review")).toBe(true);
    expect(canRecordReviewDecision("closed")).toBe(false);
  });

  it("only a closed finding can be reopened", () => {
    expect(canReopen("closed")).toBe(true);
    expect(canReopen("open")).toBe(false);
  });
});

describe("statusAfterReviewDecision", () => {
  it("accepted closes the finding", () => {
    expect(statusAfterReviewDecision("accepted")).toBe("closed");
  });

  it("rejected sends it back to in_progress — never anywhere that reads as resolved", () => {
    expect(statusAfterReviewDecision("rejected")).toBe("in_progress");
  });
});

describe("validateReviewDecision", () => {
  const base = { status: "under_review" as const, hasClosureEvidence: true, reason: null, newDueDate: null };

  it("rejects a decision when there's nothing under review yet", () => {
    const result = validateReviewDecision({ ...base, status: "open", decision: "accepted" });
    expect(result.ok).toBe(false);
  });

  it("blocks acceptance without closure evidence on record", () => {
    const result = validateReviewDecision({ ...base, decision: "accepted", hasClosureEvidence: false });
    expect(result).toEqual({ ok: false, message: "A finding cannot be closed without closure evidence on record." });
  });

  it("accepts once closure evidence is on record", () => {
    expect(validateReviewDecision({ ...base, decision: "accepted" })).toEqual({ ok: true });
  });

  it("requires a reason to reject", () => {
    const result = validateReviewDecision({ ...base, decision: "rejected", reason: null, newDueDate: "2026-07-01" });
    expect(result.ok).toBe(false);
  });

  it("requires a new due date to reject", () => {
    const result = validateReviewDecision({ ...base, decision: "rejected", reason: "Missing photos.", newDueDate: null });
    expect(result.ok).toBe(false);
  });

  it("a rejection with both a reason and a new due date is valid — this is what 'partial closure is not acceptance' looks like", () => {
    expect(validateReviewDecision({ ...base, decision: "rejected", reason: "Missing photos.", newDueDate: "2026-07-01" })).toEqual({ ok: true });
  });
});
