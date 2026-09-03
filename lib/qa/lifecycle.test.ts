import { describe, expect, it } from "vitest";
import { validateApprove, validateOpenReview, validateOpenRevision, validatePassReview, validateReturnToAssessor } from "./lifecycle";

describe("validateOpenReview", () => {
  it("allows opening from not_started", () => {
    expect(validateOpenReview("not_started")).toEqual({ ok: true });
  });
  it("allows reopening from returned", () => {
    expect(validateOpenReview("returned")).toEqual({ ok: true });
  });
  it("blocks opening a review already in progress", () => {
    expect(validateOpenReview("in_review").ok).toBe(false);
  });
  it("blocks opening a review that already passed", () => {
    expect(validateOpenReview("passed").ok).toBe(false);
  });
});

describe("validateReturnToAssessor", () => {
  it("requires the review to be open", () => {
    expect(validateReturnToAssessor("not_started", 1).ok).toBe(false);
  });
  it("requires at least one open query", () => {
    expect(validateReturnToAssessor("in_review", 0).ok).toBe(false);
  });
  it("allows returning with an open query", () => {
    expect(validateReturnToAssessor("in_review", 1)).toEqual({ ok: true });
  });
});

describe("validatePassReview", () => {
  it("requires the review to be open", () => {
    expect(validatePassReview("not_started", 0, true).ok).toBe(false);
  });
  it("blocks passing with an open query", () => {
    expect(validatePassReview("in_review", 1, true).ok).toBe(false);
  });
  it("blocks passing when the checklist hasn't passed", () => {
    expect(validatePassReview("in_review", 0, false).ok).toBe(false);
  });
  it("allows passing once every query is resolved and the checklist passes", () => {
    expect(validatePassReview("in_review", 0, true)).toEqual({ ok: true });
  });
});

describe("validateApprove", () => {
  it("requires awaiting_client", () => {
    expect(validateApprove("pending").ok).toBe(false);
    expect(validateApprove("approved").ok).toBe(false);
  });
  it("allows approval once awaiting_client", () => {
    expect(validateApprove("awaiting_client")).toEqual({ ok: true });
  });
});

describe("validateOpenRevision", () => {
  it("requires the assessment to be approved", () => {
    expect(validateOpenRevision("pending", "Client requested a correction.").ok).toBe(false);
  });
  it("requires a non-empty reason", () => {
    expect(validateOpenRevision("approved", "   ").ok).toBe(false);
  });
  it("allows a revision with a reason on an approved assessment", () => {
    expect(validateOpenRevision("approved", "Client requested a correction.")).toEqual({ ok: true });
  });
});
