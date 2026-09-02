import { describe, expect, it } from "vitest";
import { formatComparable, formatFixed, formatNumber, listPhrase, pluralize, renderTemplate, RuleTemplateError } from "./format";

describe("renderTemplate", () => {
  it("fills tokens with strings and numbers", () => {
    expect(renderTemplate("{a} then {b}", { a: "first", b: 2 })).toBe("first then 2");
  });

  it("fills a token used more than once", () => {
    expect(renderTemplate("{x} and {x}", { x: "same" })).toBe("same and same");
  });

  it("formats numeric values the way a person writes them", () => {
    expect(renderTemplate("{n}", { n: 3.3 })).toBe("3.3");
  });

  it("throws rather than shipping an unfilled token into a report", () => {
    expect(() => renderTemplate("{known} {unknown}", { known: "yes" })).toThrow(RuleTemplateError);
    expect(() => renderTemplate("{unknown}", {})).toThrow(/references \{unknown\}/);
  });
});

describe("formatNumber", () => {
  it("prints an integer without decimals", () => {
    expect(formatNumber(26)).toBe("26");
    expect(formatNumber(0)).toBe("0");
  });

  it("trims trailing zeros", () => {
    expect(formatNumber(26.4)).toBe("26.4");
    expect(formatNumber(3.3)).toBe("3.3");
    expect(formatNumber(3.001)).toBe("3");
  });

  it("rounds to the requested precision", () => {
    expect(formatNumber(3.3333)).toBe("3.33");
    expect(formatNumber(3.3333, 3)).toBe("3.333");
  });
});

describe("formatFixed", () => {
  it("keeps a stated threshold at full precision", () => {
    expect(formatFixed(4)).toBe("4.00");
    expect(formatFixed(4.5, 1)).toBe("4.5");
  });
});

describe("formatComparable", () => {
  it("uses two decimals when that already distinguishes the value", () => {
    expect(formatComparable(3.3, 4)).toBe("3.30");
    expect(formatComparable(5, 4)).toBe("5.00");
  });

  it("prints the threshold value itself at the plain precision", () => {
    expect(formatComparable(4, 4)).toBe("4.00");
  });

  it("adds precision when two decimals would look identical to a threshold the value misses", () => {
    // 31.99 across 8 residents is 3.99875 — "4.00" beside a 4.00 minimum
    // would read as if it passed. Adds the least precision that separates
    // them, which here is a third decimal place.
    expect(formatComparable(31.99 / 8, 4)).toBe("3.999");
    expect(formatComparable(3.99996, 4)).toBe("3.99996");
  });

  it("falls back to the raw value when no reasonable precision separates them", () => {
    expect(formatComparable(4 + 1e-12, 4)).toBe("4.000000000001");
  });
});

describe("pluralize", () => {
  it("uses the singular for one and the plural otherwise", () => {
    expect(pluralize(1, "day")).toBe("1 day");
    expect(pluralize(2, "day")).toBe("2 days");
    expect(pluralize(0, "day")).toBe("0 days");
  });

  it("accepts an irregular plural", () => {
    expect(pluralize(2, "entry", "entries")).toBe("2 entries");
  });
});

describe("listPhrase", () => {
  it("reads as prose for none, one, two and many", () => {
    expect(listPhrase([])).toBe("none");
    expect(listPhrase(["a"])).toBe("a");
    expect(listPhrase(["a", "b"])).toBe("a and b");
    expect(listPhrase(["a", "b", "c"])).toBe("a, b and c");
  });
});
