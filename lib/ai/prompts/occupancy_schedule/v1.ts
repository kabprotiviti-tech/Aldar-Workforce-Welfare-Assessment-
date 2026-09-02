import { buildExtractionSystemPrompt, type FactKeyDefinition } from "@/lib/ai/prompts/shared";
import { extractionResponseSchema } from "@/lib/ai/schema";

export const promptVersion = "v1";

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
    description:
      "The number of occupants recorded for a room on the schedule. Report one occupancy_headcount fact per row, in the same order as occupancy_room_ref, so each pair corresponds to the same row.",
  },
];

export const systemPrompt = buildExtractionSystemPrompt("accommodation occupancy schedule", FACT_KEY_DEFINITIONS);
export const responseSchema = extractionResponseSchema(factKeys);
