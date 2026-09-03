import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  boilerplateFor,
  buildCycleDiff,
  checkCarryForwardEligibility,
  detectRepeat,
  planCarryForwardDecision,
  previousFindingState,
  CARRY_FORWARD_BOILERPLATE,
} from "@/lib/assessment/carry-forward";

/**
 * This prompt's acceptance criterion: "The boilerplate strings match
 * CONTEXT.md character for character, tested." Parsed straight out of
 * CONTEXT.md rather than retyped into the test, so the two can never
 * quietly drift apart — a wording edit to CONTEXT.md that isn't
 * mirrored in the constant fails here, not in a report six months
 * later.
 */
function quotedStringAfter(source: string, label: string): string {
  const labelIndex = source.indexOf(label);
  if (labelIndex === -1) throw new Error(`"${label}" not found in CONTEXT.md`);
  const afterLabel = source.slice(labelIndex + label.length);
  const opening = afterLabel.indexOf('"');
  const closing = afterLabel.indexOf('"', opening + 1);
  // CONTEXT.md wraps the sentence across lines with a fixed indent; a
  // real remark is one paragraph, so the wrap's newline+indent collapses
  // to the single space it stands in for.
  return afterLabel
    .slice(opening + 1, closing)
    .replace(/\n\s*/g, " ")
    .trim();
}

describe("carry-forward boilerplate matches CONTEXT.md character for character", () => {
  const contextMd = readFileSync("CONTEXT.md", "utf8");
  const section = contextMd.slice(contextMd.indexOf("## Carry-forward boilerplate"), contextMd.indexOf("\n## Stack"));

  it("Employment Practices remarks", () => {
    const epSection = section.slice(0, section.indexOf("Accommodation, area"));
    expect(CARRY_FORWARD_BOILERPLATE.employment_practices!.remarks).toBe(quotedStringAfter(epSection, "Remarks: "));
  });

  it("Accommodation remarks", () => {
    const acmSection = section.slice(section.indexOf("Accommodation, area"));
    expect(CARRY_FORWARD_BOILERPLATE.accommodation!.remarks).toBe(quotedStringAfter(acmSection, "Remarks: "));
  });

  it("both actions-required-for-closure are the literal N/A CONTEXT.md gives", () => {
    expect(CARRY_FORWARD_BOILERPLATE.employment_practices!.actionRequired).toBe("N/A");
    expect(CARRY_FORWARD_BOILERPLATE.accommodation!.actionRequired).toBe("N/A");
    // And that CONTEXT.md itself still says exactly that, twice.
    expect(section.match(/Actions required for closure: "N\/A"/g)).toHaveLength(2);
  });

  it("has no boilerplate for onboarding, which CONTEXT.md never specifies", () => {
    expect(boilerplateFor("onboarding")).toBeNull();
    expect(section).not.toContain("Onboarding");
  });
});

describe("previousFindingState", () => {
  it("has none when no finding is on record", () => {
    expect(previousFindingState(null)).toBe("none");
  });

  it("is open for every non-closed finding status", () => {
    for (const status of ["open", "in_progress", "evidence_submitted", "under_review"] as const) {
      expect(previousFindingState(status)).toBe("open");
    }
  });

  it("is closed only for a formally closed finding", () => {
    expect(previousFindingState("closed")).toBe("closed");
  });
});

describe("checkCarryForwardEligibility", () => {
  it("is eligible when previously Compliant, with no finding at all", () => {
    expect(checkCarryForwardEligibility("Compliant", "none")).toEqual({ eligible: true, reason: null });
  });

  it("is eligible when previously Not Applicable", () => {
    expect(checkCarryForwardEligibility("Not Applicable", "none")).toEqual({ eligible: true, reason: null });
  });

  it("blocks a Partial item with an open finding, with an explanatory message — this prompt's own acceptance criterion", () => {
    const result = checkCarryForwardEligibility("Partial", "open");
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/open finding/i);
    expect(result.reason).toMatch(/must be assessed/i);
  });

  it("blocks a Not Compliant item with an open finding the same way", () => {
    const result = checkCarryForwardEligibility("Not Compliant", "open");
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/open finding/i);
  });

  it("blocks a Compliant item too if it somehow still carries an open finding — the block is unconditional on status", () => {
    expect(checkCarryForwardEligibility("Compliant", "open").eligible).toBe(false);
  });

  it("permits a Partial item once its finding has been formally closed", () => {
    expect(checkCarryForwardEligibility("Partial", "closed")).toEqual({ eligible: true, reason: null });
  });

  it("permits a Not Compliant item once its finding has been formally closed", () => {
    expect(checkCarryForwardEligibility("Not Compliant", "closed")).toEqual({ eligible: true, reason: null });
  });

  it("blocks a Partial item with no finding on record at all — carry-forward stands in for 'resolved', not 'unchecked'", () => {
    const result = checkCarryForwardEligibility("Partial", "none");
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/must be assessed/i);
  });

  it("blocks an item with no previous cycle", () => {
    expect(checkCarryForwardEligibility(null, "none").eligible).toBe(false);
  });
});

