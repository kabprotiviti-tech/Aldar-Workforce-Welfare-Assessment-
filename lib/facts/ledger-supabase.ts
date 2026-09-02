import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ledgerFactFromRow, type ExtractedFactRowLike, type LedgerFact } from "@/lib/facts/ledger";
import type { FactLedgerDb } from "@/lib/facts/resolve";

/**
 * The fact ledger's data access — and, along with lib/ai/extract-supabase.ts
 * (which writes them), the ONLY place in the app that touches
 * extracted_facts directly. That's deliberate and tested
 * (tests/read-path.test.ts): the review list is the one surface whose
 * whole job is to show unreviewed facts to a person, so it reads the raw
 * table; everything downstream reads the fact_ledger_confirmed view
 * instead (0021_fact_ledger.sql) and therefore cannot see a 'proposed'
 * value at all.
 *
 * Always the caller's own session-scoped client, never the service-role
 * one: extracted_facts already grants select/update to `authenticated`
 * under staff-only policies (0005_evidence_ai.sql, 0008_grants.sql), so
 * RLS is doing the authorization here.
 */
const FACT_COLUMNS =
  "id, evidence_file_id, fact_key, value_text, value_number, value_date, value_boolean, value_json, unit, page_ref, verbatim_quote, confidence, status, reason, rejection_reason, resolved_value_json, bbox, resolved_at";

export function supabaseFactLedgerDb(supabase: SupabaseClient): FactLedgerDb {
  return {
    async getFacts(factIds) {
      if (factIds.length === 0) return [];
      const { data, error } = await supabase.from("extracted_facts").select(FACT_COLUMNS).in("id", factIds);
      if (error) throw error;
      return (data ?? []).map((row) => ledgerFactFromRow(row as unknown as ExtractedFactRowLike));
    },

    async resolveFact(input) {
      // One call, one transaction: the status change and its audit_log
      // row are inseparable — see 0021_fact_ledger.sql.
      const { error } = await supabase.rpc("resolve_extracted_fact", {
        p_fact_id: input.factId,
        p_status: input.status,
        p_resolved_value: input.resolvedValue,
        p_rejection_reason: input.rejectionReason,
      });
      if (error) throw error;
    },
  };
}

/**
 * The review list for a set of evidence files — every fact, `proposed`
 * ones included, because showing a person what hasn't been reviewed is
 * the point. Ordered by fact_key so a row keeps its place in the list as
 * it gets resolved.
 */
export async function listFactsForEvidenceFiles(supabase: SupabaseClient, evidenceFileIds: string[]): Promise<LedgerFact[]> {
  if (evidenceFileIds.length === 0) return [];
  const { data, error } = await supabase
    .from("extracted_facts")
    .select(FACT_COLUMNS)
    .in("evidence_file_id", evidenceFileIds)
    .order("fact_key")
    .order("created_at");
  if (error) throw error;
  return (data ?? []).map((row) => ledgerFactFromRow(row as unknown as ExtractedFactRowLike));
}
