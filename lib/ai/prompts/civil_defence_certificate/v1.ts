import { buildExtractionSystemPrompt, type FactKeyDefinition } from "@/lib/ai/prompts/shared";
import { extractionResponseSchema } from "@/lib/ai/schema";

export const promptVersion = "v1";

export const factKeys = ["civil_defence_expiry_date"] as const;

const FACT_KEY_DEFINITIONS: FactKeyDefinition[] = [
  {
    key: "civil_defence_expiry_date",
    expectedType: "ISO date (YYYY-MM-DD)",
    description: "The certificate's expiry date as printed on the document.",
  },
];

export const systemPrompt = buildExtractionSystemPrompt("civil defence certificate", FACT_KEY_DEFINITIONS);
export const responseSchema = extractionResponseSchema(factKeys);
