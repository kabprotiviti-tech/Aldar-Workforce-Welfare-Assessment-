import { describe, expect, it } from "vitest";
import { extractDocument, factToInsert, tryParseModelJson, type CallClaudeFn, type ExtractionDb, type FactInsert, type InsertExtractionInput } from "./extract";
import type { ExtractedFact } from "./schema";

function fakeDb(): { db: ExtractionDb; extractions: InsertExtractionInput[]; facts: FactInsert[] } {
  const extractions: InsertExtractionInput[] = [];
  const facts: FactInsert[] = [];
  let counter = 0;
  const db: ExtractionDb = {
    async insertExtraction(input) {
      extractions.push(input);
      counter += 1;
      return { extractionId: `extraction-${counter}` };
    },
    async insertFacts(input) {
      facts.push(...input.facts);
      return input.facts.length;
    },
  };
  return { db, extractions, facts };
}

const PDF_CONTENT = { kind: "pdf" as const, base64Data: "ZmFrZS1wZGYtYnl0ZXM=" };

function callClaudeReturning(text: string, tokens: { input: number; output: number } = { input: 1000, output: 200 }): CallClaudeFn {
  return async () => ({ text, model: "claude-sonnet-4-6", inputTokens: tokens.input, outputTokens: tokens.output });
}

describe("golden-file: three fixture documents produce the expected fact keys", () => {
  it("wps_report fixture produces exactly its three fact keys", async () => {
    const fixture = JSON.stringify({
      facts: [
        { fact_key: "wps_transfer_date", value: "2026-05-01", unit: null, page_ref: "page 1", verbatim_quote: "Transfer Date: 01/05/2026", confidence: "high", reason: null },
        { fact_key: "wps_record_count", value: 42, unit: "records", page_ref: "page 1", verbatim_quote: "Total Records: 42", confidence: "high", reason: null },
        { fact_key: "wps_batch_status", value: "Approved", unit: null, page_ref: "page 1", verbatim_quote: "Status: Approved", confidence: "medium", reason: null },
      ],
    });
    const { db, extractions, facts } = fakeDb();

    const result = await extractDocument(db, callClaudeReturning(fixture), {
      evidenceFileId: "ev-1",
      documentClass: "wps_report",
      content: PDF_CONTENT,
    });

    expect(result.outcome).toBe("succeeded");
    expect(extractions[0]!.error).toBeNull();
    expect(facts.map((f) => f.factKey).sort()).toEqual(["wps_batch_status", "wps_record_count", "wps_transfer_date"]);
  });

  it("payroll_register fixture produces exactly its two fact keys", async () => {
    const fixture = JSON.stringify({
      facts: [
        { fact_key: "payroll_deduction_types", value: ["Accommodation", "Transport"], unit: null, page_ref: "page 1", verbatim_quote: "Deductions: Accommodation, Transport", confidence: "high", reason: null },
        { fact_key: "overtime_rate_applied", value: "1.25x", unit: null, page_ref: "page 2", verbatim_quote: "OT Rate: 1.25x", confidence: "medium", reason: null },
      ],
    });
    const { db, facts } = fakeDb();

    const result = await extractDocument(db, callClaudeReturning(fixture), {
      evidenceFileId: "ev-2",
      documentClass: "payroll_register",
      content: PDF_CONTENT,
    });

    expect(result.outcome).toBe("succeeded");
    expect(facts.map((f) => f.factKey).sort()).toEqual(["overtime_rate_applied", "payroll_deduction_types"]);
    expect(facts.find((f) => f.factKey === "payroll_deduction_types")?.valueJson).toEqual(["Accommodation", "Transport"]);
  });

  it("insurance_schedule fixture (including a null/not_present fact) produces exactly its two fact keys", async () => {
    const fixture = JSON.stringify({
      facts: [
        { fact_key: "insurance_policy_start_date", value: "2026-01-01", unit: null, page_ref: "page 1", verbatim_quote: "Effective: 01 Jan 2026", confidence: "high", reason: null },
        { fact_key: "insurance_emirates_covered", value: null, unit: null, page_ref: null, verbatim_quote: null, confidence: "low", reason: "not_present" },
      ],
    });
    const { db, facts } = fakeDb();

    const result = await extractDocument(db, callClaudeReturning(fixture), {
      evidenceFileId: "ev-3",
      documentClass: "insurance_schedule",
      content: PDF_CONTENT,
    });

    expect(result.outcome).toBe("succeeded");
    expect(facts.map((f) => f.factKey).sort()).toEqual(["insurance_emirates_covered", "insurance_policy_start_date"]);
    const absentFact = facts.find((f) => f.factKey === "insurance_emirates_covered")!;
    expect(absentFact.reason).toBe("not_present");
    expect(absentFact.valueText).toBeNull();
  });
});

