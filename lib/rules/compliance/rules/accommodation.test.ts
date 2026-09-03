import { describe, expect, it } from "vitest";
import { ACM_OCCUPANCY_RECONCILED, ACM_TOILET_RATIO, R18_CD_CERT, R18_ROOM_AREA, R18_ROOM_HEADCOUNT } from "./accommodation";
import type { CompiledRule, RuleInputs } from "../types";

function inputs(overrides: Partial<RuleInputs> = {}): RuleInputs {
  return { facts: {}, quantitative: {}, assessmentDate: "2026-06-01", ...overrides };
}

function run(rule: CompiledRule, given: Partial<RuleInputs>, thresholds?: unknown) {
  const outcome = rule.run(inputs(given), thresholds);
  if (!outcome.ok) throw new Error(`unexpected configuration error: ${outcome.configError}`);
  return outcome.result;
}

describe("R18_ROOM_AREA — at least 4.00 m² per resident", () => {
  it("shows the working exactly as specified for a room that falls short", () => {
    const result = run(R18_ROOM_AREA, { facts: { drawing_room_area_m2: 26.4, occupancy_headcount: 8 } });

    expect(result.outcome).toBe("fail");
    expect(result.computedExplanation).toBe("26.4 m² / 8 residents = 3.30 m² per resident. Minimum 4.00 m². Below threshold.");
  });

  it("passes at exactly 4.00 m² per resident — the boundary", () => {
    const result = run(R18_ROOM_AREA, { facts: { drawing_room_area_m2: 32, occupancy_headcount: 8 } });

    expect(result.outcome).toBe("pass");
    expect(result.computedExplanation).toBe("32 m² / 8 residents = 4.00 m² per resident. Minimum 4.00 m². Meets threshold.");
  });

  it("fails just under the boundary without appearing to pass", () => {
    // 31.99 / 8 is 3.99875: at two decimals this would print "4.00"
    // beside a 4.00 minimum and read as a contradiction.
    const result = run(R18_ROOM_AREA, { facts: { drawing_room_area_m2: 31.99, occupancy_headcount: 8 } });

    expect(result.outcome).toBe("fail");
    expect(result.computedExplanation).toBe("31.99 m² / 8 residents = 3.999 m² per resident. Minimum 4.00 m². Below threshold.");
  });

  it("prefers the assessor's measurement over the drawing", () => {
    const result = run(R18_ROOM_AREA, {
      facts: { drawing_room_area_m2: 40, occupancy_headcount: 8 },
      quantitative: { room_area_m2: 26.4, room_occupancy: 8 },
    });

    expect(result.outcome).toBe("fail");
    expect(result.observed.area).toBe(26.4);
  });

  it("falls back to the drawing when the assessor recorded nothing", () => {
    const result = run(R18_ROOM_AREA, { facts: { drawing_room_area_m2: 40, occupancy_headcount: 8 } });

    expect(result.observed.area).toBe(40);
    expect(result.outcome).toBe("pass");
  });

  it("honours an edited minimum", () => {
    const result = run(R18_ROOM_AREA, { facts: { drawing_room_area_m2: 26.4, occupancy_headcount: 8 } }, { minAreaPerResidentM2: 3 });

    expect(result.outcome).toBe("pass");
    expect(result.computedExplanation).toContain("Minimum 3.00 m²");
  });

  it("names either source when an input is missing", () => {
    expect(run(R18_ROOM_AREA, { facts: { occupancy_headcount: 8 } }).missingKeys).toEqual(["room_area_m2 or drawing_room_area_m2"]);
    expect(run(R18_ROOM_AREA, { facts: { drawing_room_area_m2: 26.4 } }).missingKeys).toEqual(["room_occupancy or occupancy_headcount"]);
    expect(run(R18_ROOM_AREA, {}).missingKeys).toEqual([
      "room_area_m2 or drawing_room_area_m2",
      "room_occupancy or occupancy_headcount",
    ]);
  });

  it("returns insufficient_data rather than dividing by zero occupancy", () => {
    const result = run(R18_ROOM_AREA, { facts: { drawing_room_area_m2: 26.4, occupancy_headcount: 0 } });

    expect(result.outcome).toBe("insufficient_data");
    expect(result.missingKeys).toEqual([]);
    expect(result.computedExplanation).toContain("Recorded occupancy is 0");
  });
});

