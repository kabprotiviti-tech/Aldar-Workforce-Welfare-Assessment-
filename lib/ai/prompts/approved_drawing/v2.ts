import { buildExtractionSystemPrompt, type FactKeyDefinition } from "@/lib/ai/prompts/shared";
import { extractionResponseSchema } from "@/lib/ai/schema";

export const promptVersion = "v2";

/**
 * v2 replaces v1's single drawing_room_area_m2 fact (this prompt: "the
 * model returns printed values only... does not multiply dimensions,
 * does not convert units"). v1 asked the model to report an area
 * already resolved to square metres — which is a conversion, quietly
 * done by the model rather than in code, for any drawing that labels its
 * rooms in anything else. v2 asks for exactly what's printed: an area
 * value with its own unit, or a dimension pair with its own unit, and
 * nothing computed from either. See lib/rooms/area-calc.ts for where the
 * arithmetic actually happens, and docs/decisions.md.
 */
export const factKeys = [
  "drawing_room_ref",
  "drawing_room_area_value",
  "drawing_room_area_unit",
  "drawing_room_dimension_a",
  "drawing_room_dimension_b",
  "drawing_room_dimension_unit",
] as const;

const FACT_KEY_DEFINITIONS: FactKeyDefinition[] = [
  {
    key: "drawing_room_ref",
    expectedType: "short text, copied verbatim",
    description: "A room reference/number labeled on the drawing.",
  },
  {
    key: "drawing_room_area_value",
    expectedType: "number",
    description: "The room's area figure exactly as printed, with no unit conversion. Report {\"value\": null, \"reason\": \"not_present\"} if the drawing gives no printed area for this room.",
  },
  {
    key: "drawing_room_area_unit",
    expectedType: "short text, exactly as printed (e.g. \"m2\", \"sq m\", \"sq ft\")",
    description: "The unit the area figure above is printed in. Present exactly when drawing_room_area_value is present.",
  },
  {
    key: "drawing_room_dimension_a",
    expectedType: "number",
    description:
      "The first printed dimension for this room (e.g. the 6.20 in \"6.20 x 4.10\"). Report this and dimension_b only when the drawing prints dimensions for the room — do not compute or estimate dimensions from an area figure, and do not report dimensions at all when only an area value is printed.",
  },
  {
    key: "drawing_room_dimension_b",
    expectedType: "number",
    description: "The second printed dimension for this room (e.g. the 4.10 in \"6.20 x 4.10\").",
  },
  {
    key: "drawing_room_dimension_unit",
    expectedType: "short text, exactly as printed (e.g. \"m\", \"mm\", \"ft\")",
    description: "The unit both printed dimensions are in. Present exactly when dimension_a and dimension_b are present.",
  },
];

export const systemPrompt =
  buildExtractionSystemPrompt("approved architectural drawing", FACT_KEY_DEFINITIONS) +
  `

One more rule, specific to this document: a drawing typically labels many rooms. Every one of the six fact keys above must carry a "group_ref" field set to that room's own drawing_room_ref value, exactly as printed — the same string on all six facts about the same room, so they can be matched back together after each is reviewed individually. A document-wide fact would use group_ref: null, but every fact key in this document is room-specific, so none of them should ever be null.

Report one full set of the six fact keys per room the drawing labels, all six sharing that room's group_ref, e.g.:
{"facts": [
  {"fact_key": "drawing_room_ref", "value": "204", "group_ref": "204", "unit": null, "page_ref": "page 3", "verbatim_quote": "RM 204", "confidence": "high", "reason": null},
  {"fact_key": "drawing_room_area_value", "value": 26.4, "group_ref": "204", "unit": null, "page_ref": "page 3", "verbatim_quote": "26.4 m2", "confidence": "high", "reason": null},
  {"fact_key": "drawing_room_area_unit", "value": "m2", "group_ref": "204", "unit": null, "page_ref": "page 3", "verbatim_quote": "26.4 m2", "confidence": "high", "reason": null},
  {"fact_key": "drawing_room_dimension_a", "value": null, "group_ref": "204", "unit": null, "page_ref": null, "verbatim_quote": null, "confidence": "low", "reason": "not_present"},
  {"fact_key": "drawing_room_dimension_b", "value": null, "group_ref": "204", "unit": null, "page_ref": null, "verbatim_quote": null, "confidence": "low", "reason": "not_present"},
  {"fact_key": "drawing_room_dimension_unit", "value": null, "group_ref": "204", "unit": null, "page_ref": null, "verbatim_quote": null, "confidence": "low", "reason": "not_present"}
]}

Never compute an area from dimensions, never convert a dimension or an area between units, and never check whether a room's printed area agrees with its printed dimensions — report both exactly as printed and let the platform reconcile them.`;

export const responseSchema = extractionResponseSchema(factKeys);
