import { describe, expect, it } from "vitest";
import { parseOvertimePremiumPct, R11_WAGE_DATE, R11_WPS_COVERAGE, R12_DEDUCTIONS, R13_OT_RATE } from "./wages";
import type { RuleInputs } from "../types";

function inputs(overrides: Partial<RuleInputs> = {}): RuleInputs {
  return { facts: {}, quantitative: {}, assessmentDate: "2026-06-01", ...overrides };
}

/** Every rule is exercised through run(), the same entry point the evaluation runner uses. */
function run(rule: typeof R11_WAGE_DATE, given: Partial<RuleInputs>, thresholds?: unknown) {
  const outcome = rule.run(inputs(given), thresholds);
  if (!outcome.ok) throw new Error(`unexpected configuration error: ${outcome.configError}`);
  return outcome.result;
}

describe("R11_WAGE_DATE — wages transferred by the 15th of the following month", () => {
  const wagePeriod = { wage_period_month: "2026-04" };

  it("passes when the transfer is before the deadline", () => {
    const result = run(R11_WAGE_DATE, { facts: { wps_transfer_date: "2026-05-03" }, quantitative: wagePeriod });

    expect(result.outcome).toBe("pass");
    expect(result.computedExplanation).toBe(
      "Wages for 2026-04 were transferred on 2026-05-03. Deadline is day 15 of the following month (2026-05-15). On or before the deadline.",
    );
  });

  it("passes on the 15th itself — the boundary", () => {
    const result = run(R11_WAGE_DATE, { facts: { wps_transfer_date: "2026-05-15" }, quantitative: wagePeriod });

    expect(result.outcome).toBe("pass");
    expect(result.observed.daysLate).toBe(0);
  });

  it("fails on the 16th, stating how late", () => {
    const result = run(R11_WAGE_DATE, { facts: { wps_transfer_date: "2026-05-16" }, quantitative: wagePeriod });

    expect(result.outcome).toBe("fail");
    expect(result.computedExplanation).toContain("Late by 1 day.");
  });

  it("fails a badly late transfer with the plural", () => {
    const result = run(R11_WAGE_DATE, { facts: { wps_transfer_date: "2026-06-01" }, quantitative: wagePeriod });

    expect(result.outcome).toBe("fail");
    expect(result.computedExplanation).toContain("Late by 17 days.");
  });

  it("rolls December's wage period into January of the next year", () => {
    const result = run(R11_WAGE_DATE, { facts: { wps_transfer_date: "2027-01-15" }, quantitative: { wage_period_month: "2026-12" } });

    expect(result.outcome).toBe("pass");
    expect(result.observed.deadline).toBe("2027-01-15");
  });

  it("clamps a deadline day past the end of a short month", () => {
    // A threshold of 31 must mean "the last day" of a 30-day month, not
    // roll into the month after.
    const result = run(
      R11_WAGE_DATE,
      { facts: { wps_transfer_date: "2026-04-30" }, quantitative: { wage_period_month: "2026-03" } },
      { deadlineDayOfFollowingMonth: 31 },
    );

    expect(result.observed.deadline).toBe("2026-04-30");
    expect(result.outcome).toBe("pass");
  });

  it("returns insufficient_data naming the missing transfer date", () => {
    const result = run(R11_WAGE_DATE, { quantitative: wagePeriod });

    expect(result.outcome).toBe("insufficient_data");
    expect(result.missingKeys).toEqual(["wps_transfer_date"]);
    expect(result.computedExplanation).toContain("is not a pass");
  });

  it("returns insufficient_data naming the missing wage period", () => {
    const result = run(R11_WAGE_DATE, { facts: { wps_transfer_date: "2026-05-03" } });

    expect(result.missingKeys).toEqual(["wage_period_month"]);
  });

  it("rejects stored thresholds that are not valid", () => {
    const outcome = R11_WAGE_DATE.run(inputs(), { deadlineDayOfFollowingMonth: 45 });

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.configError).toContain("R11_WAGE_DATE");
  });

  it("reports the thresholds it used, for stamping onto the evaluation", () => {
    const outcome = R11_WAGE_DATE.run(inputs({ facts: { wps_transfer_date: "2026-05-01" }, quantitative: wagePeriod }));

    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.thresholds).toEqual({ deadlineDayOfFollowingMonth: 15 });
  });
});

