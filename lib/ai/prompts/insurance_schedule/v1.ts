import { buildExtractionSystemPrompt, type FactKeyDefinition } from "@/lib/ai/prompts/shared";
import { extractionResponseSchema } from "@/lib/ai/schema";

export const promptVersion = "v1";

export const factKeys = ["insurance_policy_start_date", "insurance_emirates_covered"] as const;

const FACT_KEY_DEFINITIONS: FactKeyDefinition[] = [
  {
    key: "insurance_policy_start_date",
    expectedType: "ISO date (YYYY-MM-DD)",
    description: "The policy's start/inception date as printed on the schedule.",
  },
  {
    key: "insurance_emirates_covered",
    expectedType: "list of short text labels",
    description: "Every UAE emirate listed as covered by the policy (e.g. Abu Dhabi, Dubai), copied verbatim as printed.",
  },
];

export const systemPrompt = buildExtractionSystemPrompt("insurance policy schedule", FACT_KEY_DEFINITIONS);
export const responseSchema = extractionResponseSchema(factKeys);
