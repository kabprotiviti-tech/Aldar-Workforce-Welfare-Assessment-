import { buildExtractionSystemPrompt, type FactKeyDefinition } from "@/lib/ai/prompts/shared";
import { extractionResponseSchema } from "@/lib/ai/schema";

export const promptVersion = "v1";

// offer_letter_allowance_value is here, not on its own document class: the
// fixed 14-value document_class vocabulary (lib/db/evidence.ts) has no
// separate "offer letter" class, so an assessor uploading an offer letter
// files it under employment_contract — the closest existing bucket. This
// prompt recognises either document and reports the matching fact key for
// whichever one it's actually looking at. See docs/decisions.md.
export const factKeys = ["contract_mohre_reference", "contract_allowance_value", "offer_letter_allowance_value"] as const;

const FACT_KEY_DEFINITIONS: FactKeyDefinition[] = [
  {
    key: "contract_mohre_reference",
    expectedType: "short text, copied verbatim",
    description: "The MOHRE (Ministry of Human Resources and Emiratisation) labour contract reference number, if this document is a signed employment contract.",
  },
  {
    key: "contract_allowance_value",
    expectedType: "short text or number, copied verbatim including currency",
    description: "The total allowance value stated in a signed employment contract (e.g. housing, transport, or other allowances).",
  },
  {
    key: "offer_letter_allowance_value",
    expectedType: "short text or number, copied verbatim including currency",
    description: "The total allowance value stated in an offer letter, if this document is an offer letter rather than a signed contract.",
  },
];

export const systemPrompt = buildExtractionSystemPrompt(
  "employment contract or offer letter",
  FACT_KEY_DEFINITIONS,
);
export const responseSchema = extractionResponseSchema(factKeys);
