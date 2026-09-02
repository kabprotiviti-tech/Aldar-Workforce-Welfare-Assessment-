import { describe, expect, it } from "vitest";
import { R10_DOC_RETURN, R14_INSURANCE, R16_HOURS } from "./employment";
import type { CompiledRule, RuleInputs } from "../types";

function inputs(overrides: Partial<RuleInputs> = {}): RuleInputs {
  return { facts: {}, quantitative: {}, assessmentDate: "2026-06-01", ...overrides };
}

function run(rule: CompiledRule, given: Partial<RuleInputs>, thresholds?: unknown) {
  const outcome = rule.run(inputs(given), thresholds);
  if (!outcome.ok) throw new Error(`unexpected configuration error: ${outcome.configError}`);
  return outcome.result;
}

describe("R10_DOC_RETURN — 24 hours normally, 6 in an emergency", () => {
  it("passes a normal return inside 24 hours", () => {
    const result = run(R10_DOC_RETURN, { facts: { passport_return_hours: 4 }, quantitative: { passport_return_context: "normal" } });

    expect(result.outcome).toBe("pass");
    expect(result.computedExplanation).toBe(
      "Passport returned 4 hours after a normal request. Limit for a normal request is 24 hours. Within the limit.",
    );
  });

  it("passes at exactly the limit", () => {
    expect(run(R10_DOC_RETURN, { facts: { passport_return_hours: 24 }, quantitative: { passport_return_context: "normal" } }).outcome).toBe("pass");
    expect(run(R10_DOC_RETURN, { facts: { passport_return_hours: 6 }, quantitative: { passport_return_context: "emergency" } }).outcome).toBe("pass");
  });

  it("fails past the limit, stating by how much", () => {
    const result = run(R10_DOC_RETURN, { facts: { passport_return_hours: 30 }, quantitative: { passport_return_context: "normal" } });

    expect(result.outcome).toBe("fail");
    expect(result.computedExplanation).toContain("Over by 6 hours");
  });

  it("applies the shorter emergency limit", () => {
    const result = run(R10_DOC_RETURN, { facts: { passport_return_hours: 8 }, quantitative: { passport_return_context: "emergency" } });

    expect(result.outcome).toBe("fail");
    expect(result.observed.limit).toBe(6);
  });

  it("honours edited limits", () => {
    const result = run(
      R10_DOC_RETURN,
      { facts: { passport_return_hours: 30 }, quantitative: { passport_return_context: "normal" } },
      { maxHoursNormal: 48, maxHoursEmergency: 6 },
    );

    expect(result.outcome).toBe("pass");
  });

  it("returns insufficient_data naming what is missing", () => {
    expect(run(R10_DOC_RETURN, { quantitative: { passport_return_context: "normal" } }).missingKeys).toEqual(["passport_return_hours"]);
    expect(run(R10_DOC_RETURN, { facts: { passport_return_hours: 4 } }).missingKeys).toEqual(["passport_return_context"]);
    expect(
      run(R10_DOC_RETURN, { facts: { passport_return_hours: 4 }, quantitative: { passport_return_context: "urgent" } }).missingKeys,
    ).toEqual(["passport_return_context"]);
    expect(run(R10_DOC_RETURN, { facts: { passport_return_hours: 4 }, quantitative: { passport_return_context: 1 } }).missingKeys).toEqual([
      "passport_return_context",
    ]);
  });
});

