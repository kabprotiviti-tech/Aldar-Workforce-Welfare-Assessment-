import { z } from "zod";
import { factConfidenceSchema, factAbsenceReasonSchema } from "@/lib/db/evidence";

/**
 * Shared shape every extraction prompt's response is validated against
 * (this prompt: "every returned fact carries: fact_key, value, unit,
 * page_ref, verbatim_quote, confidence"). One factory, parameterized by
 * the fact_key vocabulary each document class actually supports
 * (lib/ai/prompts/<class>/v1.ts) — so an off-vocabulary fact_key is a
 * validation failure, not silently accepted.
 *
 * `value`'s own type is intentionally loose (string | number | boolean |
 * string[] | null) rather than precisely typed per fact_key — the
 * fact_key enum is what actually enforces CONTEXT.md's fixed-vocabulary
 * discipline; a discriminated union keyed by fact_key would be more
 * precise but isn't needed for this prompt's acceptance criteria. See
 * docs/decisions.md.
 */
export const factValueSchema = z.union([z.string(), z.number(), z.boolean(), z.array(z.string()), z.null()]);

export function extractedFactSchema<K extends readonly [string, ...string[]]>(factKeys: K) {
  return z
    .object({
      fact_key: z.enum(factKeys),
      value: factValueSchema,
      unit: z.string().nullable(),
      page_ref: z.string().nullable(),
      verbatim_quote: z.string().nullable(),
      confidence: factConfidenceSchema,
      /** This prompt: {"value": null, "reason": "not_present" | "illegible"} when a fact can't be read off the document. */
      reason: factAbsenceReasonSchema.nullable(),
      /**
       * Which entry this fact is about, for a document that lists many
       * of the same kind of thing — a room on a drawing, a row on an
       * occupancy schedule. Optional so every existing prompt keeps
       * working unchanged; only a per-class prompt that actually asks
       * for it (lib/ai/prompts/approved_drawing/v2.ts,
       * lib/ai/prompts/occupancy_schedule/v2.ts) will ever see one.
       * Never set by an assessor's later edit — see
       * lib/rooms/group-facts.ts.
       */
      group_ref: z.string().min(1).nullable().optional(),
    })
    .refine((fact) => (fact.value === null) === (fact.reason !== null), {
      message: "reason must be set exactly when value is null",
    });
}

export type ExtractedFact<K extends readonly [string, ...string[]] = [string, ...string[]]> = z.infer<
  ReturnType<typeof extractedFactSchema<K>>
>;

export function extractionResponseSchema<K extends readonly [string, ...string[]]>(factKeys: K) {
  return z.object({ facts: z.array(extractedFactSchema(factKeys)) });
}

export type ExtractionResponse<K extends readonly [string, ...string[]] = [string, ...string[]]> = z.infer<
  ReturnType<typeof extractionResponseSchema<K>>
>;
