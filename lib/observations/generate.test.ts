import { describe, expect, it, vi } from "vitest";
import { buildUserText, generateObservations, type CallNarrativeFn, type ObservationInputs } from "./generate";
import { observationResponseSchema } from "@/lib/ai/prompts/observations/v1";

function inputs(overrides: Partial<ObservationInputs> = {}): ObservationInputs {
  return {
    assessmentItemId: "item-1",
    requirementId: "req-11",
    requirementSlNo: 11,
    requirementTitle: "Timely wage payment",
    requirementDetailText: "Wages must be transferred through the Wage Protection System.",
    facts: [
      {
        factKey: "wps_transfer_date",
        value: "2026-05-16",
        unit: null,
        pageRef: "page 1",
        verbatimQuote: "Transfer Date: 16/05/2026",
        evidenceFileId: "file-1",
      },
    ],
    ruleResults: [
      {
        ruleEvaluationId: "eval-1",
        ruleCode: "R11_WAGE_DATE",
        outcome: "fail",
        computedExplanation: "Wages for 2026-04 were transferred on 2026-05-16. Deadline is day 15 of the following month (2026-05-15). Late by 1 day.",
        legalReference: "WWAP checklist requirement 11",
      },
    ],
    previousFindings: [],
    ...overrides,
  };
}

function respondWith(payload: unknown, text?: string): CallNarrativeFn {
  return async () => ({
    text: text ?? JSON.stringify(payload),
    model: "claude-sonnet-4-6",
    inputTokens: 800,
    outputTokens: 200,
  });
}

const NARRATIVE = {
  rule_code: "R11_WAGE_DATE",
  title: "April wages transferred one day after the deadline",
  body: "The WPS file records the April 2026 transfer on 16 May 2026, one day after the 15 May deadline the rule applies.",
  source_fact_keys: ["wps_transfer_date"],
  page_ref: "page 1",
};

describe("the response schema has no field for a compliance status", () => {
  it("rejects a status field outright — there is nowhere to put one", () => {
    const withStatus = { observations: [{ ...NARRATIVE, status: "not_compliant" }] };

    expect(observationResponseSchema.safeParse(withStatus).success).toBe(false);
  });

  it("rejects rating, score and compliant fields too", () => {
    for (const key of ["rating", "score", "compliant"]) {
      const payload = { observations: [{ ...NARRATIVE, [key]: "anything" }] };
      expect(observationResponseSchema.safeParse(payload).success, key).toBe(false);
    }
  });

  it("accepts a clean narrative", () => {
    expect(observationResponseSchema.safeParse({ observations: [NARRATIVE] }).success).toBe(true);
  });
});

describe("generateObservations — the kind is set by code, not by the model", () => {
  it("maps a failing rule to requires_attention", async () => {
    const result = await generateObservations(respondWith({ observations: [NARRATIVE] }), inputs());

    expect(result.error).toBeNull();
    expect(result.observations).toHaveLength(1);
    expect(result.observations[0]!.kind).toBe("requires_attention");
  });

  it("maps a passing rule to evidence_identified", async () => {
    const result = await generateObservations(
      respondWith({ observations: [NARRATIVE] }),
      inputs({ ruleResults: [{ ...inputs().ruleResults[0]!, outcome: "pass" }] }),
    );

    expect(result.observations[0]!.kind).toBe("evidence_identified");
  });

  it("maps insufficient_data to potential_gap, never to evidence_identified", async () => {
    const result = await generateObservations(
      respondWith({ observations: [NARRATIVE] }),
      inputs({ ruleResults: [{ ...inputs().ruleResults[0]!, outcome: "insufficient_data" }] }),
    );

    expect(result.observations[0]!.kind).toBe("potential_gap");
  });

  it("ignores any kind the model tries to supply — the schema has no such field", async () => {
    const result = await generateObservations(respondWith({ observations: [{ ...NARRATIVE, kind: "evidence_identified" }] }), inputs());

    // A `kind` key is not status-like, so it isn't stripped; the strict
    // schema rejects the whole response instead.
    expect(result.observations).toEqual([]);
    expect(result.error).toContain("did not match the expected shape");
  });
});

