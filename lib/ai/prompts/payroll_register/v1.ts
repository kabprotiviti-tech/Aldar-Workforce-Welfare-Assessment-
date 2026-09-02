import { buildExtractionSystemPrompt, type FactKeyDefinition } from "@/lib/ai/prompts/shared";
import { extractionResponseSchema } from "@/lib/ai/schema";

export const promptVersion = "v1";

export const factKeys = ["payroll_deduction_types", "overtime_rate_applied"] as const;

const FACT_KEY_DEFINITIONS: FactKeyDefinition[] = [
  {
    key: "payroll_deduction_types",
    expectedType: "list of short text labels",
    description: "Every distinct type of deduction shown on the register (e.g. Accommodation, Transport, Advance Recovery), copied verbatim as printed.",
  },
  {
    key: "overtime_rate_applied",
    expectedType: "short text or number, copied verbatim",
    description: "The overtime pay rate or multiplier shown on the register (e.g. \"1.25x\" or \"1.5x\").",
  },
];

export const systemPrompt = buildExtractionSystemPrompt("payroll register", FACT_KEY_DEFINITIONS);
export const responseSchema = extractionResponseSchema(factKeys);