describe("R14_INSURANCE — in force from day one, covering every emirate", () => {
  const allEmirates = ["Abu Dhabi", "Dubai", "Sharjah", "Ajman", "Umm Al Quwain", "Ras Al Khaimah", "Fujairah"];

  it("passes when cover starts on the employment start date and covers all seven", () => {
    const result = run(R14_INSURANCE, {
      facts: { insurance_policy_start_date: "2026-01-10", insurance_emirates_covered: allEmirates },
      quantitative: { employment_start_date: "2026-01-10" },
    });

    expect(result.outcome).toBe("pass");
    expect(result.computedExplanation).toBe(
      "Policy starts 2026-01-10; employment started 2026-01-10 (in force from day one). Emirates covered: 7 of 7. Compliant.",
    );
  });

  it("passes when cover starts before employment, noting how early", () => {
    const result = run(R14_INSURANCE, {
      facts: { insurance_policy_start_date: "2026-01-05", insurance_emirates_covered: allEmirates },
      quantitative: { employment_start_date: "2026-01-10" },
    });

    expect(result.outcome).toBe("pass");
    expect(result.computedExplanation).toContain("in force from day one, 5 days early");
  });

  it("fails when cover starts after employment, naming the uninsured gap", () => {
    const result = run(R14_INSURANCE, {
      facts: { insurance_policy_start_date: "2026-02-01", insurance_emirates_covered: allEmirates },
      quantitative: { employment_start_date: "2026-01-10" },
    });

    expect(result.outcome).toBe("fail");
    expect(result.computedExplanation).toContain("22 days uninsured");
    expect(result.computedExplanation).toContain("cover began 22 days late");
  });

  it("fails when an emirate is not covered, naming it", () => {
    const result = run(R14_INSURANCE, {
      facts: { insurance_policy_start_date: "2026-01-10", insurance_emirates_covered: allEmirates.slice(0, 5) },
      quantitative: { employment_start_date: "2026-01-10" },
    });

    expect(result.outcome).toBe("fail");
    expect(result.computedExplanation).toContain("(missing: ras_al_khaimah and fujairah)");
    expect(result.computedExplanation).toContain("2 emirates not covered");
  });

  it("allows a grace period when the threshold sets one", () => {
    const result = run(
      R14_INSURANCE,
      {
        facts: { insurance_policy_start_date: "2026-01-15", insurance_emirates_covered: allEmirates },
        quantitative: { employment_start_date: "2026-01-10" },
      },
      { requiredEmirates: ["abu_dhabi", "dubai", "sharjah", "ajman", "umm_al_quwain", "ras_al_khaimah", "fujairah"], maxDaysAfterEmploymentStart: 30 },
    );

    expect(result.outcome).toBe("pass");
  });

  it("returns insufficient_data naming every missing input", () => {
    const result = run(R14_INSURANCE, {});

    expect(result.outcome).toBe("insufficient_data");
    expect(result.missingKeys).toEqual(["insurance_policy_start_date", "insurance_emirates_covered", "employment_start_date"]);
  });
});

describe("R16_HOURS — 8 a day, 48 a week, 144 per 3 weeks, a day off in 7", () => {
  const withinLimits = {
    hours_per_day: 8,
    hours_per_week: 48,
    hours_per_three_weeks: 144,
    max_consecutive_days_worked: 6,
  };

  it("passes at exactly every limit", () => {
    const result = run(R16_HOURS, { quantitative: withinLimits });

    expect(result.outcome).toBe("pass");
    expect(result.computedExplanation).toBe(
      "Per day 8 of 8; per week 48 of 48; per 3 weeks 144 of 144; longest run without a day off 6 of 6 days. Within every limit.",
    );
  });

  it("fails each limit on its own, naming which", () => {
    const cases: Array<[Partial<typeof withinLimits>, string]> = [
      [{ hours_per_day: 9 }, "hours per day"],
      [{ hours_per_week: 49 }, "hours per week"],
      [{ hours_per_three_weeks: 145 }, "hours per 3 weeks"],
      [{ max_consecutive_days_worked: 7 }, "days worked without a rest day"],
    ];

    for (const [override, expected] of cases) {
      const result = run(R16_HOURS, { quantitative: { ...withinLimits, ...override } });
      expect(result.outcome).toBe("fail");
      expect(result.computedExplanation).toContain(`Exceeds ${expected}`);
    }
  });

  it("names every breach together", () => {
    const result = run(R16_HOURS, {
      quantitative: { hours_per_day: 11, hours_per_week: 66, hours_per_three_weeks: 198, max_consecutive_days_worked: 13 },
    });

    expect(result.observed.breaches).toEqual(["hours per day", "hours per week", "hours per 3 weeks", "days worked without a rest day"]);
    expect(result.computedExplanation).toContain(
      "Exceeds hours per day, hours per week, hours per 3 weeks and days worked without a rest day",
    );
  });

  it("honours edited limits", () => {
    const result = run(
      R16_HOURS,
      { quantitative: { ...withinLimits, hours_per_week: 54 } },
      { maxHoursPerDay: 9, maxHoursPerWeek: 54, maxHoursPerThreeWeeks: 162, maxConsecutiveDaysWorked: 6 },
    );

    expect(result.outcome).toBe("pass");
  });

  it("returns insufficient_data naming every missing figure", () => {
    const result = run(R16_HOURS, { quantitative: { hours_per_day: 8 } });

    expect(result.outcome).toBe("insufficient_data");
    expect(result.missingKeys).toEqual(["hours_per_week", "hours_per_three_weeks", "max_consecutive_days_worked"]);
  });
});
