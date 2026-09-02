import { describe, expect, it } from "vitest";
import { findForbiddenField } from "./forbidden-fields";

describe("findForbiddenField", () => {
  it("finds nothing in a clean facts response", () => {
    const response = {
      facts: [{ fact_key: "wps_transfer_date", value: "2026-06-01", unit: null, page_ref: "page 1", confidence: "high" }],
    };
    expect(findForbiddenField(response)).toBeNull();
  });

  it.each(["status", "rating", "compliant", "score"])("finds a top-level %s field", (field) => {
    const response = { facts: [], [field]: "whatever" };
    expect(findForbiddenField(response)).toBe(field);
  });

  it("finds a forbidden field nested inside a fact object", () => {
    const response = { facts: [{ fact_key: "x", value: "y", status: "compliant" }] };
    expect(findForbiddenField(response)).toBe("facts[0].status");
  });

  it("is case-insensitive", () => {
    expect(findForbiddenField({ Score: 1 })).toBe("Score");
    expect(findForbiddenField({ RATING: "high" })).toBe("RATING");
  });

  it("does not false-positive on a fact_key value merely containing a forbidden word", () => {
    // "wps_batch_status" is a legitimate fact_key VALUE, not a JSON key named "status".
    const response = { facts: [{ fact_key: "wps_batch_status", value: "Approved" }] };
    expect(findForbiddenField(response)).toBeNull();
  });

  it("does not false-positive on string values containing forbidden words", () => {
    const response = { facts: [{ fact_key: "x", verbatim_quote: "Compliance status: rated highly" }] };
    expect(findForbiddenField(response)).toBeNull();
  });

  it("finds a forbidden field arbitrarily deep", () => {
    const response = { a: { b: { c: [{ d: { rating: 5 } }] } } };
    expect(findForbiddenField(response)).toBe("a.b.c[0].d.rating");
  });
});
