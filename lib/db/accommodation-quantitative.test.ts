import { describe, expect, it } from "vitest";
import {
  bathroomsQuantitativeSchema,
  generalRequirementsQuantitativeSchema,
  quantitativeSchemaForArea,
} from "./accommodation-quantitative";

describe("accommodation quantitative schemas", () => {
  it("accepts a valid general requirements payload (area 1)", () => {
    const result = generalRequirementsQuantitativeSchema.safeParse({
      location: "Musaffah, Abu Dhabi",
      capacity: 500,
      occupancy: 480,
      certificates: [
        { type: "civil_defence", number: "CD-1234", issued_by: "ADCD", valid_from: "2025-01-01", valid_to: "2026-01-01" },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("rejects a bathrooms payload missing a required ratio (area 3)", () => {
    const result = bathroomsQuantitativeSchema.safeParse({
      residents_per_toilet: 8,
      residents_per_shower: 8,
    });
    expect(result.success).toBe(false);
  });

  it("looks up the right schema by sl_no and rejects an out-of-range one", () => {
    expect(quantitativeSchemaForArea(2)).toBeDefined();
    expect(() => quantitativeSchemaForArea(13)).toThrow(/no quantitative schema/i);
  });

  it("areas without a named quantitative field accept only an empty object", () => {
    const laundrySchema = quantitativeSchemaForArea(7);
    expect(laundrySchema.safeParse({}).success).toBe(true);
    expect(laundrySchema.safeParse({ unexpected: 1 }).success).toBe(false);
  });
});
