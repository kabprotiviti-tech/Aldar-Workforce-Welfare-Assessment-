import { z } from "zod";

/**
 * The Accommodation template's mandatory quantitative fields, captured on
 * assessment_items.quantitative regardless of the Yes/No/Unclear/Not
 * Applicable answer given for that area. Keyed by the area's sl_no
 * (1-12, matching public.requirements for the accommodation module —
 * see docs/schema.md) rather than a parallel slug, so there's one
 * canonical numbering, not two that can drift.
 *
 * The field LIST is exactly what was specified: location, capacity,
 * occupancy, area per resident in bedrooms, residents per toilet/shower/
 * washbasin, kitchen and mess hall details, clinic type/capacity/
 * provider, certificate and contract details with validity dates. Which
 * of those belongs on which of the 12 areas is this file's own judgment
 * call, not given directly, and needs confirming — see docs/decisions.md
 * for the assumed mapping and ACCOMMODATION_AREA_TITLES below for the
 * area each sl_no refers to.
 */
export const ACCOMMODATION_AREA_TITLES: Record<number, string> = {
  1: "General requirements",
  2: "Bedrooms",
  3: "Bathrooms",
  4: "Kitchens",
  5: "Mess halls",
  6: "Medical services",
  7: "Laundry",
  8: "Public health requirements",
  9: "Accommodation management",
  10: "Health safety and security",
  11: "Utilities",
  12: "Firefighting and alarm systems",
};

/** A certificate/contract with its validity window — reused across several areas. */
export const certificateSchema = z.object({
  type: z.string(),
  number: z.string().nullable(),
  issued_by: z.string().nullable(),
  valid_from: z.string().nullable(),
  valid_to: z.string().nullable(),
});
export type Certificate = z.infer<typeof certificateSchema>;

const noQuantitativeFieldsSchema = z.object({}).strict();

/** Area 1: General requirements — facility-level location/capacity/occupancy. */
export const generalRequirementsQuantitativeSchema = z.object({
  location: z.string(),
  capacity: z.number().int(),
  occupancy: z.number().int(),
  certificates: z.array(certificateSchema).default([]),
});

/** Area 2: Bedrooms. */
export const bedroomsQuantitativeSchema = z.object({
  area_m2_per_resident: z.number(),
});

/** Area 3: Bathrooms. */
export const bathroomsQuantitativeSchema = z.object({
  residents_per_toilet: z.number(),
  residents_per_shower: z.number(),
  residents_per_washbasin: z.number(),
});

/** Area 4: Kitchens. */
export const kitchensQuantitativeSchema = z.object({
  kitchen_details: z.object({
    count: z.number().int(),
    prep_capacity: z.number().int().nullable(),
    condition: z.string().nullable(),
  }),
});

/** Area 5: Mess halls. */
export const messHallsQuantitativeSchema = z.object({
  mess_hall_details: z.object({
    count: z.number().int(),
    seating_capacity: z.number().int().nullable(),
    condition: z.string().nullable(),
  }),
});

/** Area 6: Medical services. */
export const medicalServicesQuantitativeSchema = z.object({
  clinic_type: z.string().nullable(),
  clinic_capacity: z.number().int().nullable(),
  clinic_provider: z.string().nullable(),
  certificates: z.array(certificateSchema).default([]),
});

/** Area 11: Utilities — the "certificate and contract details" field applied here. */
export const utilitiesQuantitativeSchema = z.object({
  certificates: z.array(certificateSchema).default([]),
});

/** Area 12: Firefighting and alarm systems — likewise, its own certificates. */
export const firefightingQuantitativeSchema = z.object({
  certificates: z.array(certificateSchema).default([]),
});

/**
 * Areas 7-10 (Laundry, Public health requirements, Accommodation
 * management, Health safety and security) have no mandatory quantitative
 * field named in the brief — left empty rather than inventing one.
 */
export const accommodationQuantitativeSchemaBySlNo = {
  1: generalRequirementsQuantitativeSchema,
  2: bedroomsQuantitativeSchema,
  3: bathroomsQuantitativeSchema,
  4: kitchensQuantitativeSchema,
  5: messHallsQuantitativeSchema,
  6: medicalServicesQuantitativeSchema,
  7: noQuantitativeFieldsSchema,
  8: noQuantitativeFieldsSchema,
  9: noQuantitativeFieldsSchema,
  10: noQuantitativeFieldsSchema,
  11: utilitiesQuantitativeSchema,
  12: firefightingQuantitativeSchema,
} as const satisfies Record<number, z.ZodTypeAny>;

export type AccommodationAreaSlNo = keyof typeof accommodationQuantitativeSchemaBySlNo;

export function quantitativeSchemaForArea(slNo: number): z.ZodTypeAny {
  const schema = accommodationQuantitativeSchemaBySlNo[slNo as AccommodationAreaSlNo];
  if (!schema) {
    throw new Error(`No quantitative schema defined for accommodation area sl_no ${slNo}`);
  }
  return schema;
}