describe("extractDocument — malformed responses never crash and are stored for manual review", () => {
  it("stores a non-JSON response as a failed extraction, never throws", async () => {
    const { db, extractions } = fakeDb();

    const result = await extractDocument(db, callClaudeReturning("Sorry, I can't read this document clearly."), {
      evidenceFileId: "ev-4",
      documentClass: "wps_report",
      content: PDF_CONTENT,
    });

    expect(result.outcome).toBe("failed");
    if (result.outcome === "failed") {
      expect(result.error).toMatch(/not valid json/i);
    }
    expect(extractions[0]!.error).toMatch(/not valid json/i);
    expect(extractions[0]!.rawResponse).toEqual({ raw_text: "Sorry, I can't read this document clearly." });
  });

  it("strips a markdown code fence before parsing", async () => {
    const fenced = '```json\n{"facts": []}\n```';
    const { db } = fakeDb();

    const result = await extractDocument(db, callClaudeReturning(fenced), {
      evidenceFileId: "ev-5",
      documentClass: "wps_report",
      content: PDF_CONTENT,
    });

    expect(result.outcome).toBe("succeeded");
  });

  it("rejects a response containing a forbidden field (status/rating/compliant/score), never throws", async () => {
    const withForbiddenField = JSON.stringify({
      facts: [{ fact_key: "wps_transfer_date", value: "2026-05-01", unit: null, page_ref: null, verbatim_quote: "x", confidence: "high", reason: null, status: "compliant" }],
    });
    const { db, extractions } = fakeDb();

    const result = await extractDocument(db, callClaudeReturning(withForbiddenField), {
      evidenceFileId: "ev-6",
      documentClass: "wps_report",
      content: PDF_CONTENT,
    });

    expect(result.outcome).toBe("failed");
    if (result.outcome === "failed") {
      expect(result.error).toMatch(/forbidden field/i);
      expect(result.error).toContain("status");
    }
    expect(extractions[0]!.rawResponse).not.toBeNull(); // still stored for manual review.
  });

  it("rejects a response with an off-vocabulary fact_key, never throws", async () => {
    const offVocabulary = JSON.stringify({
      facts: [{ fact_key: "made_up_fact", value: "x", unit: null, page_ref: null, verbatim_quote: "x", confidence: "high", reason: null }],
    });
    const { db, extractions } = fakeDb();

    const result = await extractDocument(db, callClaudeReturning(offVocabulary), {
      evidenceFileId: "ev-7",
      documentClass: "wps_report",
      content: PDF_CONTENT,
    });

    expect(result.outcome).toBe("failed");
    expect(extractions[0]!.error).toMatch(/did not match the expected shape/i);
  });

  it("rejects a response where value is null but reason is missing, never throws", async () => {
    const missingReason = JSON.stringify({
      facts: [{ fact_key: "wps_transfer_date", value: null, unit: null, page_ref: null, verbatim_quote: null, confidence: "low", reason: null }],
    });
    const { db } = fakeDb();

    const result = await extractDocument(db, callClaudeReturning(missingReason), {
      evidenceFileId: "ev-8",
      documentClass: "wps_report",
      content: PDF_CONTENT,
    });

    expect(result.outcome).toBe("failed");
  });

  it("stores a failed extraction (never throws) when the API call itself errors, e.g. after retries are exhausted", async () => {
    const throwingCall: CallClaudeFn = async () => {
      throw new Error("rate limited after 5 attempts");
    };
    const { db, extractions } = fakeDb();

    const result = await extractDocument(db, throwingCall, { evidenceFileId: "ev-9", documentClass: "wps_report", content: PDF_CONTENT });

    expect(result.outcome).toBe("failed");
    if (result.outcome === "failed") {
      expect(result.error).toBe("rate limited after 5 attempts");
    }
    expect(extractions[0]!.costUsd).toBeNull();
  });

  it("skips a document class with no registered extraction prompt (e.g. photo), without calling the model", async () => {
    let called = false;
    const trackedCall: CallClaudeFn = async () => {
      called = true;
      return { text: "{}", model: "claude-sonnet-4-6", inputTokens: 0, outputTokens: 0 };
    };
    const { db, extractions } = fakeDb();

    const result = await extractDocument(db, trackedCall, { evidenceFileId: "ev-10", documentClass: "photo", content: PDF_CONTENT });

    expect(result).toEqual({ outcome: "skipped", reason: expect.stringContaining("photo") });
    expect(called).toBe(false);
    expect(extractions).toHaveLength(0);
  });
});

