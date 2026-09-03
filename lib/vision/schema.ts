import { z } from "zod";
import { factConfidenceSchema } from "@/lib/db/evidence";
import { fieldKeysFor, type PhotoClass } from "@/lib/vision/classes";

/**
 * The shape a photograph analysis may take. Built per class from the
 * declared field vocabulary (lib/vision/classes.ts), so the enum of
 * permitted fields is generated rather than restated — a field that does
 * not exist in the class definition fails validation here.
 *
 * `.strict()` matters as much as the enum: an extra key is a failed
 * response, not a tolerated one. Between the two, there is no field in
 * which the model could report a floor area, a per-person ratio or an
 * occupancy total even if it wanted to. lib/vision/undeterminable.ts
 * covers the remaining route in, which is free text.
 */

export const observedStateSchema = z.enum(["present", "absent", "unclear"]);
export type ObservedState = z.infer<typeof observedStateSchema>;

export function photoReadingSchema<K extends readonly [string, ...string[]]>(fieldKeys: K) {
  return z
    .object({
      /** Which declared field of this class the reading is about. */
      field: z.enum(fieldKeys),
      /** Presence: is the thing there at all. "unclear" is a first-class answer, never a quiet "absent". */
      observed: observedStateSchema,
      /** Only meaningful for a count_in_frame field. Code nulls it everywhere else. */
      count_in_frame: z.number().int().min(0).max(200).nullable(),
      /** Only meaningful for a list field, and only values from that field's closed list survive. */
      values: z.array(z.string().min(1)).nullable(),
      /** A verbatim reading of text visible in the photograph. Only meaningful for a text field. */
      verbatim_text: z.string().min(1).max(400).nullable(),
      /** A short description of visible condition. */
      condition: z.string().min(1).max(300).nullable(),
      confidence: factConfidenceSchema,
    })
    .strict();
}

export function photoAnalysisResponseSchema<K extends readonly [string, ...string[]]>(fieldKeys: K) {
  return z
    .object({
      readings: z.array(photoReadingSchema(fieldKeys)),
      /** This prompt: every response must name what the photograph cannot establish. */
      cannot_determine: z.array(z.string().min(1).max(300)),
    })
    .strict();
}

export function responseSchemaFor(photoClass: PhotoClass) {
  return photoAnalysisResponseSchema(fieldKeysFor(photoClass));
}

export type PhotoReading = z.infer<ReturnType<typeof photoReadingSchema<[string, ...string[]]>>>;
export type PhotoAnalysisResponse = z.infer<ReturnType<typeof photoAnalysisResponseSchema<[string, ...string[]]>>>;
