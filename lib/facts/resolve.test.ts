import { describe, expect, it } from "vitest";
import { bulkAcceptHighConfidence, resolveFact, type FactLedgerDb, type ResolveFactDbInput } from "./resolve";
import type { LedgerFact } from "./ledger";

function ledgerFact(overrides: Partial<LedgerFact> = {}): LedgerFact {
  return {
    id: "fact-1",
    evidenceFileId: "ev-1",
    factKey: "wps_record_count",
    proposedValue: 42,
    confirmedValue: 42,
    unit: "records",
    pageRef: "page 1",
    verbatimQuote: "Total Records: 42",
    confidence: "high",
    status: "proposed",
    reason: null,
    rejectionReason: null,
    bbox: null,
    resolvedAt: null,
    ...overrides,
  };
}

function fakeDb(facts: LedgerFact[]): { db: FactLedgerDb; calls: ResolveFactDbInput[] } {
  const calls: ResolveFactDbInput[] = [];
  return {
    calls,
    db: {
      async getFacts(factIds) {
        return facts.filter((fact) => factIds.includes(fact.id));
      },
      async resolveFact(input) {
        calls.push(input);
      },
    },
  };
}

describe("resolveFact — accept", () => {
  it("accepts a fact without touching the value or a rejection reason", async () => {
    const { db, calls } = fakeDb([ledgerFact()]);

    const result = await resolveFact(db, "fact-1", { kind: "accept" });

    expect(result).toEqual({ ok: true });
    expect(calls).toEqual([{ factId: "fact-1", status: "accepted", resolvedValue: null, rejectionReason: null }]);
  });

  it("accepts a low-confidence fact individually — only bulk accept is restricted", async () => {
    const { db, calls } = fakeDb([ledgerFact({ confidence: "low" })]);

    const result = await resolveFact(db, "fact-1", { kind: "accept" });

    expect(result).toEqual({ ok: true });
    expect(calls).toHaveLength(1);
  });

  it("refuses a fact that no longer exists, without writing anything", async () => {
    const { db, calls } = fakeDb([]);

    const result = await resolveFact(db, "gone", { kind: "accept" });

    expect(result).toEqual({ ok: false, message: expect.stringContaining("no longer exists") });
    expect(calls).toHaveLength(0);
  });
});

describe("resolveFact — edit", () => {
  it("stores the human value in an envelope, leaving the model's own value alone", async () => {
    const { db, calls } = fakeDb([ledgerFact()]);

    const result = await resolveFact(db, "fact-1", { kind: "edit", value: 43 });

    expect(result).toEqual({ ok: true });
    expect(calls).toEqual([{ factId: "fact-1", status: "edited", resolvedValue: { value: 43 }, rejectionReason: null }]);
  });

  it("trims a string value", async () => {
    const { db, calls } = fakeDb([ledgerFact({ proposedValue: "Approved", confirmedValue: "Approved" })]);

    await resolveFact(db, "fact-1", { kind: "edit", value: "  Rejected by bank  " });

    expect(calls[0]!.resolvedValue).toEqual({ value: "Rejected by bank" });
  });

  it("keeps a list value as a list", async () => {
    const { db, calls } = fakeDb([ledgerFact()]);

    await resolveFact(db, "fact-1", { kind: "edit", value: ["Accommodation", "Transport"] });

    expect(calls[0]!.resolvedValue).toEqual({ value: ["Accommodation", "Transport"] });
  });

  it("keeps a boolean false value (not mistaken for an empty value)", async () => {
    const { db, calls } = fakeDb([ledgerFact()]);

    const result = await resolveFact(db, "fact-1", { kind: "edit", value: false });

    expect(result).toEqual({ ok: true });
    expect(calls[0]!.resolvedValue).toEqual({ value: false });
  });

  it("keeps a numeric zero (not mistaken for an empty value)", async () => {
    const { db, calls } = fakeDb([ledgerFact()]);

    const result = await resolveFact(db, "fact-1", { kind: "edit", value: 0 });

    expect(result).toEqual({ ok: true });
    expect(calls[0]!.resolvedValue).toEqual({ value: 0 });
  });

  it("refuses an empty edit — that is a rejection, not a confirmed absence", async () => {
    const { db, calls } = fakeDb([ledgerFact()]);

    const blank = await resolveFact(db, "fact-1", { kind: "edit", value: "   " });
    const nulled = await resolveFact(db, "fact-1", { kind: "edit", value: null });

    expect(blank).toEqual({ ok: false, message: expect.stringContaining("reject the fact instead") });
    expect(nulled).toEqual({ ok: false, message: expect.stringContaining("reject the fact instead") });
    expect(calls).toHaveLength(0);
  });
});

describe("resolveFact — reject", () => {
  it("records the trimmed reason", async () => {
    const { db, calls } = fakeDb([ledgerFact()]);

    const result = await resolveFact(db, "fact-1", { kind: "reject", reason: "  Wrong column read  " });

    expect(result).toEqual({ ok: true });
    expect(calls).toEqual([{ factId: "fact-1", status: "rejected", resolvedValue: null, rejectionReason: "Wrong column read" }]);
  });

  it("refuses a rejection with no reason, without writing anything", async () => {
    const { db, calls } = fakeDb([ledgerFact()]);

    const result = await resolveFact(db, "fact-1", { kind: "reject", reason: "   " });

    expect(result).toEqual({ ok: false, message: expect.stringContaining("reason") });
    expect(calls).toHaveLength(0);
  });
});

describe("bulkAcceptHighConfidence", () => {
  it("accepts only high-confidence proposed facts and reports the rest as skipped", async () => {
    const facts = [
      ledgerFact({ id: "high-1", confidence: "high" }),
      ledgerFact({ id: "medium-1", confidence: "medium" }),
      ledgerFact({ id: "low-1", confidence: "low" }),
      ledgerFact({ id: "high-resolved", confidence: "high", status: "accepted" }),
      ledgerFact({ id: "high-2", confidence: "high" }),
    ];
    const { db, calls } = fakeDb(facts);

    const result = await bulkAcceptHighConfidence(db, ["high-1", "medium-1", "low-1", "high-resolved", "high-2"]);

    expect(result).toEqual({ accepted: 2, skipped: ["medium-1", "low-1", "high-resolved"] });
    expect(calls.map((call) => call.factId)).toEqual(["high-1", "high-2"]);
  });

  it("records one individual action per fact, never one action for the batch", async () => {
    const facts = [1, 2, 3, 4].map((n) => ledgerFact({ id: `high-${n}` }));
    const { db, calls } = fakeDb(facts);

    const result = await bulkAcceptHighConfidence(db, facts.map((fact) => fact.id));

    expect(result.accepted).toBe(4);
    expect(calls).toHaveLength(4);
    expect(calls.every((call) => call.status === "accepted")).toBe(true);
  });

  it("re-checks eligibility against the database, not the ids the caller sent", async () => {
    // The client rendered this fact as high confidence, but the stored
    // fact is low — the stored row decides.
    const { db, calls } = fakeDb([ledgerFact({ id: "actually-low", confidence: "low" })]);

    const result = await bulkAcceptHighConfidence(db, ["actually-low"]);

    expect(result).toEqual({ accepted: 0, skipped: ["actually-low"] });
    expect(calls).toHaveLength(0);
  });

  it("skips an id that does not exist", async () => {
    const { db, calls } = fakeDb([]);

    const result = await bulkAcceptHighConfidence(db, ["gone"]);

    expect(result).toEqual({ accepted: 0, skipped: ["gone"] });
    expect(calls).toHaveLength(0);
  });
});