describe("generateObservations — status-like keys are stripped and reported", () => {
  it("strips a status key, keeps the narrative, and reports the path for logging", async () => {
    const result = await generateObservations(
      respondWith({ observations: [{ ...NARRATIVE, status: "not_compliant" }] }),
      inputs(),
    );

    expect(result.error).toBeNull();
    expect(result.observations).toHaveLength(1);
    expect(result.strippedStatusKeys).toEqual(["observations[0].status"]);
    // The narrative survived, with the kind still decided by code.
    expect(result.observations[0]!.kind).toBe("requires_attention");
  });

  it("strips every status-like key it finds, at any depth", async () => {
    const result = await generateObservations(
      respondWith({ observations: [{ ...NARRATIVE, rating: "amber", score: 3 }], compliant: false }),
      inputs(),
    );

    expect(result.strippedStatusKeys.sort()).toEqual(["compliant", "observations[0].rating", "observations[0].score"]);
    expect(result.observations).toHaveLength(1);
  });

  it("leaves the word 'status' alone inside narrative text — keys are matched, not values", async () => {
    const body = "The WPS batch status column reads Approved for all 120 records on page 1.";
    const result = await generateObservations(
      respondWith({ observations: [{ ...NARRATIVE, body }] }),
      inputs(),
    );

    expect(result.strippedStatusKeys).toEqual([]);
    expect(result.observations[0]!.body).toBe(body);
  });
});

describe("generateObservations — an observation with no source reference is discarded", () => {
  it("discards a narrative that cites no supplied fact key", async () => {
    const result = await generateObservations(respondWith({ observations: [{ ...NARRATIVE, source_fact_keys: [] }] }), inputs());

    expect(result.observations).toEqual([]);
    expect(result.discarded).toEqual([
      { ruleCode: "R11_WAGE_DATE", reason: "No source reference: cited no supplied fact key and no evidence file." },
    ]);
  });

  it("drops an invented fact key, and discards the observation when nothing real is left", async () => {
    const result = await generateObservations(
      respondWith({ observations: [{ ...NARRATIVE, source_fact_keys: ["wps_secret_key"] }] }),
      inputs(),
    );

    expect(result.observations).toEqual([]);
    expect(result.discarded[0]!.reason).toContain("No source reference");
  });

  it("keeps only the real keys when the model cites a mix of real and invented ones", async () => {
    const result = await generateObservations(
      respondWith({ observations: [{ ...NARRATIVE, source_fact_keys: ["wps_transfer_date", "invented_key"] }] }),
      inputs(),
    );

    expect(result.observations[0]!.sourceFactKeys).toEqual(["wps_transfer_date"]);
  });

  it("carries the page reference and evidence file from the cited fact", async () => {
    const result = await generateObservations(respondWith({ observations: [NARRATIVE] }), inputs());

    expect(result.observations[0]!.pageRef).toBe("page 1");
    expect(result.observations[0]!.evidenceFileId).toBe("file-1");
  });

  it("falls back to a cited fact's own page reference when the model gave none", async () => {
    const result = await generateObservations(respondWith({ observations: [{ ...NARRATIVE, page_ref: null }] }), inputs());

    expect(result.observations[0]!.pageRef).toBe("page 1");
  });

  it("accepts an observation about a rule that reads no facts at all, sourced by its evaluation", async () => {
    // R16_HOURS evaluates assessor-entered figures, so no fact key
    // exists for its observation to cite.
    const result = await generateObservations(
      respondWith({ observations: [{ ...NARRATIVE, rule_code: "R16_HOURS", source_fact_keys: [], page_ref: null }] }),
      inputs({
        facts: [],
        ruleResults: [
          {
            ruleEvaluationId: "eval-16",
            ruleCode: "R16_HOURS",
            outcome: "fail",
            computedExplanation: "Per day 11 of 8; per week 66 of 48. Exceeds hours per day and hours per week.",
            legalReference: null,
          },
        ],
      }),
    );

    expect(result.discarded).toEqual([]);
    expect(result.observations[0]).toMatchObject({ ruleCode: "R16_HOURS", ruleEvaluationId: "eval-16", sourceFactKeys: [], evidenceFileId: null });
  });

  it("still requires a real source for an unrecognised rule code that was supplied as a result", async () => {
    const result = await generateObservations(
      respondWith({ observations: [{ ...NARRATIVE, rule_code: "R99_UNKNOWN", source_fact_keys: [], page_ref: null }] }),
      inputs({
        facts: [],
        ruleResults: [
          { ruleEvaluationId: "eval-99", ruleCode: "R99_UNKNOWN", outcome: "pass", computedExplanation: "n/a", legalReference: null },
        ],
      }),
    );

    expect(result.observations).toEqual([]);
    expect(result.discarded[0]!.reason).toContain("No source reference");
  });

  it("discards a narrative about a rule result that was not part of the request", async () => {
    const result = await generateObservations(respondWith({ observations: [{ ...NARRATIVE, rule_code: "R12_DEDUCTIONS" }] }), inputs());

    expect(result.observations).toEqual([]);
    expect(result.discarded).toEqual([
      { ruleCode: "R12_DEDUCTIONS", reason: "Names a rule result that was not part of the request." },
    ]);
  });
});

