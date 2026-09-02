import { buildExtractionSystemPrompt, type FactKeyDefinition } from "@/lib/ai/prompts/shared";
import { extractionResponseSchema } from "@/lib/ai/schema";

export const promptVersion = "v1";

export const factKeys = ["agency_name", "agency_employer_pays_clause_present", "agency_licence_present"] as const;

const FACT_KEY_DEFINITIONS: FactKeyDefinition[] = [
  {
    key: "agency_name",
    expectedType: "short text, copied verbatim",
    description: "The recruitment agency's name as printed on the agreement.",
  },
  {
    key: "agency_employer_pays_clause_present",
    expectedType: "boolean (true or false)",
    description:
      "Whether the document contains a clause stating the EMPLOYER (not the worker) pays recruitment fees. true if such a clause is visibly present; false if you can see the document does not contain one. Use false (not null/not_present) when the document is readable and simply lacks the clause — only use null/not_present or null/illegible when you cannot determine this at all.",
  },
  {
    key: "agency_licence_present",
    expectedType: "boolean (true or false)",
    description:
      "Whether the agency's licence number or licence details are shown anywhere on the document. true if visibly present; false if the document is readable and simply doesn't show one. Use false (not null/not_present) for a readable document with no licence details shown.",
  },
];

export const systemPrompt = buildExtractionSystemPrompt("recruitment agency agreement", FACT_KEY_DEFINITIONS);
export const responseSchema = extractionResponseSchema(factKeys);
