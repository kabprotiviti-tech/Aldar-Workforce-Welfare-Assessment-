import { buildExtractionSystemPrompt, type FactKeyDefinition } from "@/lib/ai/prompts/shared";
import { extractionResponseSchema } from "@/lib/ai/schema";

export const promptVersion = "v1";

export const factKeys = ["passport_return_hours"] as const;

const FACT_KEY_DEFINITIONS: FactKeyDefinition[] = [
  {
    key: "passport_return_hours",
    expectedType: "number (hours)",
    description:
      "The maximum number of hours within which a worker's passport must be returned to them upon request, as stated in the register or its accompanying policy text.",
  },
];

export const systemPrompt = buildExtractionSystemPrompt("passport register", FACT_KEY_DEFINITIONS);
export const responseSchema = extractionResponseSchema(factKeys);
