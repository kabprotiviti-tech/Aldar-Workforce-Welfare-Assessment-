import { describe, expect, it } from "vitest";
import { z } from "zod";
import { allInputFactKeys, COMPLIANCE_RULES, getRule, rulesForModule } from "./registry";
import { defineRule, type RuleInputs } from "./types";

const EXPECTED_CODES = [
  "R08_AGENCY_CLAUSE",
  "R10_DOC_RETURN",
  "R11_WAGE_DATE",
  "R11_WPS_COVERAGE",
  "R12_DEDUCTIONS",
  "R13_OT_RATE",
  "R14_INSURANCE",
  "R16_HOURS",
  "R18_CD_CERT",
  "R18_ROOM_AREA",
  "R18_ROOM_HEADCOUNT",
  "R19_VEHICLE_REG",
  "ACM_TOILET_RATIO",
];

describe("the v1 rule registry", () => {
  it("contains exactly the rules this prompt asks for", () => {
    expect(COMPLIANCE_RULES.map((rule) => rule.code).sort()).toEqual([...EXPECTED_CODES].sort());
  });

  it("gives every rule a unique code", () => {
    const codes = COMPLIANCE_RULES.map((rule) => rule.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("declares a title, a legal reference, an explanation template and thresholds on every rule", () => {
    for (const rule of COMPLIANCE_RULES) {
      expect(rule.title.length).toBeGreaterThan(0);
      expect(rule.legalReference.length).toBeGreaterThan(0);
      expect(rule.explanationTemplate).toMatch(/\{verdict\}/);
      expect(rule.defaultThresholds).toBeTypeOf("object");
      expect(Object.keys(rule.defaultThresholds as object).length).toBeGreaterThan(0);
    }
  });

  it("declares at least one input on every rule", () => {
    for (const rule of COMPLIANCE_RULES) {
      expect(rule.inputFactKeys.length + rule.quantitativeKeys.length).toBeGreaterThan(0);
    }
  });

  it("maps each R** code to the checklist requirement its number names", () => {
    for (const rule of COMPLIANCE_RULES) {
      const match = /^R(\d{2})_/.exec(rule.code);
      if (match) {
        expect(rule.module).toBe("employment_practices");
        expect(rule.requirementSlNo).toBe(Number(match[1]));
      }
    }
  });

  it("puts the ACM_** rule in the accommodation module", () => {
    expect(getRule("ACM_TOILET_RATIO")?.module).toBe("accommodation");
  });

  it("looks a rule up by code, and reports an unknown code as null", () => {
    expect(getRule("R18_ROOM_AREA")?.title).toBe("Floor area per resident meets the minimum");
    expect(getRule("NOT_A_RULE")).toBeNull();
  });

  it("filters by module", () => {
    expect(rulesForModule("accommodation").map((rule) => rule.code)).toEqual(["ACM_TOILET_RATIO"]);
    expect(rulesForModule("employment_practices")).toHaveLength(12);
    expect(rulesForModule("onboarding")).toEqual([]);
  });

  it("lists every fact key the engine reads, deduplicated and sorted", () => {
    const keys = allInputFactKeys();

    expect(keys).toContain("wps_transfer_date");
    expect(keys).toContain("occupancy_headcount");
    expect(new Set(keys).size).toBe(keys.length);
    expect([...keys].sort()).toEqual(keys);
  });
});

describe("defineRule", () => {
  const rule = defineRule({
    code: "TEST_RULE",
    title: "A rule for testing the wrapper",
    module: "employment_practices",
    requirementSlNo: 1,
    inputFactKeys: ["some_fact"],
    quantitativeKeys: [],
    defaultThresholds: { limit: 10 },
    thresholdsSchema: z.object({ limit: z.number().int().min(1) }),
    legalReference: "test",
    explanationTemplate: "{limit}",
    evaluate(_inputs, thresholds) {
      return { outcome: "pass", computedExplanation: `limit ${thresholds.limit}`, missingKeys: [], observed: { limit: thresholds.limit } };
    },
  });

  const inputs: RuleInputs = { facts: {}, quantitative: {}, assessmentDate: "2026-06-01" };

  it("uses the declared defaults when no stored thresholds are given", () => {
    const outcome = rule.run(inputs);

    expect(outcome).toEqual({
      ok: true,
      result: { outcome: "pass", computedExplanation: "limit 10", missingKeys: [], observed: { limit: 10 } },
      thresholds: { limit: 10 },
    });
  });

  it("uses validated stored thresholds and reports them back for stamping", () => {
    const outcome = rule.run(inputs, { limit: 25 });

    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.result.computedExplanation).toBe("limit 25");
      expect(outcome.thresholds).toEqual({ limit: 25 });
    }
  });

  it("reports a configuration error rather than silently falling back to defaults", () => {
    // Falling back would stamp the evaluation with one threshold while
    // computing it with another.
    const outcome = rule.run(inputs, { limit: 0 });

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.configError).toContain("TEST_RULE");
      expect(outcome.configError).toContain("limit");
    }
  });

  it("reports a configuration error for thresholds of the wrong shape entirely", () => {
    const outcome = rule.run(inputs, "not an object");

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.configError).toContain("(root)");
  });
});
