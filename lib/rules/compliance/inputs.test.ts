import { describe, expect, it } from "vitest";
import {
  asBoolean,
  asInteger,
  asIsoDate,
  asIsoMonth,
  asNumber,
  asString,
  asStringList,
  daysBetween,
  daysInMonth,
  fact,
  insufficientData,
  labelMatches,
  normalizeLabel,
  optional,
  quant,
  requireAll,
} from "./inputs";
import type { RuleInputs } from "./types";

function inputs(overrides: Partial<RuleInputs> = {}): RuleInputs {
  return { facts: {}, quantitative: {}, assessmentDate: "2026-06-01", ...overrides };
}

describe("requireAll", () => {
  it("reads facts and quantitative values into named values", () => {
    const got = requireAll(inputs({ facts: { a: 1 }, quantitative: { b: "2026-01-31" } }), {
      first: fact("a", asNumber),
      second: quant("b", asIsoDate),
    });

    expect(got).toEqual({ ok: true, values: { first: 1, second: "2026-01-31" } });
  });

  it("names every missing key at once, not just the first", () => {
    const got = requireAll(inputs(), { first: fact("a", asNumber), second: quant("b", asNumber) });

    expect(got).toEqual({ ok: false, missing: ["a", "b"] });
  });

  it("treats a confirmed-but-null fact as missing", () => {
    // A person confirmed the document doesn't state it: real information,
    // but still not a value a rule can compute with.
    const got = requireAll(inputs({ facts: { a: null } }), { first: fact("a", asNumber) });

    expect(got).toEqual({ ok: false, missing: ["a"] });
  });

  it("treats a present-but-unusable value as missing, naming the key", () => {
    const got = requireAll(inputs({ facts: { a: "not a number" } }), { first: fact("a", asNumber) });

    expect(got).toEqual({ ok: false, missing: ["a"] });
  });

  it("treats false and zero as values, not absences", () => {
    const got = requireAll(inputs({ facts: { flag: false }, quantitative: { count: 0 } }), {
      flag: fact("flag", asBoolean),
      count: quant("count", asInteger),
    });

    expect(got).toEqual({ ok: true, values: { flag: false, count: 0 } });
  });
});

describe("optional", () => {
  it("returns the value when present and null when absent or unusable", () => {
    expect(optional(inputs({ quantitative: { a: 5 } }), quant("a", asNumber))).toBe(5);
    expect(optional(inputs(), quant("a", asNumber))).toBeNull();
    expect(optional(inputs({ quantitative: { a: null } }), quant("a", asNumber))).toBeNull();
    expect(optional(inputs({ quantitative: { a: "x" } }), quant("a", asNumber))).toBeNull();
  });
});

describe("insufficientData", () => {
  it("says outright that it is not a pass, and names the missing keys", () => {
    const result = insufficientData(["wps_transfer_date", "wage_period_month"]);

    expect(result.outcome).toBe("insufficient_data");
    expect(result.computedExplanation).toBe(
      "Insufficient data — this rule could not be evaluated and is not a pass. Missing: wps_transfer_date, wage_period_month.",
    );
    expect(result.missingKeys).toEqual(["wps_transfer_date", "wage_period_month"]);
    expect(result.observed).toEqual({});
  });

  it("carries a detail without any missing keys", () => {
    const result = insufficientData([], "Occupancy is zero.");

    expect(result.computedExplanation).toBe("Insufficient data — this rule could not be evaluated and is not a pass. Occupancy is zero.");
    expect(result.missingKeys).toEqual([]);
  });

  it("combines missing keys and a detail", () => {
    expect(insufficientData(["a"], "Detail.").computedExplanation).toContain("Missing: a. Detail.");
  });
});

describe("asNumber / asInteger", () => {
  it("accepts numbers and numeric strings", () => {
    expect(asNumber(4.5)).toBe(4.5);
    expect(asNumber(" 4.5 ")).toBe(4.5);
    expect(asInteger("8")).toBe(8);
  });

  it("rejects non-numeric, empty, infinite and non-integer input", () => {
    expect(asNumber("abc")).toBeNull();
    expect(asNumber("   ")).toBeNull();
    expect(asNumber(Number.POSITIVE_INFINITY)).toBeNull();
    expect(asNumber(Number.NaN)).toBeNull();
    expect(asNumber(true)).toBeNull();
    expect(asInteger("8.5")).toBeNull();
    expect(asInteger("abc")).toBeNull();
  });
});

