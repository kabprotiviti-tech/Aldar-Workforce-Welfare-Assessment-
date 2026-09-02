import { describe, expect, it } from "vitest";
import {
  bulkAcceptableIds,
  coerceEditedValue,
  confirmedValueOf,
  factKeyLabel,
  formatFactValue,
  isBulkAcceptable,
  isConfirmed,
  ledgerFactFromRow,
  ledgerProgress,
  parsePageRef,
  partitionByConfidence,
  progressLabel,
  proposedValueOf,
  type ExtractedFactRowLike,
  type LedgerFact,
} from "./ledger";

function fact(overrides: Partial<LedgerFact> = {}): LedgerFact {
  return {
    id: "fact-1",
    evidenceFileId: "ev-1",
    factKey: "wps_transfer_date",
    proposedValue: "2026-05-01",
    confirmedValue: "2026-05-01",
    unit: null,
    pageRef: "page 1",
    verbatimQuote: "Transfer Date: 01/05/2026",
    confidence: "high",
    status: "proposed",
    reason: null,
    rejectionReason: null,
    bbox: null,
    resolvedAt: null,
    ...overrides,
  };
}

describe("isConfirmed", () => {
  it("counts accepted and edited as confirmed", () => {
    expect(isConfirmed("accepted")).toBe(true);
    expect(isConfirmed("edited")).toBe(true);
  });

  it("never counts proposed or rejected as confirmed", () => {
    expect(isConfirmed("proposed")).toBe(false);
    expect(isConfirmed("rejected")).toBe(false);
  });
});

describe("isBulkAcceptable", () => {
  it("accepts only a proposed, high-confidence fact", () => {
    expect(isBulkAcceptable(fact({ confidence: "high", status: "proposed" }))).toBe(true);
  });

  it("refuses medium and low confidence", () => {
    expect(isBulkAcceptable(fact({ confidence: "medium" }))).toBe(false);
    expect(isBulkAcceptable(fact({ confidence: "low" }))).toBe(false);
  });

  it("refuses a fact with no confidence recorded at all", () => {
    expect(isBulkAcceptable(fact({ confidence: null }))).toBe(false);
  });

  it("refuses a fact that has already been resolved", () => {
    expect(isBulkAcceptable(fact({ status: "accepted" }))).toBe(false);
    expect(isBulkAcceptable(fact({ status: "edited" }))).toBe(false);
    expect(isBulkAcceptable(fact({ status: "rejected" }))).toBe(false);
  });

  it("bulkAcceptableIds returns only the eligible ids", () => {
    const facts = [
      fact({ id: "a", confidence: "high" }),
      fact({ id: "b", confidence: "low" }),
      fact({ id: "c", confidence: "medium" }),
      fact({ id: "d", confidence: "high", status: "rejected" }),
      fact({ id: "e", confidence: "high" }),
    ];
    expect(bulkAcceptableIds(facts)).toEqual(["a", "e"]);
  });
});

describe("ledgerProgress / progressLabel", () => {
  it("counts confirmed, rejected and pending separately", () => {
    const facts = [
      ...Array.from({ length: 12 }, (_, i) => fact({ id: `acc-${i}`, status: "accepted" })),
      fact({ id: "ed-1", status: "edited" }),
      fact({ id: "ed-2", status: "edited" }),
      fact({ id: "rej-1", status: "rejected" }),
      ...Array.from({ length: 7 }, (_, i) => fact({ id: `prop-${i}`, status: "proposed" })),
    ];

    const progress = ledgerProgress(facts);
    expect(progress).toEqual({ confirmed: 14, total: 22, rejected: 1, pending: 7 });
    expect(progressLabel(progress)).toBe("14 of 22 facts confirmed");
  });

  it("reads 0 of 0 for a file with no facts", () => {
    expect(progressLabel(ledgerProgress([]))).toBe("0 of 0 facts confirmed");
  });
});

