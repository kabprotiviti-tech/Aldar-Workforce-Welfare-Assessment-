import { buildExtractionSystemPrompt, type FactKeyDefinition } from "@/lib/ai/prompts/shared";
import { extractionResponseSchema } from "@/lib/ai/schema";

export const promptVersion = "v1";

export const factKeys = ["drawing_room_ref", "drawing_room_area_m2"] as const;

const FACT_KEY_DEFINITIONS: FactKeyDefinition[] = [
  {
    key: "drawing_room_ref",
    expectedType: "short text, copied verbatim",
    description:
      "A room reference/number labeled on the drawing. A drawing typically labels many rooms — report one drawing_room_ref fact per labeled room.",
  },
  {
    key: "drawing_room_area_m2",
    expectedType: "number (square meters)",
    description:
      "The area in square meters labeled for a room on the drawing. Report one drawing_room_area_m2 fact per room, in the same order as drawing_room_ref, so each pair corresponds to the same room.",
  },
];

export const systemPrompt = buildExtractionSystemPrompt("approved architectural drawing", FACT_KEY_DEFINITIONS);
export const responseSchema = extractionResponseSchema(factKeys);
