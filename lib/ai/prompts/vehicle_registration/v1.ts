import { buildExtractionSystemPrompt, type FactKeyDefinition } from "@/lib/ai/prompts/shared";
import { extractionResponseSchema } from "@/lib/ai/schema";

export const promptVersion = "v1";

export const factKeys = ["vehicle_registration_expiry_date"] as const;

const FACT_KEY_DEFINITIONS: FactKeyDefinition[] = [
  {
    key: "vehicle_registration_expiry_date",
    expectedType: "ISO date (YYYY-MM-DD)",
    description: "The registration's expiry date as printed on the document.",
  },
];

export const systemPrompt = buildExtractionSystemPrompt("vehicle registration document", FACT_KEY_DEFINITIONS);
export const responseSchema = extractionResponseSchema(factKeys);