describe("extractDocument — cost is computed and returned", () => {
  it("reports the computed cost on a successful extraction", async () => {
    const fixture = JSON.stringify({ facts: [] });
    const { db } = fakeDb();

    const result = await extractDocument(db, callClaudeReturning(fixture, { input: 2000, output: 500 }), {
      evidenceFileId: "ev-11",
      documentClass: "wps_report",
      content: PDF_CONTENT,
    });

    expect(result.outcome).toBe("succeeded");
    if (result.outcome === "succeeded") {
      expect(result.costUsd).toBeCloseTo(0.006 + 0.0075, 6);
    }
  });
});

describe("tryParseModelJson", () => {
  it("parses plain JSON", () => {
    expect(tryParseModelJson('{"facts": []}')).toEqual({ ok: true, json: { facts: [] } });
  });

  it("never throws on garbage input", () => {
    expect(() => tryParseModelJson("not json at all {{{")).not.toThrow();
    expect(tryParseModelJson("not json at all {{{").ok).toBe(false);
  });
});

describe("factToInsert", () => {
  const base: ExtractedFact = {
    fact_key: "x",
    value: null,
    unit: null,
    page_ref: null,
    verbatim_quote: null,
    confidence: "high",
    reason: null,
  };

  it("maps a boolean value to valueBoolean", () => {
    expect(factToInsert({ ...base, value: true, reason: null }).valueBoolean).toBe(true);
  });

  it("maps a number value to valueNumber", () => {
    expect(factToInsert({ ...base, value: 42, reason: null }).valueNumber).toBe(42);
  });

  it("maps an array value to valueJson", () => {
    expect(factToInsert({ ...base, value: ["a", "b"], reason: null }).valueJson).toEqual(["a", "b"]);
  });

  it("maps an ISO date string to valueDate", () => {
    expect(factToInsert({ ...base, value: "2026-06-01", reason: null }).valueDate).toBe("2026-06-01");
  });

  it("maps a non-date string to valueText", () => {
    expect(factToInsert({ ...base, value: "Approved", reason: null }).valueText).toBe("Approved");
  });

  it("leaves every value_* column null for a null value", () => {
    const insert = factToInsert({ ...base, value: null, reason: "not_present" });
    expect(insert.valueText).toBeNull();
    expect(insert.valueNumber).toBeNull();
    expect(insert.valueDate).toBeNull();
    expect(insert.valueBoolean).toBeNull();
    expect(insert.valueJson).toBeNull();
    expect(insert.reason).toBe("not_present");
  });

  it("carries group_ref through for a document that correlates facts by entry", () => {
    expect(factToInsert({ ...base, value: 26.4, group_ref: "204" }).groupRef).toBe("204");
  });

  it("defaults group_ref to null for a document-wide fact that never sets it", () => {
    expect(factToInsert({ ...base, value: 26.4 }).groupRef).toBeNull();
  });
});
