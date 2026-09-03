import { describe, expect, it } from "vitest";
import { planAnalysisResolution, type ResolveAnalysisInput } from "@/lib/vision/resolve";
import type { AnalysedReading } from "@/lib/vision/analyse";

function textReading(field: string, verbatim: string, overrides: Partial<AnalysedReading> = {}): AnalysedReading {
  return {
    field,
    kind: "text",
    description: "",
    observed: "present",
    countInFrame: null,
    values: [],
    verbatimText: verbatim,
    condition: null,
    confidence: "high",
    derivedFact: null,
    ...overrides,
  };
}

const SERVICE_DATE = textReading("service_date_text", "12/03/2025", {
  derivedFact: { factKeyChoices: ["fire_extinguisher_service_date"], valueType: "date", label: "Last service date", verbatimText: "12/03/2025" },
});

const BED_COUNT: AnalysedReading = {
  field: "bed_count_in_frame",
  kind: "count_in_frame",
  description: "",
  observed: "present",
  countInFrame: 6,
  values: [],
  verbatimText: null,
  condition: null,
  confidence: "high",
  derivedFact: null,
};

function input(overrides: Partial<ResolveAnalysisInput> = {}): ResolveAnalysisInput {
  return { analysisId: "a1", photoClass: "fire_extinguisher", readings: [SERVICE_DATE], action: "accept", ...overrides };
}