describe("R11_WPS_COVERAGE — every worker and every division", () => {
  const complete = {
    facts: { wps_record_count: 120 },
    quantitative: {
      worker_register_count: 120,
      expected_divisions: ["Civil", "MEP"],
      wps_divisions_present: ["Civil", "MEP"],
    },
  };

  it("passes when every worker and division is covered", () => {
    const result = run(R11_WPS_COVERAGE, complete);

    expect(result.outcome).toBe("pass");
    expect(result.computedExplanation).toBe(
      "WPS file lists 120 records against a worker register of 120 (100% coverage, minimum 100%). Divisions: 2 of 2 present. Fully covered.",
    );
  });

  it("fails when workers are missing from the file", () => {
    const result = run(R11_WPS_COVERAGE, { ...complete, facts: { wps_record_count: 118 } });

    expect(result.outcome).toBe("fail");
    expect(result.computedExplanation).toContain("2 worker(s) not covered");
  });

  it("fails when a division is absent, naming it", () => {
    const result = run(R11_WPS_COVERAGE, {
      ...complete,
      quantitative: { ...complete.quantitative, wps_divisions_present: ["Civil"] },
    });

    expect(result.outcome).toBe("fail");
    expect(result.computedExplanation).toContain("(missing: MEP)");
    expect(result.computedExplanation).toContain("1 division absent");
  });

  it("reports both failures together", () => {
    const result = run(R11_WPS_COVERAGE, {
      facts: { wps_record_count: 100 },
      quantitative: { ...complete.quantitative, wps_divisions_present: ["Civil"] },
    });

    expect(result.computedExplanation).toContain("20 worker(s) not covered and 1 division absent");
  });

  it("ignores absent divisions when the threshold does not require them all", () => {
    const result = run(
      R11_WPS_COVERAGE,
      { ...complete, quantitative: { ...complete.quantitative, wps_divisions_present: ["Civil"] } },
      { minCoverageRatio: 1, requireAllDivisions: false },
    );

    expect(result.outcome).toBe("pass");
  });

  it("accepts partial coverage when the threshold allows it", () => {
    const result = run(R11_WPS_COVERAGE, { ...complete, facts: { wps_record_count: 114 } }, { minCoverageRatio: 0.95, requireAllDivisions: true });

    expect(result.outcome).toBe("pass");
    expect(result.computedExplanation).toContain("95% coverage, minimum 95%");
  });

  it("returns insufficient_data when the register count is zero rather than dividing by it", () => {
    const result = run(R11_WPS_COVERAGE, { ...complete, quantitative: { ...complete.quantitative, worker_register_count: 0 } });

    expect(result.outcome).toBe("insufficient_data");
    expect(result.missingKeys).toEqual([]);
    expect(result.computedExplanation).toContain("worker register count is zero");
  });

  it("names every missing input", () => {
    const result = run(R11_WPS_COVERAGE, {});

    expect(result.outcome).toBe("insufficient_data");
    expect(result.missingKeys).toEqual(["wps_record_count", "worker_register_count", "expected_divisions", "wps_divisions_present"]);
  });
});

describe("R12_DEDUCTIONS — no prohibited deduction types", () => {
  it("passes when no deduction is prohibited", () => {
    const result = run(R12_DEDUCTIONS, { facts: { payroll_deduction_types: ["Salary advance", "Accommodation"] } });

    expect(result.outcome).toBe("pass");
    expect(result.computedExplanation).toBe(
      "Deductions recorded: Salary advance and Accommodation. Prohibited types: ppe, transport, work_permit and emirates_id. Found: none. No prohibited deductions.",
    );
  });

  it("fails on an exact prohibited type", () => {
    const result = run(R12_DEDUCTIONS, { facts: { payroll_deduction_types: ["Emirates ID"] } });

    expect(result.outcome).toBe("fail");
    expect(result.computedExplanation).toContain("Found: Emirates ID");
    expect(result.computedExplanation).toContain("1 prohibited deduction applied");
  });

  it("fails when a prohibited type appears as a word inside the label", () => {
    const result = run(R12_DEDUCTIONS, { facts: { payroll_deduction_types: ["PPE charges", "Work permit fee"] } });

    expect(result.outcome).toBe("fail");
    expect(result.observed.offending).toEqual(["PPE charges", "Work permit fee"]);
    expect(result.computedExplanation).toContain("2 prohibited deductions applied");
  });

  it("reads a comma-separated string as a list", () => {
    const result = run(R12_DEDUCTIONS, { facts: { payroll_deduction_types: "Transport, Accommodation" } });

    expect(result.outcome).toBe("fail");
    expect(result.observed.offending).toEqual(["Transport"]);
  });

  it("honours an edited prohibited list", () => {
    const result = run(R12_DEDUCTIONS, { facts: { payroll_deduction_types: ["Accommodation"] } }, { prohibitedTypes: ["accommodation"] });

    expect(result.outcome).toBe("fail");
  });

  it("returns insufficient_data naming the missing fact", () => {
    const result = run(R12_DEDUCTIONS, {});

    expect(result.outcome).toBe("insufficient_data");
    expect(result.missingKeys).toEqual(["payroll_deduction_types"]);
  });
});