describe("partitionByConfidence", () => {
  it("separates low confidence from everything else", () => {
    const facts = [
      fact({ id: "a", confidence: "high" }),
      fact({ id: "b", confidence: "low" }),
      fact({ id: "c", confidence: "medium" }),
      fact({ id: "d", confidence: null }),
    ];
    const { primary, lowConfidence } = partitionByConfidence(facts);
    expect(primary.map((f) => f.id)).toEqual(["a", "c", "d"]);
    expect(lowConfidence.map((f) => f.id)).toEqual(["b"]);
  });
});

describe("parsePageRef", () => {
  it("reads the common shapes the model writes", () => {
    expect(parsePageRef("page 1")).toBe(1);
    expect(parsePageRef("Page 12")).toBe(12);
    expect(parsePageRef("p. 3")).toBe(3);
    expect(parsePageRef("pg 4")).toBe(4);
    expect(parsePageRef("pp. 9")).toBe(9);
    expect(parsePageRef("7")).toBe(7);
  });

  it("takes the page number, not a leading number that belongs to something else", () => {
    expect(parsePageRef("Table 3, page 5")).toBe(5);
  });

  it("takes the first page of a range or an 'of' form", () => {
    expect(parsePageRef("Page 5 of 40")).toBe(5);
  });

  it("returns null when there is no page to go to", () => {
    expect(parsePageRef(null)).toBeNull();
    expect(parsePageRef("")).toBeNull();
    expect(parsePageRef("appendix")).toBeNull();
  });
});

describe("formatFactValue", () => {
  it("formats strings, numbers and units", () => {
    expect(formatFactValue("Approved", null, null)).toBe("Approved");
    expect(formatFactValue(42, "records", null)).toBe("42 records");
  });

  it("formats booleans as Yes/No", () => {
    expect(formatFactValue(true, null, null)).toBe("Yes");
    expect(formatFactValue(false, null, null)).toBe("No");
  });

  it("formats a list value as a readable list", () => {
    expect(formatFactValue(["Accommodation", "Transport"], null, null)).toBe("Accommodation, Transport");
  });

  it("states an absence rather than rendering an empty value", () => {
    expect(formatFactValue(null, null, "not_present")).toBe("Not present in the document");
    expect(formatFactValue(null, null, "illegible")).toBe("Illegible in the document");
    expect(formatFactValue(null, null, null)).toBe("No value");
  });
});

describe("factKeyLabel", () => {
  it("turns a fact key into a readable label", () => {
    expect(factKeyLabel("wps_transfer_date")).toBe("Wps transfer date");
    expect(factKeyLabel("agency_employer_pays_clause_present")).toBe("Agency employer pays clause present");
  });
});

function row(overrides: Partial<ExtractedFactRowLike> = {}): ExtractedFactRowLike {
  return {
    id: "fact-1",
    evidence_file_id: "ev-1",
    fact_key: "wps_record_count",
    value_text: null,
    value_number: null,
    value_date: null,
    value_boolean: null,
    value_json: null,
    unit: null,
    page_ref: "page 1",
    verbatim_quote: "Total Records: 42",
    confidence: "high",
    status: "proposed",
    reason: null,
    rejection_reason: null,
    resolved_value_json: null,
    bbox: null,
    resolved_at: null,
    ...overrides,
  };
}

describe("proposedValueOf", () => {
  it("reads whichever typed value column is populated", () => {
    expect(proposedValueOf(row({ value_text: "Approved" }))).toBe("Approved");
    expect(proposedValueOf(row({ value_number: 42 }))).toBe(42);
    expect(proposedValueOf(row({ value_boolean: false }))).toBe(false);
    expect(proposedValueOf(row({ value_json: ["Accommodation", "Transport"] }))).toEqual(["Accommodation", "Transport"]);
    expect(proposedValueOf(row())).toBeNull();
  });

  it("coerces a numeric column that arrived as a string (node-postgres) to a number", () => {
    expect(proposedValueOf(row({ value_number: "1.25" }))).toBe(1.25);
  });

  it("renders a date column as an ISO date whether it arrived as a string or a Date", () => {
    expect(proposedValueOf(row({ value_date: "2026-05-01" }))).toBe("2026-05-01");
    expect(proposedValueOf(row({ value_date: new Date("2026-05-01T00:00:00Z") }))).toBe("2026-05-01");
  });
});

