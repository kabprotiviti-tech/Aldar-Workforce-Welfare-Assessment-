import { describe, expect, it } from "vitest";
import { runQaChecklist, qaChecklistPasses, type QaChecklistInput, type QaChecklistItemInput } from "./checklist";

function item(overrides: Partial<QaChecklistItemInput> = {}): QaChecklistItemInput {
  return {
    itemId: "item-1",
    requirementSlNo: 1,
    requirementTitle: "Test requirement",
    status: "Compliant",
    remarks: "Looks fine.",
    actionRequired: null,
    wasAssessed: true,
    quantitative: null,
    hasPhoto: false,
    evidenceDetail: null,
    ...overrides,
  };
}

function epInput(overrides: Partial<QaChecklistInput> = {}): QaChecklistInput {
  return { module: "employment_practices", items: [item()], openObservationCount: 0, proposedFactCount: 0, ...overrides };
}

describe("runQaChecklist — every_item_has_status", () => {
  it("passes when every item has a status", () => {
    const results = runQaChecklist(epInput());
    expect(results.find((r) => r.id === "every_item_has_status")!.passed).toBe(true);
  });

  it("fails and names the item when status is null", () => {
    const results = runQaChecklist(epInput({ items: [item({ itemId: "a", status: null })] }));
    const check = results.find((r) => r.id === "every_item_has_status")!;
    expect(check.passed).toBe(false);
    expect(check.failingItemIds).toEqual(["a"]);
  });
});

describe("runQaChecklist — failing_items_have_closure_action", () => {
  it("fails a freshly-assessed Partial item with no remark or action", () => {
    const results = runQaChecklist(epInput({ items: [item({ itemId: "a", status: "Partial", remarks: null, actionRequired: null })] }));
    expect(results.find((r) => r.id === "failing_items_have_closure_action")!.passed).toBe(false);
  });

  it("passes a freshly-assessed Not Compliant item with both a remark and an action", () => {
    const results = runQaChecklist(
      epInput({ items: [item({ status: "Not Compliant", remarks: "Late payment.", actionRequired: "Transfer arrears by 30 June." })] }),
    );
    expect(results.find((r) => r.id === "failing_items_have_closure_action")!.passed).toBe(true);
  });

  it("passes a carried-forward Partial item with the CONTEXT.md boilerplate action 'N/A'", () => {
    const results = runQaChecklist(
      epInput({ items: [item({ status: "Partial", wasAssessed: false, remarks: "Carried forward.", actionRequired: "N/A" })] }),
    );
    expect(results.find((r) => r.id === "failing_items_have_closure_action")!.passed).toBe(true);
  });

  it("ignores Compliant items entirely", () => {
    const results = runQaChecklist(epInput({ items: [item({ status: "Compliant", remarks: null, actionRequired: null })] }));
    expect(results.find((r) => r.id === "failing_items_have_closure_action")!.passed).toBe(true);
  });
});

describe("runQaChecklist — not_applicable_has_remark", () => {
  it("fails a Not Applicable item with no remark", () => {
    const results = runQaChecklist(epInput({ items: [item({ status: "Not Applicable", remarks: null })] }));
    expect(results.find((r) => r.id === "not_applicable_has_remark")!.passed).toBe(false);
  });

  it("passes a Not Applicable item with a remark", () => {
    const results = runQaChecklist(epInput({ items: [item({ status: "Not Applicable", remarks: "No workers under 18 employed." })] }));
    expect(results.find((r) => r.id === "not_applicable_has_remark")!.passed).toBe(true);
  });
});

describe("runQaChecklist — quantitative_fields_present", () => {
  it("is not applicable outside Accommodation", () => {
    const results = runQaChecklist(epInput());
    expect(results.find((r) => r.id === "quantitative_fields_present")!.passed).toBe(true);
  });

  it("fails an Accommodation area missing its mandatory field", () => {
    const results = runQaChecklist({
      module: "accommodation",
      items: [item({ requirementSlNo: 2, quantitative: {} })], // bedrooms needs area_m2_per_resident
      openObservationCount: 0,
      proposedFactCount: 0,
    });
    expect(results.find((r) => r.id === "quantitative_fields_present")!.passed).toBe(false);
  });

  it("passes an Accommodation area with its mandatory field present", () => {
    const results = runQaChecklist({
      module: "accommodation",
      items: [item({ requirementSlNo: 2, quantitative: { area_m2_per_resident: 4.2 } })],
      openObservationCount: 0,
      proposedFactCount: 0,
    });
    expect(results.find((r) => r.id === "quantitative_fields_present")!.passed).toBe(true);
  });

  it("passes an area with no mandatory fields (e.g. Laundry, sl_no 7) even with nothing recorded", () => {
    const results = runQaChecklist({
      module: "accommodation",
      items: [item({ requirementSlNo: 7, quantitative: null })],
      openObservationCount: 0,
      proposedFactCount: 0,
    });
    expect(results.find((r) => r.id === "quantitative_fields_present")!.passed).toBe(true);
  });
});

