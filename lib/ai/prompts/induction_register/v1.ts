import { buildExtractionSystemPrompt, type FactKeyDefinition } from "@/lib/ai/prompts/shared";
import { extractionResponseSchema } from "@/lib/ai/schema";

export const promptVersion = "v1";

export const factKeys = ["induction_attendance_count"] as const;

const FACT_KEY_DEFINITIONS: FactKeyDefinition[] = [
  {
    key: "induction_attendance_count",
    expectedType: "integer",
    description: "The number of workers recorded as having attended induction on this register.",
  },
];

export const systemPrompt = buildExtractionSystemPrompt("induction attendance register", FACT_KEY_DEFINITIONS);
export const responseSchema = extractionResponseSchema(factKeys);