describe("asBoolean", () => {
  it("accepts booleans and the words assessors and documents use", () => {
    expect(asBoolean(true)).toBe(true);
    expect(asBoolean(false)).toBe(false);
    expect(asBoolean("Yes")).toBe(true);
    expect(asBoolean("present")).toBe(true);
    expect(asBoolean("no")).toBe(false);
    expect(asBoolean("absent")).toBe(false);
  });

  it("rejects anything ambiguous", () => {
    expect(asBoolean("maybe")).toBeNull();
    expect(asBoolean(1)).toBeNull();
  });
});

describe("asString", () => {
  it("trims and rejects blanks and non-strings", () => {
    expect(asString("  Al Reem  ")).toBe("Al Reem");
    expect(asString("   ")).toBeNull();
    expect(asString(7)).toBeNull();
  });
});

describe("asIsoDate", () => {
  it("accepts a real yyyy-mm-dd date, including a leap day", () => {
    expect(asIsoDate("2026-05-01")).toBe("2026-05-01");
    expect(asIsoDate(" 2024-02-29 ")).toBe("2024-02-29");
  });

  it("rejects a non-date, a wrong shape, and dates that do not exist", () => {
    expect(asIsoDate(20260501)).toBeNull();
    expect(asIsoDate("01/05/2026")).toBeNull();
    expect(asIsoDate("2026-13-01")).toBeNull();
    expect(asIsoDate("2026-00-01")).toBeNull();
    expect(asIsoDate("2026-02-30")).toBeNull();
    expect(asIsoDate("2026-05-00")).toBeNull();
    expect(asIsoDate("2025-02-29")).toBeNull();
  });
});

describe("asIsoMonth", () => {
  it("accepts yyyy-mm and rejects everything else", () => {
    expect(asIsoMonth("2026-04")).toBe("2026-04");
    expect(asIsoMonth("2026-13")).toBeNull();
    expect(asIsoMonth("2026-00")).toBeNull();
    expect(asIsoMonth("2026-04-01")).toBeNull();
    expect(asIsoMonth(202604)).toBeNull();
  });
});

describe("asStringList", () => {
  it("accepts an array or a comma-separated string", () => {
    expect(asStringList(["Dubai", " Sharjah "])).toEqual(["Dubai", "Sharjah"]);
    expect(asStringList("Dubai, Sharjah")).toEqual(["Dubai", "Sharjah"]);
    expect(asStringList([1, 2])).toEqual(["1", "2"]);
  });

  it("rejects an empty list, a blank string and other types", () => {
    expect(asStringList([])).toBeNull();
    expect(asStringList(["", "  "])).toBeNull();
    expect(asStringList("")).toBeNull();
    expect(asStringList(", ,")).toBeNull();
    expect(asStringList(5)).toBeNull();
  });
});

describe("daysInMonth / daysBetween", () => {
  it("knows month lengths, including February in a leap year", () => {
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2026, 4)).toBe(30);
    expect(daysInMonth(2026, 12)).toBe(31);
  });

  it("counts whole days in either direction, and zero for the same day", () => {
    expect(daysBetween("2026-06-01", "2026-06-16")).toBe(15);
    expect(daysBetween("2026-06-16", "2026-06-01")).toBe(-15);
    expect(daysBetween("2026-06-01", "2026-06-01")).toBe(0);
    // Across a month and a year boundary.
    expect(daysBetween("2026-12-31", "2027-01-01")).toBe(1);
  });
});

describe("normalizeLabel / labelMatches", () => {
  it("normalizes case, spacing and punctuation", () => {
    expect(normalizeLabel("  Emirates ID ")).toBe("emirates_id");
    expect(normalizeLabel("Work-Permit")).toBe("work_permit");
  });

  it("matches an exact label", () => {
    expect(labelMatches("Emirates ID", "emirates_id")).toBe(true);
  });

  it("matches a listed term appearing as a whole word inside a label", () => {
    expect(labelMatches("PPE charges", "ppe")).toBe(true);
    expect(labelMatches("Monthly transport deduction", "transport")).toBe(true);
  });

  it("does not match a term that is only part of another word", () => {
    expect(labelMatches("transportation_allowance", "transport")).toBe(false);
    expect(labelMatches("Salary advance", "ppe")).toBe(false);
  });

  it("treats a term with regex characters literally", () => {
    expect(labelMatches("work permit", "work.permit")).toBe(true);
    expect(labelMatches("workxpermit", "work.permit")).toBe(false);
  });
});
