import { buildExtractionSystemPrompt, type FactKeyDefinition } from "@/lib/ai/prompts/shared";
import { extractionResponseSchema } from "@/lib/ai/schema";

export const promptVersion = "v2";

/**
 * v2 adds group_ref to v1's two fact keys, so an occupancy figure can be
 * matched back to its own row reliably after each fact is reviewed
 * individually and out of order — the same fix as
 * lib/ai/prompts/approved_drawing/v2.ts, for the same reason. Nothing
 * about what's extracted changes; only how the platform can put the two
 * columns of one row back together. See lib/rooms/group-facts.ts and
 * docs/decisions.md.
 */
export const factKeys = ["occupancy_room_ref", "occupancy_headcount"] as const;

const FACT_KEY_DEFINITIONS: FactKeyDefinition[] = [
  {
    key: "occupancy_room_ref",
    expectedType: "short text, copied verbatim",
    description:
      "A room reference/number listed on the schedule. This document typically lists many rooms — report one occupancy_room_ref fact per row.",
  },
  {
    key: "occupancy_headcount",
    expectedType: "integer",
    description: "The number of occupants recorded for a room on the schedule. Report one occupancy_headcount fact per row.",
  },
];

export const systemPrompt =
  buildExtractionSystemPrompt("accommodation occupancy schedule", FACT_KEY_DEFINITIONS) +
  `

One more rule, specific to this document: set "group_ref" on both facts for one row to that row's occupancy_room_ref value, exactly as printed — the same string on both facts about the same row, e.g.:
{"facts": [
  {"fact_key": "occupancy_room_ref", "value": "204", "group_ref": "204", "unit": null, "page_ref": "page 1, row 6", "verbatim_quote": "204", "confidence": "high", "reason": null},
  {"fact_key": "occupancy_headcount", "value": 8, "group_ref": "204", "unit": null, "page_ref": "page 1, row 6", "verbatim_quote": "8", "confidence": "high", "reason": null}
]}`;

export const responseSchema = extractionResponseSchema(factKeys);