describe("parseOvertimePremiumPct", () => {
  it("reads a multiplier, with or without the x", () => {
    expect(parseOvertimePremiumPct("1.25x")).toBe(25);
    expect(parseOvertimePremiumPct("1.5")).toBe(50);
    expect(parseOvertimePremiumPct(1.25)).toBe(25);
  });

  it("reads a percentage at or above 100 as a multiplier", () => {
    expect(parseOvertimePremiumPct("125%")).toBe(25);
    expect(parseOvertimePremiumPct("100%")).toBe(0);
  });

  it("reads a percentage below 100 as the premium itself", () => {
    expect(parseOvertimePremiumPct("25%")).toBe(25);
    expect(parseOvertimePremiumPct("50 %")).toBe(50);
  });

  it("refuses a multiplier below 1, which would be a pay cut", () => {
    expect(parseOvertimePremiumPct(0.5)).toBeNull();
    expect(parseOvertimePremiumPct("0.5x")).toBeNull();
  });

  it("refuses anything it cannot read", () => {
    expect(parseOvertimePremiumPct("time and a half")).toBeNull();
    expect(parseOvertimePremiumPct("")).toBeNull();
    expect(parseOvertimePremiumPct("   ")).toBeNull();
    expect(parseOvertimePremiumPct(true)).toBeNull();
    expect(parseOvertimePremiumPct(Number.NaN)).toBeNull();
    expect(parseOvertimePremiumPct(["1.25x"])).toBeNull();
  });
});

describe("R13_OT_RATE — 50% enhanced, 25% standard", () => {
  it("passes standard overtime at 25%", () => {
    const result = run(R13_OT_RATE, { facts: { overtime_rate_applied: "1.25x" }, quantitative: { overtime_category: "standard" } });

    expect(result.outcome).toBe("pass");
    expect(result.computedExplanation).toBe(
      "Overtime worked on standard: 25% premium applied against a minimum of 25% (ordinary overtime hours). Meets the minimum premium.",
    );
  });

  it("fails standard overtime below 25%", () => {
    const result = run(R13_OT_RATE, { facts: { overtime_rate_applied: "1.1x" }, quantitative: { overtime_category: "standard" } });

    expect(result.outcome).toBe("fail");
    expect(result.computedExplanation).toContain("Short by 15.00 percentage points");
  });

  it("requires 50% on a rest day, a public holiday and at night", () => {
    for (const category of ["rest_day", "public_holiday", "night"]) {
      const short = run(R13_OT_RATE, { facts: { overtime_rate_applied: "1.25x" }, quantitative: { overtime_category: category } });
      expect(short.outcome).toBe("fail");
      expect(short.observed.requiredPct).toBe(50);

      const met = run(R13_OT_RATE, { facts: { overtime_rate_applied: "1.5x" }, quantitative: { overtime_category: category } });
      expect(met.outcome).toBe("pass");
    }
  });

  it("names the night window in the explanation", () => {
    const result = run(R13_OT_RATE, { facts: { overtime_rate_applied: "1.5x" }, quantitative: { overtime_category: "night" } });

    expect(result.computedExplanation).toContain("rest day, public holiday or 22:00-04:00");
  });

  it("accepts a category written with spaces or capitals", () => {
    const result = run(R13_OT_RATE, { facts: { overtime_rate_applied: "1.5x" }, quantitative: { overtime_category: "Rest Day" } });

    expect(result.outcome).toBe("pass");
    expect(result.observed.category).toBe("rest_day");
  });

  it("returns insufficient_data for an unrecognised category, naming the key", () => {
    const result = run(R13_OT_RATE, { facts: { overtime_rate_applied: "1.5x" }, quantitative: { overtime_category: "weekend-ish" } });

    expect(result.outcome).toBe("insufficient_data");
    expect(result.missingKeys).toEqual(["overtime_category"]);
  });

  it("returns insufficient_data for a category of the wrong type", () => {
    const result = run(R13_OT_RATE, { facts: { overtime_rate_applied: "1.5x" }, quantitative: { overtime_category: 3 } });

    expect(result.missingKeys).toEqual(["overtime_category"]);
  });

  it("returns insufficient_data for an unreadable rate, naming the key", () => {
    const result = run(R13_OT_RATE, { facts: { overtime_rate_applied: "time and a half" }, quantitative: { overtime_category: "standard" } });

    expect(result.missingKeys).toEqual(["overtime_rate_applied"]);
  });
});