describe("planAnalysisResolution", () => {
  it("accepts an analysis without producing any fact — most readings are observations", () => {
    const result = planAnalysisResolution(input());
    expect(result).toEqual({
      ok: true,
      plan: { analysisId: "a1", status: "accepted", editedFindings: null, rejectionReason: null, derivedFacts: [] },
    });
  });

  it("turns a confirmed date reading into a fact carrying the assessor's date and the model's verbatim reading", () => {
    const result = planAnalysisResolution(
      input({ confirmed: [{ field: "service_date_text", factKey: "fire_extinguisher_service_date", value: "2025-03-12" }] }),
    );

    expect(result.ok).toBe(true);
    expect(result.ok && result.plan.derivedFacts).toEqual([
      {
        fact_key: "fire_extinguisher_service_date",
        value_text: null,
        value_date: "2025-03-12",
        unit: null,
        verbatim_quote: "12/03/2025",
        confidence: "high",
      },
    ]);
  });

  it("will not resolve an ambiguous printed date for the assessor", () => {
    // The model returned "12/03/2025" and never says which is the month.
    // The assessor reads the photograph and enters the date; a plan built
    // from the printed string alone is refused.
    const result = planAnalysisResolution(
      input({ confirmed: [{ field: "service_date_text", factKey: "fire_extinguisher_service_date", value: "12/03/2025" }] }),
    );

    expect(result).toEqual({ ok: false, message: "Enter last service date as a date (YYYY-MM-DD), read from the photograph." });
  });

  it("records a text reading as the assessor's corrected text", () => {
    const plate = textReading("registration_plate_text", "AUH  12345", {
      derivedFact: { factKeyChoices: ["vehicle_registration_plate"], valueType: "text", label: "Registration plate", verbatimText: "AUH  12345" },
    });
    const result = planAnalysisResolution(
      input({
        photoClass: "vehicle",
        readings: [plate],
        confirmed: [{ field: "registration_plate_text", factKey: "vehicle_registration_plate", value: " AUH 12345 " }],
      }),
    );

    expect(result.ok && result.plan.derivedFacts[0]).toMatchObject({ value_text: "AUH 12345", value_date: null, verbatim_quote: "AUH  12345" });
  });

  it("lets the assessor say which certificate they photographed, within the declared choices", () => {
    const expiry = textReading("expiry_date_text", "Valid to 31-12-2026", {
      derivedFact: {
        factKeyChoices: ["photo_certificate_expiry_date", "civil_defence_expiry_date", "vehicle_registration_expiry_date"],
        valueType: "date",
        label: "Certificate expiry date",
        verbatimText: "Valid to 31-12-2026",
      },
    });

    const chosen = planAnalysisResolution(
      input({
        photoClass: "certificate_document",
        readings: [expiry],
        confirmed: [{ field: "expiry_date_text", factKey: "civil_defence_expiry_date", value: "2026-12-31" }],
      }),
    );
    expect(chosen.ok && chosen.plan.derivedFacts[0]!.fact_key).toBe("civil_defence_expiry_date");

    const invented = planAnalysisResolution(
      input({
        photoClass: "certificate_document",
        readings: [expiry],
        confirmed: [{ field: "expiry_date_text", factKey: "insurance_policy_start_date", value: "2026-12-31" }],
      }),
    );
    expect(invented).toEqual({ ok: false, message: "insurance_policy_start_date is not a fact key this reading can be recorded under." });
  });

  it("refuses to turn an observation into a fact", () => {
    const result = planAnalysisResolution(
      input({
        photoClass: "room_general",
        readings: [BED_COUNT],
        confirmed: [{ field: "bed_count_in_frame", factKey: "fire_extinguisher_service_date", value: "6" }],
      }),
    );

    expect(result).toEqual({ ok: false, message: "bed_count_in_frame is an observation, not a reading that can become a fact." });
  });

  it("refuses a field that was not part of the analysis", () => {
    const result = planAnalysisResolution(
      input({ confirmed: [{ field: "expiry_date_text", factKey: "fire_extinguisher_expiry_date", value: "2026-01-01" }] }),
    );
    expect(result).toEqual({ ok: false, message: "expiry_date_text is not part of this analysis." });
  });

  it("refuses the same field twice", () => {
    const result = planAnalysisResolution(
      input({
        confirmed: [
          { field: "service_date_text", factKey: "fire_extinguisher_service_date", value: "2025-03-12" },
          { field: "service_date_text", factKey: "fire_extinguisher_service_date", value: "2025-04-12" },
        ],
      }),
    );
    expect(result).toEqual({ ok: false, message: "service_date_text was confirmed twice." });
  });

  it("refuses an empty text value", () => {
    const plate = textReading("registration_plate_text", "AUH 12345", {
      derivedFact: { factKeyChoices: ["vehicle_registration_plate"], valueType: "text", label: "Registration plate", verbatimText: "AUH 12345" },
    });
    const result = planAnalysisResolution(
      input({ photoClass: "vehicle", readings: [plate], confirmed: [{ field: "registration_plate_text", factKey: "vehicle_registration_plate", value: "   " }] }),
    );
    expect(result).toEqual({ ok: false, message: "Registration plate cannot be recorded as an empty value." });
  });

  it("keeps a rejection with its reason and produces nothing else", () => {
    const result = planAnalysisResolution(input({ action: "reject", rejectionReason: "  Photograph is of the wrong room.  " }));
    expect(result).toEqual({
      ok: true,
      plan: {
        analysisId: "a1",
        status: "rejected",
        editedFindings: null,
        rejectionReason: "Photograph is of the wrong room.",
        derivedFacts: [],
      },
    });
  });

  it("refuses a rejection with no reason", () => {
    expect(planAnalysisResolution(input({ action: "reject", rejectionReason: "   " }))).toEqual({
      ok: false,
      message: "Say why you are rejecting this analysis. The reason is kept with it.",
    });
    expect(planAnalysisResolution(input({ action: "reject" })).ok).toBe(false);
  });

  it("refuses a rejection that also confirms a fact", () => {
    const result = planAnalysisResolution(
      input({
        action: "reject",
        rejectionReason: "Wrong extinguisher.",
        confirmed: [{ field: "service_date_text", factKey: "fire_extinguisher_service_date", value: "2025-03-12" }],
      }),
    );
    expect(result).toEqual({ ok: false, message: "A rejected analysis cannot also produce a confirmed fact." });
  });

  it("takes an edit's confirmed readings from the assessor's version, not the model's", () => {
    const corrected = textReading("service_date_text", "12/03/2025", {
      confidence: "medium",
      derivedFact: { factKeyChoices: ["fire_extinguisher_service_date"], valueType: "date", label: "Last service date", verbatimText: "12/03/2025" },
    });

    const result = planAnalysisResolution(
      input({
        action: "edit",
        editedReadings: [corrected],
        confirmed: [{ field: "service_date_text", factKey: "fire_extinguisher_service_date", value: "2025-03-12" }],
      }),
    );

    expect(result.ok && result.plan.status).toBe("edited");
    expect(result.ok && result.plan.editedFindings).toEqual([corrected]);
    expect(result.ok && result.plan.derivedFacts[0]!.confidence).toBe("medium");
  });

  it("refuses an edit with no corrected readings", () => {
    expect(planAnalysisResolution(input({ action: "edit" }))).toEqual({ ok: false, message: "An edit needs the corrected readings." });
    expect(planAnalysisResolution(input({ action: "edit", editedReadings: [] })).ok).toBe(false);
  });
});