describe("R18_ROOM_HEADCOUNT — at most 8 residents", () => {
  it("passes at exactly 8 residents — the boundary", () => {
    const result = run(R18_ROOM_HEADCOUNT, { facts: { occupancy_headcount: 8 } });

    expect(result.outcome).toBe("pass");
    expect(result.computedExplanation).toBe("8 residents in the room against a maximum of 8. Within the maximum.");
  });

  it("fails at 9, stating by how many", () => {
    const result = run(R18_ROOM_HEADCOUNT, { facts: { occupancy_headcount: 9 } });

    expect(result.outcome).toBe("fail");
    expect(result.computedExplanation).toContain("Over by 1 resident.");
  });

  it("uses the plural for a bigger overage", () => {
    expect(run(R18_ROOM_HEADCOUNT, { facts: { occupancy_headcount: 12 } }).computedExplanation).toContain("Over by 4 residents.");
  });

  it("prefers the assessor's count", () => {
    const result = run(R18_ROOM_HEADCOUNT, { facts: { occupancy_headcount: 8 }, quantitative: { room_occupancy: 10 } });

    expect(result.outcome).toBe("fail");
    expect(result.observed.occupancy).toBe(10);
  });

  it("honours an edited maximum", () => {
    expect(run(R18_ROOM_HEADCOUNT, { facts: { occupancy_headcount: 10 } }, { maxResidentsPerRoom: 10 }).outcome).toBe("pass");
  });

  it("returns insufficient_data naming either source", () => {
    const result = run(R18_ROOM_HEADCOUNT, {});

    expect(result.outcome).toBe("insufficient_data");
    expect(result.missingKeys).toEqual(["room_occupancy or occupancy_headcount"]);
  });
});

describe("R18_CD_CERT — valid past the assessment date", () => {
  it("passes a certificate with time left", () => {
    const result = run(R18_CD_CERT, { facts: { civil_defence_expiry_date: "2026-09-01" } });

    expect(result.outcome).toBe("pass");
    expect(result.computedExplanation).toBe(
      "Civil defence certificate expires 2026-09-01; assessment date 2026-06-01 (92 days remaining). Must remain valid at least 0 day(s) beyond the assessment date. Valid.",
    );
  });

  it("fails a certificate expiring on the assessment date itself — the boundary", () => {
    const result = run(R18_CD_CERT, { facts: { civil_defence_expiry_date: "2026-06-01" } });

    expect(result.outcome).toBe("fail");
    expect(result.computedExplanation).toContain("expires on the assessment date");
    expect(result.computedExplanation).toContain("Not valid for the assessment date");
  });

  it("passes with a single day to spare", () => {
    expect(run(R18_CD_CERT, { facts: { civil_defence_expiry_date: "2026-06-02" } }).computedExplanation).toContain("1 day remaining");
  });

  it("fails an already-expired certificate, stating how long ago", () => {
    const result = run(R18_CD_CERT, { facts: { civil_defence_expiry_date: "2026-05-30" } });

    expect(result.outcome).toBe("fail");
    expect(result.computedExplanation).toContain("expired 2 days earlier");
  });

  it("can require remaining validity beyond the assessment date", () => {
    const soon = { facts: { civil_defence_expiry_date: "2026-06-20" } };

    expect(run(R18_CD_CERT, soon).outcome).toBe("pass");
    expect(run(R18_CD_CERT, soon, { minDaysValidAfterAssessment: 30 }).outcome).toBe("fail");
  });

  it("returns insufficient_data naming the missing certificate date", () => {
    const result = run(R18_CD_CERT, {});

    expect(result.outcome).toBe("insufficient_data");
    expect(result.missingKeys).toEqual(["civil_defence_expiry_date"]);
  });
});