describe("confirmedValueOf", () => {
  it("prefers an edited fact's human value over the model's proposal", () => {
    const edited = row({ value_number: 42, status: "edited", resolved_value_json: { value: 43 } });
    expect(proposedValueOf(edited)).toBe(42);
    expect(confirmedValueOf(edited)).toBe(43);
  });

  it("keeps a false or zero edited value rather than falling back to the proposal", () => {
    expect(confirmedValueOf(row({ value_boolean: true, status: "edited", resolved_value_json: { value: false } }))).toBe(false);
    expect(confirmedValueOf(row({ value_number: 42, status: "edited", resolved_value_json: { value: 0 } }))).toBe(0);
  });

  it("uses the model's value for an accepted fact", () => {
    expect(confirmedValueOf(row({ value_text: "Approved", status: "accepted" }))).toBe("Approved");
  });

  it("ignores a stale resolved value on a fact that is not edited", () => {
    expect(confirmedValueOf(row({ value_text: "Approved", status: "accepted", resolved_value_json: { value: "Stale" } }))).toBe("Approved");
  });
});

describe("ledgerFactFromRow", () => {
  it("maps a row to the shape the review list and the actions share", () => {
    const fact = ledgerFactFromRow(
      row({
        value_number: 42,
        unit: "records",
        confidence: "medium",
        reason: null,
        status: "proposed",
      }),
    );

    expect(fact).toEqual({
      id: "fact-1",
      evidenceFileId: "ev-1",
      factKey: "wps_record_count",
      proposedValue: 42,
      confirmedValue: 42,
      unit: "records",
      pageRef: "page 1",
      verbatimQuote: "Total Records: 42",
      confidence: "medium",
      status: "proposed",
      reason: null,
      rejectionReason: null,
      bbox: null,
      resolvedAt: null,
    });
  });

  it("keeps a valid bounding box and drops a malformed one", () => {
    const valid = { page: 2, x: 0.1, y: 0.2, width: 0.3, height: 0.05 };
    expect(ledgerFactFromRow(row({ bbox: valid })).bbox).toEqual(valid);
    expect(ledgerFactFromRow(row({ bbox: { page: 2, x: 4 } })).bbox).toBeNull();
    expect(ledgerFactFromRow(row({ bbox: "top-left" })).bbox).toBeNull();
  });

  it("treats an unrecognised status as unreviewed rather than confirmed", () => {
    expect(ledgerFactFromRow(row({ status: "something_new" })).status).toBe("proposed");
  });
});

describe("coerceEditedValue", () => {
  it("keeps an edited number a number", () => {
    expect(coerceEditedValue("43", 42)).toEqual({ ok: true, value: 43 });
    expect(coerceEditedValue(" 1.25 ", 1.5)).toEqual({ ok: true, value: 1.25 });
  });

  it("rejects text where the fact holds a number", () => {
    expect(coerceEditedValue("forty three", 42)).toEqual({ ok: false, message: expect.stringContaining("isn't a number") });
  });

  it("reads yes/no for a boolean fact", () => {
    expect(coerceEditedValue("Yes", true)).toEqual({ ok: true, value: true });
    expect(coerceEditedValue("no", true)).toEqual({ ok: true, value: false });
    expect(coerceEditedValue("maybe", true)).toEqual({ ok: false, message: expect.stringContaining("isn't yes or no") });
  });

  it("splits a comma-separated list for a list fact", () => {
    expect(coerceEditedValue("Accommodation, Transport ,Visa", ["Accommodation"])).toEqual({
      ok: true,
      value: ["Accommodation", "Transport", "Visa"],
    });
  });

  it("trims a plain string, and treats an absent proposal as free text", () => {
    expect(coerceEditedValue("  Approved  ", "Pending")).toEqual({ ok: true, value: "Approved" });
    expect(coerceEditedValue("Approved", null)).toEqual({ ok: true, value: "Approved" });
  });

  it("refuses an empty edit", () => {
    expect(coerceEditedValue("   ", "Pending")).toEqual({ ok: false, message: expect.stringContaining("reject the fact instead") });
  });
});
