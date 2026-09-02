import { describe, expect, it } from "vitest";
import { R08_AGENCY_CLAUSE, R19_VEHICLE_REG } from "./assets";
import type { CompiledRule, RuleInputs } from "../types";

function inputs(overrides: Partial<RuleInputs> = {}): RuleInputs {
  return { facts: {}, quantitative: {}, assessmentDate: "2026-06-01", ...overrides };
}

function run(rule: CompiledRule, given: Partial<RuleInputs>, thresholds?: unknown) {
  const outcome = rule.run(inputs(given), thresholds);
  if (!outcome.ok) throw new Error(`unexpected configuration error: ${outcome.configError}`);
  return outcome.result;
}

describe("R19_VEHICLE_REG — every registration valid at the assessment date", () => {
  it("passes a fleet where every registration outlasts the assessment date", () => {
    const result = run(R19_VEHICLE_REG, {
      quantitative: {
        vehicle_registrations: [
          { reference: "AD-12345", expiry_date: "2026-11-01" },
          { reference: "AD-67890", expiry_date: "2027-01-15" },
        ],
      },
    });

    expect(result.outcome).toBe("pass");
    expect(result.computedExplanation).toBe(
      "2 vehicle registrations checked against the assessment date 2026-06-01: 0 expired or expiring. Registration must remain valid at least 0 day(s) beyond the assessment date. All valid.",
    );
  });

  it("fails the whole fleet when one vehicle has expired, naming it", () => {
    const result = run(R19_VEHICLE_REG, {
      quantitative: {
        vehicle_registrations: [
          { reference: "AD-12345", expiry_date: "2026-11-01" },
          { reference: "AD-67890", expiry_date: "2026-03-01" },
        ],
      },
    });

    expect(result.outcome).toBe("fail");
    expect(result.computedExplanation).toContain("(AD-67890 on 2026-03-01)");
    expect(result.computedExplanation).toContain("1 registration not valid");
  });

  it("fails a registration expiring on the assessment date itself", () => {
    const result = run(R19_VEHICLE_REG, { quantitative: { vehicle_registrations: [{ reference: "AD-1", expiry_date: "2026-06-01" }] } });

    expect(result.outcome).toBe("fail");
  });

  it("includes the single registration document the model read", () => {
    const result = run(R19_VEHICLE_REG, { facts: { vehicle_registration_expiry_date: "2026-05-01" } });

    expect(result.outcome).toBe("fail");
    expect(result.computedExplanation).toContain("1 vehicle registration checked");
    expect(result.computedExplanation).toContain("registration document on 2026-05-01");
  });

  it("does not double-count a document already present in the fleet list", () => {
    const result = run(R19_VEHICLE_REG, {
      facts: { vehicle_registration_expiry_date: "2026-11-01" },
      quantitative: { vehicle_registrations: [{ reference: "AD-12345", expiry_date: "2026-11-01" }] },
    });

    expect(result.observed.subjects).toHaveLength(1);
  });

  it("can require remaining validity beyond the assessment date", () => {
    const fleet = { quantitative: { vehicle_registrations: [{ reference: "AD-1", expiry_date: "2026-06-20" }] } };

    expect(run(R19_VEHICLE_REG, fleet).outcome).toBe("pass");
    expect(run(R19_VEHICLE_REG, fleet, { minDaysValidAfterAssessment: 30 }).outcome).toBe("fail");
  });

  it("returns insufficient_data when nothing is known", () => {
    const result = run(R19_VEHICLE_REG, {});

    expect(result.outcome).toBe("insufficient_data");
    expect(result.missingKeys).toEqual(["vehicle_registrations or vehicle_registration_expiry_date"]);
  });

  it("returns insufficient_data when every entry was unreadable, saying so", () => {
    const result = run(R19_VEHICLE_REG, { quantitative: { vehicle_registrations: [{ reference: "AD-1" }, { expiry_date: "nonsense" }] } });

    expect(result.outcome).toBe("insufficient_data");
    expect(result.computedExplanation).toContain("2 entries could not be read");
  });

  it("refuses to clear a fleet where some entries could not be read", () => {
    // The unreadable entry might be the expired one — a pass here would
    // be a guess.
    const result = run(R19_VEHICLE_REG, {
      quantitative: {
        vehicle_registrations: [{ reference: "AD-1", expiry_date: "2026-11-01" }, { reference: "AD-2", expiry_date: "not-a-date" }],
      },
    });

    expect(result.outcome).toBe("insufficient_data");
    expect(result.computedExplanation).toContain("1 entry could not be read");
  });

  it("still fails when an expired vehicle sits alongside an unreadable entry", () => {
    const result = run(R19_VEHICLE_REG, {
      quantitative: {
        vehicle_registrations: [{ reference: "AD-1", expiry_date: "2026-01-01" }, { reference: "AD-2", expiry_date: "not-a-date" }],
      },
    });

    expect(result.outcome).toBe("fail");
    expect(result.observed.malformed).toBe(1);
  });

  it("ignores a quantitative value that is not a list at all", () => {
    const result = run(R19_VEHICLE_REG, { quantitative: { vehicle_registrations: "AD-12345" } });

    expect(result.outcome).toBe("insufficient_data");
    expect(result.missingKeys).toEqual(["vehicle_registrations or vehicle_registration_expiry_date"]);
  });
});