describe("ACM_TOILET_RATIO — sanitary fixtures per resident", () => {
  it("passes when every ratio is met exactly", () => {
    const result = run(ACM_TOILET_RATIO, { quantitative: { residents: 16, toilets: 2, showers: 2, washbasins: 2 } });

    expect(result.outcome).toBe("pass");
    expect(result.computedExplanation).toBe(
      "16 residents: toilets 2 of 2 required (1 per 8); showers 2 of 2 required (1 per 8); washbasins 2 of 2 required (1 per 8). Meets every ratio.",
    );
  });

  it("rounds a part-share of residents up to a whole fixture", () => {
    const result = run(ACM_TOILET_RATIO, { quantitative: { residents: 17, toilets: 2, showers: 3, washbasins: 3 } });

    expect(result.outcome).toBe("fail");
    expect(result.observed.required).toEqual({ toilets: 3, showers: 3, washbasins: 3 });
    expect(result.computedExplanation).toContain("Short of 1 toilet(s)");
  });

  it("names a shortfall in each fixture type", () => {
    const result = run(ACM_TOILET_RATIO, { quantitative: { residents: 24, toilets: 1, showers: 2, washbasins: 0 } });

    expect(result.outcome).toBe("fail");
    expect(result.computedExplanation).toContain("Short of 2 toilet(s), 1 shower(s) and 3 washbasin(s)");
  });

  it("honours edited ratios", () => {
    const result = run(
      ACM_TOILET_RATIO,
      { quantitative: { residents: 16, toilets: 2, showers: 2, washbasins: 2 } },
      { maxResidentsPerToilet: 5, maxResidentsPerShower: 8, maxResidentsPerWashbasin: 8 },
    );

    expect(result.outcome).toBe("fail");
    expect(result.observed.required).toEqual({ toilets: 4, showers: 2, washbasins: 2 });
  });

  it("returns insufficient_data rather than dividing by zero residents", () => {
    const result = run(ACM_TOILET_RATIO, { quantitative: { residents: 0, toilets: 2, showers: 2, washbasins: 2 } });

    expect(result.outcome).toBe("insufficient_data");
    expect(result.computedExplanation).toContain("Recorded resident count is 0");
  });

  it("returns insufficient_data naming every missing count", () => {
    const result = run(ACM_TOILET_RATIO, { quantitative: { residents: 16 } });

    expect(result.outcome).toBe("insufficient_data");
    expect(result.missingKeys).toEqual(["toilets", "showers", "washbasins"]);
  });
});

describe("ACM_OCCUPANCY_RECONCILED — on-site count vs the occupancy schedule", () => {
  it("passes when the two figures agree exactly", () => {
    const result = run(ACM_OCCUPANCY_RECONCILED, { quantitative: { room_occupancy_physical: 8, room_occupancy_schedule: 8 } });

    expect(result.outcome).toBe("pass");
    expect(result.computedExplanation).toBe(
      "8 residents counted on site; 8 recorded on the occupancy schedule. Figures match exactly. Maximum allowed difference 0. Figures agree.",
    );
  });

  it("fails on a one-resident difference at the default zero tolerance — the boundary", () => {
    const result = run(ACM_OCCUPANCY_RECONCILED, { quantitative: { room_occupancy_physical: 8, room_occupancy_schedule: 7 } });

    expect(result.outcome).toBe("fail");
    expect(result.computedExplanation).toBe(
      "8 residents counted on site; 7 recorded on the occupancy schedule. Difference of 1 resident. Maximum allowed difference 0. Figures do not match.",
    );
  });

  it("takes the absolute difference — the schedule being higher fails the same way", () => {
    const result = run(ACM_OCCUPANCY_RECONCILED, { quantitative: { room_occupancy_physical: 6, room_occupancy_schedule: 9 } });

    expect(result.outcome).toBe("fail");
    expect(result.observed.difference).toBe(3);
  });

  it("passes at exactly the configured tolerance, and fails just beyond it", () => {
    const atTolerance = run(ACM_OCCUPANCY_RECONCILED, { quantitative: { room_occupancy_physical: 8, room_occupancy_schedule: 7 } }, { maxAllowedDifference: 1 });
    expect(atTolerance.outcome).toBe("pass");

    const beyondTolerance = run(ACM_OCCUPANCY_RECONCILED, { quantitative: { room_occupancy_physical: 8, room_occupancy_schedule: 6 } }, { maxAllowedDifference: 1 });
    expect(beyondTolerance.outcome).toBe("fail");
  });

  it("returns insufficient_data naming the missing key when only the physical count exists", () => {
    const result = run(ACM_OCCUPANCY_RECONCILED, { quantitative: { room_occupancy_physical: 8 } });

    expect(result.outcome).toBe("insufficient_data");
    expect(result.missingKeys).toEqual(["room_occupancy_schedule"]);
  });

  it("returns insufficient_data naming the missing key when only the schedule figure exists", () => {
    const result = run(ACM_OCCUPANCY_RECONCILED, { quantitative: { room_occupancy_schedule: 8 } });

    expect(result.outcome).toBe("insufficient_data");
    expect(result.missingKeys).toEqual(["room_occupancy_physical"]);
  });

  it("returns insufficient_data naming both when neither exists", () => {
    const result = run(ACM_OCCUPANCY_RECONCILED, {});

    expect(result.outcome).toBe("insufficient_data");
    expect(result.missingKeys).toEqual(["room_occupancy_physical", "room_occupancy_schedule"]);
  });

  it("never reads a document-wide fact as either figure — this comparison is quantitative-only", () => {
    const result = run(ACM_OCCUPANCY_RECONCILED, { facts: { occupancy_headcount: 8 }, quantitative: { room_occupancy_physical: 8 } });

    expect(result.outcome).toBe("insufficient_data");
    expect(result.missingKeys).toEqual(["room_occupancy_schedule"]);
  });
});
