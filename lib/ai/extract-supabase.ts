import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { ExtractionDb } from "@/lib/ai/extract";

/**
 * Real adapter for extractions/extracted_facts — always the service-role
 * client, since neither table has an INSERT grant for `authenticated`
 * (0008_grants.sql: "written only by the service-role client"), the same
 * pattern extractions/extracted_facts/ai_observations have followed since
 * 0005_evidence_ai.sql. Kept in its own file, apart from
 * lib/ai/extract.ts's pure orchestration, so importing the orchestration
 * in a test never drags in "server-only" or admin-client construction —
 * see lib/rfi/portal.ts / lib/rfi/portal-supabase.ts for the precedent.
 */
export function supabaseExtractionDb(supabase: SupabaseClient = createSupabaseAdminClient()): ExtractionDb {
  return {
    async insertExtraction(input) {
      const { data, error } = await supabase
        .from("extractions")
        .insert({
          evidence_file_id: input.evidenceFileId,
          model: input.model,
          prompt_version: input.promptVersion,
          raw_response: input.rawResponse,
          input_tokens: input.inputTokens,
          output_tokens: input.outputTokens,
          cost_usd: input.costUsd,
          error: input.error,
        })
        .select("id")
        .single();
      if (error) throw error;
      return { extractionId: data.id as string };
    },

    async insertFacts(input) {
      if (input.facts.length === 0) return 0;
      const { data, error } = await supabase
        .from("extracted_facts")
        .insert(
          input.facts.map((fact) => ({
            extraction_id: input.extractionId,
            evidence_file_id: input.evidenceFileId,
            fact_key: fact.factKey,
            value_text: fact.valueText,
            value_number: fact.valueNumber,
            value_date: fact.valueDate,
            value_boolean: fact.valueBoolean,
            value_json: fact.valueJson,
            unit: fact.unit,
            page_ref: fact.pageRef,
            verbatim_quote: fact.verbatimQuote,
            confidence: fact.confidence,
            reason: fact.reason,
            group_ref: fact.groupRef,
            status: "proposed",
          })),
        )
        .select("id");
      if (error) throw error;
      return data?.length ?? 0;
    },
  };
}