describe("R08_AGENCY_CLAUSE — employer-pays clause on every agreement", () => {
  it("passes when every agreement carries the clause", () => {
    const result = run(R08_AGENCY_CLAUSE, {
      quantitative: {
        agency_agreements: [
          { agency_name: "Gulf Recruit", clause_present: true },
          { agency_name: "Falcon Manpower", clause_present: true },
        ],
      },
    });

    expect(result.outcome).toBe("pass");
    expect(result.computedExplanation).toBe(
      "2 agency agreements checked: employer-pays clause present on 2, absent on 0. The clause is required on every agreement. Requirement met.",
    );
  });

  it("fails when one agreement lacks the clause, naming the agency", () => {
    const result = run(R08_AGENCY_CLAUSE, {
      quantitative: {
        agency_agreements: [
          { agency_name: "Gulf Recruit", clause_present: true },
          { agency_name: "Falcon Manpower", clause_present: false },
        ],
      },
    });

    expect(result.outcome).toBe("fail");
    expect(result.computedExplanation).toContain("absent on 1 (Falcon Manpower)");
    expect(result.computedExplanation).toContain("Requirement not met");
  });

  it("treats a confirmed absent clause on the extracted document as a fail, not a gap", () => {
    const result = run(R08_AGENCY_CLAUSE, {
      facts: { agency_employer_pays_clause_present: false, agency_name: "Gulf Recruit" },
    });

    expect(result.outcome).toBe("fail");
    expect(result.observed.absent).toEqual([{ agencyName: "Gulf Recruit", clausePresent: false }]);
  });

  it("labels the extracted document when no agency name was captured", () => {
    const result = run(R08_AGENCY_CLAUSE, { facts: { agency_employer_pays_clause_present: true } });

    expect(result.outcome).toBe("pass");
    expect(result.computedExplanation).toContain("1 agency agreement checked");
    expect(result.observed.subjects).toEqual([{ agencyName: "agreement on file", clausePresent: true }]);
  });

  it("does not double-count an agency already in the assessor's list", () => {
    const result = run(R08_AGENCY_CLAUSE, {
      facts: { agency_employer_pays_clause_present: true, agency_name: "Gulf Recruit" },
      quantitative: { agency_agreements: [{ agency_name: "Gulf Recruit", clause_present: false }] },
    });

    // The assessor's own record stands; the extracted duplicate is not
    // added a second time.
    expect(result.observed.subjects).toHaveLength(1);
    expect(result.outcome).toBe("fail");
  });

  it("can require the clause on only one agreement", () => {
    const mixed = {
      quantitative: {
        agency_agreements: [
          { agency_name: "Gulf Recruit", clause_present: true },
          { agency_name: "Falcon Manpower", clause_present: false },
        ],
      },
    };

    expect(run(R08_AGENCY_CLAUSE, mixed).outcome).toBe("fail");
    expect(run(R08_AGENCY_CLAUSE, mixed, { requireOnEveryAgreement: false }).outcome).toBe("pass");
  });

  it("fails when the only agreements known all lack the clause, even under the looser threshold", () => {
    const result = run(
      R08_AGENCY_CLAUSE,
      { quantitative: { agency_agreements: [{ agency_name: "Gulf Recruit", clause_present: false }] } },
      { requireOnEveryAgreement: false },
    );

    expect(result.outcome).toBe("fail");
  });

  it("returns insufficient_data when no agreement is known", () => {
    const result = run(R08_AGENCY_CLAUSE, {});

    expect(result.outcome).toBe("insufficient_data");
    expect(result.missingKeys).toEqual(["agency_agreements or agency_employer_pays_clause_present"]);
  });

  it("returns insufficient_data when every entry was unreadable, saying so", () => {
    const result = run(R08_AGENCY_CLAUSE, { quantitative: { agency_agreements: [{ agency_name: "Gulf Recruit" }, "Falcon"] } });

    expect(result.outcome).toBe("insufficient_data");
    expect(result.computedExplanation).toContain("2 entries could not be read");
  });

  it("refuses to clear a set where some entries could not be read", () => {
    const result = run(R08_AGENCY_CLAUSE, {
      quantitative: { agency_agreements: [{ agency_name: "Gulf Recruit", clause_present: true }, { agency_name: "Falcon Manpower" }] },
    });

    expect(result.outcome).toBe("insufficient_data");
    expect(result.computedExplanation).toContain("1 entry could not be read");
  });

  it("ignores a quantitative value that is not a list at all", () => {
    const result = run(R08_AGENCY_CLAUSE, { quantitative: { agency_agreements: "Gulf Recruit" } });

    expect(result.missingKeys).toEqual(["agency_agreements or agency_employer_pays_clause_present"]);
  });
});