describe("generateObservations — failure modes never throw", () => {
  it("returns an error for a non-JSON response", async () => {
    const result = await generateObservations(respondWith(null, "I could not review this requirement."), inputs());

    expect(result.observations).toEqual([]);
    expect(result.error).toMatch(/not valid json/i);
  });

  it("reads a response wrapped in a markdown code fence", async () => {
    const fenced = `\`\`\`json\n${JSON.stringify({ observations: [NARRATIVE] })}\n\`\`\``;
    const result = await generateObservations(respondWith(null, fenced), inputs());

    expect(result.error).toBeNull();
    expect(result.observations).toHaveLength(1);
  });

  it("returns an error when the API call itself fails", async () => {
    const throwing: CallNarrativeFn = async () => {
      throw new Error("rate limited after 5 attempts");
    };

    const result = await generateObservations(throwing, inputs());

    expect(result.error).toBe("rate limited after 5 attempts");
    expect(result.observations).toEqual([]);
  });

  it("generates nothing, and calls no model, when the requirement has no rule results", async () => {
    const callNarrative = vi.fn();

    const result = await generateObservations(callNarrative, inputs({ ruleResults: [] }));

    expect(callNarrative).not.toHaveBeenCalled();
    expect(result.observations).toEqual([]);
    expect(result.error).toContain("No rule results");
  });

  it("records the model and token usage for a successful generation", async () => {
    const result = await generateObservations(respondWith({ observations: [NARRATIVE] }), inputs());

    expect(result.model).toBe("claude-sonnet-4-6");
    expect(result.inputTokens).toBe(800);
    expect(result.outputTokens).toBe(200);
    expect(result.observations[0]!.promptVersion).toBe("observations.v1");
  });
});

describe("buildUserText", () => {
  it("supplies the requirement, the facts with provenance, the computed working and last cycle's findings", () => {
    const text = buildUserText(
      inputs({
        previousFindings: [{ title: "Wages paid late in three of six months", priority: "high", status: "open", cycleName: "2025 Cycle 1" }],
      }),
    );

    expect(text).toContain("Requirement 11: Timely wage payment");
    expect(text).toContain("Clause detail: Wages must be transferred through the Wage Protection System.");
    expect(text).toContain('- wps_transfer_date: 2026-05-16, page 1, quoted as "Transfer Date: 16/05/2026"');
    expect(text).toContain("- R11_WAGE_DATE: Wages for 2026-04 were transferred on 2026-05-16.");
    expect(text).toContain("- Wages paid late in three of six months (priority high, currently open, 2025 Cycle 1)");
  });

  it("does not send the outcome word, so the model has no verdict to editorialise about", () => {
    const text = buildUserText(inputs());

    expect(text).not.toContain("fail");
    expect(text).not.toContain("pass");
  });

  it("says plainly when clause detail, facts or previous findings are absent", () => {
    const text = buildUserText(inputs({ requirementDetailText: null, facts: [], previousFindings: [] }));

    expect(text).toContain("Clause detail: not supplied.");
    expect(text).toContain("Confirmed facts (each has been reviewed and confirmed by an assessor):\n- none");
    expect(text).toContain("Findings raised for this requirement in the previous cycle:\n- none");
  });

  it("renders a list-valued fact readably", () => {
    const text = buildUserText(
      inputs({
        facts: [
          {
            factKey: "payroll_deduction_types",
            value: ["Accommodation", "Transport"],
            unit: null,
            pageRef: null,
            verbatimQuote: null,
            evidenceFileId: "file-2",
          },
        ],
      }),
    );

    expect(text).toContain("- payroll_deduction_types: Accommodation, Transport");
  });
});
