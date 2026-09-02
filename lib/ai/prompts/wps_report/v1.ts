import { buildExtractionSystemPrompt, type FactKeyDefinition } from "@/lib/ai/prompts/shared";
import { extractionResponseSchema } from "@/lib/ai/schema";

export const promptVersion = "v1";

export const factKeys = ["wps_transfer_date", "wps_record_count", "wps_batch_status"] as const;

const FACT_KEY_DEFINITIONS: FactKeyDefinition[] = [
  {
    key: "wps_transfer_date",
    expectedType: "ISO date (YYYY-MM-DD)",
    description: "The date the WPS salary transfer batch was submitted or processed.",
  },
  {
    key: "wps_record_count",
    expectedType: "integer",
    description: "The number of worker salary records included in this WPS batch.",
  },
  {
    key: "wps_batch_status",
    expectedType: "short text, copied verbatim from the document",
    description: "The batch's processing status label exactly as printed on the report (e.g. Approved, Rejected, Processed).",
  },
];

export const systemPrompt = buildExtractionSystemPrompt("WPS (Wage Protection System) transfer report", FACT_KEY_DEFINITIONS);
export const responseSchema = extractionResponseSchema(factKeys);