describe("runQaChecklist — specific_numbers_present", () => {
  it("is not applicable for Accommodation", () => {
    const results = runQaChecklist({ module: "accommodation", items: [item()], openObservationCount: 0, proposedFactCount: 0 });
    expect(results.find((r) => r.id === "specific_numbers_present")!.passed).toBe(true);
  });

  it("ignores non-key requirements", () => {
    const results = runQaChecklist(epInput({ items: [item({ requirementSlNo: 1, evidenceDetail: null })] })); // sl_no 1 is not a key requirement
    expect(results.find((r) => r.id === "specific_numbers_present")!.passed).toBe(true);
  });

  it("fails a key requirement rated Compliant this cycle with no sample size recorded", () => {
    const results = runQaChecklist(epInput({ items: [item({ requirementSlNo: 5, evidenceDetail: null })] })); // sl_no 5 is key
    expect(results.find((r) => r.id === "specific_numbers_present")!.passed).toBe(false);
  });

  it("passes a key requirement with at least one sample size recorded", () => {
    const results = runQaChecklist(
      epInput({
        items: [item({ requirementSlNo: 5, evidenceDetail: { salaryTransferDates: [], deductionExamples: [], sampleSizes: [{ label: "Payroll", sampled: 12, population: 120 }] } })],
      }),
    );
    expect(results.find((r) => r.id === "specific_numbers_present")!.passed).toBe(true);
  });

  it("ignores a carried-forward key requirement (was_assessed false)", () => {
    const results = runQaChecklist(epInput({ items: [item({ requirementSlNo: 5, wasAssessed: false, evidenceDetail: null })] }));
    expect(results.find((r) => r.id === "specific_numbers_present")!.passed).toBe(true);
  });

  it("ignores a key requirement rated Not Applicable", () => {
    const results = runQaChecklist(epInput({ items: [item({ requirementSlNo: 5, status: "Not Applicable", remarks: "N/A", evidenceDetail: null })] }));
    expect(results.find((r) => r.id === "specific_numbers_present")!.passed).toBe(true);
  });
});

describe("runQaChecklist — observations_actioned / facts_resolved", () => {
  it("fails when observations are still open", () => {
    const results = runQaChecklist(epInput({ openObservationCount: 3 }));
    expect(results.find((r) => r.id === "observations_actioned")!.passed).toBe(false);
  });

  it("fails when facts are still proposed", () => {
    const results = runQaChecklist(epInput({ proposedFactCount: 2 }));
    expect(results.find((r) => r.id === "facts_resolved")!.passed).toBe(false);
  });

  it("passes when both are zero", () => {
    const results = runQaChecklist(epInput({ openObservationCount: 0, proposedFactCount: 0 }));
    expect(results.find((r) => r.id === "observations_actioned")!.passed).toBe(true);
    expect(results.find((r) => r.id === "facts_resolved")!.passed).toBe(true);
  });
});

describe("runQaChecklist — photos_attached", () => {
  it("is not applicable outside Accommodation", () => {
    const results = runQaChecklist(epInput({ items: [item({ hasPhoto: false })] }));
    expect(results.find((r) => r.id === "photos_attached")!.passed).toBe(true);
  });

  it("fails an Accommodation area with no photo", () => {
    const results = runQaChecklist({ module: "accommodation", items: [item({ hasPhoto: false })], openObservationCount: 0, proposedFactCount: 0 });
    expect(results.find((r) => r.id === "photos_attached")!.passed).toBe(false);
  });

  it("passes an Accommodation area with a photo attached", () => {
    const results = runQaChecklist({ module: "accommodation", items: [item({ hasPhoto: true })], openObservationCount: 0, proposedFactCount: 0 });
    expect(results.find((r) => r.id === "photos_attached")!.passed).toBe(true);
  });
});

describe("qaChecklistPasses", () => {
  it("is true only when every check passes", () => {
    expect(qaChecklistPasses(runQaChecklist(epInput()))).toBe(true);
  });

  it("is false when any single check fails", () => {
    expect(qaChecklistPasses(runQaChecklist(epInput({ openObservationCount: 1 })))).toBe(false);
  });
});