describe("planCarryForwardDecision", () => {
  it("writes the previous status verbatim and the module's exact boilerplate", () => {
    const result = planCarryForwardDecision("employment_practices", "Compliant", "none");
    expect(result).toEqual({
      ok: true,
      decision: { status: "Compliant", remarks: CARRY_FORWARD_BOILERPLATE.employment_practices!.remarks, actionRequired: "N/A" },
    });
  });

  it("writes the accommodation module's own wording", () => {
    const result = planCarryForwardDecision("accommodation", "Compliant", "none");
    expect(result.ok && result.decision.remarks).toBe(CARRY_FORWARD_BOILERPLATE.accommodation!.remarks);
  });

  it("refuses when not eligible, surfacing the same explanatory message", () => {
    const result = planCarryForwardDecision("employment_practices", "Partial", "open");
    expect(result).toEqual({ ok: false, message: expect.stringContaining("open finding") });
  });

  it("refuses for a module with no defined boilerplate even if otherwise eligible", () => {
    const result = planCarryForwardDecision("onboarding", "Compliant", "none");
    expect(result).toEqual({ ok: false, message: expect.stringContaining("no carry-forward wording") });
  });
});

describe("detectRepeat", () => {
  it("flags a repeat when a fresh failure follows a formally closed finding", () => {
    expect(detectRepeat("Partial", "finding-1", "closed")).toEqual({ isRepeat: true, repeatOfFindingId: "finding-1" });
    expect(detectRepeat("Not Compliant", "finding-1", "closed")).toEqual({ isRepeat: true, repeatOfFindingId: "finding-1" });
  });

  it("is not a repeat when the prior finding was never closed — it's the same issue continuing, not one recurring", () => {
    expect(detectRepeat("Partial", "finding-1", "open")).toEqual({ isRepeat: false, repeatOfFindingId: null });
  });

  it("is not a repeat when there was no prior finding at all", () => {
    expect(detectRepeat("Not Compliant", null, null)).toEqual({ isRepeat: false, repeatOfFindingId: null });
  });

  it("is never a repeat for a passing status, even against a closed finding", () => {
    expect(detectRepeat("Compliant", "finding-1", "closed")).toEqual({ isRepeat: false, repeatOfFindingId: null });
    expect(detectRepeat("Not Applicable", "finding-1", "closed")).toEqual({ isRepeat: false, repeatOfFindingId: null });
  });
});

describe("buildCycleDiff", () => {
  it("sorts by requirement and flags a status that changed", () => {
    const rows = buildCycleDiff([
      { requirementSlNo: 2, requirementTitle: "B", previousStatus: "Compliant", currentStatus: "Partial", wasAssessed: true },
      { requirementSlNo: 1, requirementTitle: "A", previousStatus: "Compliant", currentStatus: "Compliant", wasAssessed: false },
    ]);

    expect(rows.map((row) => row.requirementSlNo)).toEqual([1, 2]);
    expect(rows[0]!.changed).toBe(false);
    expect(rows[1]!.changed).toBe(true);
  });

  it("treats a first-ever assessment (no previous status) as changed the moment there's a current one", () => {
    const rows = buildCycleDiff([{ requirementSlNo: 1, requirementTitle: "A", previousStatus: null, currentStatus: "Compliant", wasAssessed: true }]);
    expect(rows[0]!.changed).toBe(true);
  });

  it("is not changed when nothing has a status yet on either side", () => {
    const rows = buildCycleDiff([{ requirementSlNo: 1, requirementTitle: "A", previousStatus: null, currentStatus: null, wasAssessed: false }]);
    expect(rows[0]!.changed).toBe(false);
  });
});
