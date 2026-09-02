import { buildExtractionSystemPrompt, type FactKeyDefinition } from "@/lib/ai/prompts/shared";
import { extractionResponseSchema } from "@/lib/ai/schema";

export const promptVersion = "v1";

export const factKeys = ["accommodation_contract_rooms"] as const;

const FACT_KEY_DEFINITIONS: FactKeyDefinition[] = [
  {
    key: "accommodation_contract_rooms",
    expectedType: "integer",
    description: "The number of rooms covered by the accommodation contract or lease, as stated in the document.",
  },
];

export const systemPrompt = buildExtractionSystemPrompt("accommodation contract or lease", FACT_KEY_DEFINITIONS);
export const responseSchema = extractionResponseSchema(factKeys);
