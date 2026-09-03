import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { CLOSURE_SUBMITTED_STATUS, type FindingClosurePortalDb, type PortalFinding } from "@/lib/findings/closure-portal";

/**
 * Real adapter — used by the Route Handlers under app/api/findings/[token]/.
 * Always the service-role client (no Supabase session exists for a
 * portal visitor). Kept apart from lib/findings/closure-portal.ts's pure
 * orchestration for the same reason as lib/rfi/portal-supabase.ts:
 * importing the orchestration in a test never has to load "server-only"
 * or a real Supabase client.
 */
export function supabaseFindingClosurePortalDb(supabase: SupabaseClient = createSupabaseAdminClient()): FindingClosurePortalDb {
  return {
    async findTokenRecord(tokenHash) {
      const { data, error } = await supabase
        .from("finding_closure_tokens")
        .select("finding_id, expires_at, revoked_at")
        .eq("token_hash", tokenHash)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return {
        requestId: data.finding_id as string,
        expiresAt: data.expires_at as string,
        revokedAt: (data.revoked_at as string | null) ?? null,
      };
    },

    async recentAttemptTimestamps(tokenHash, sinceIso) {
      const { data, error } = await supabase
        .from("finding_closure_token_access_log")
        .select("created_at")
        .eq("token_hash", tokenHash)
        .gte("created_at", sinceIso);
      if (error) throw error;
      return (data ?? []).map((r) => new Date(r.created_at as string));
    },

    async logAttempt(tokenHash, ip, outcome) {
      const { error } = await supabase.from("finding_closure_token_access_log").insert({ token_hash: tokenHash, ip, outcome });
      if (error) throw error;
    },

    async getFinding(findingId) {
      const { data, error } = await supabase
        .from("findings")
        .select(
          "id, title, status, priority, due_date, owner_name, closure_evidence_text, assessment_items!inner(requirement_id, requirements(title), assessments(subject_code))",
        )
        .eq("id", findingId)
        .is("deleted_at", null)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;

      const item = (Array.isArray(data.assessment_items) ? data.assessment_items[0] : data.assessment_items) as
        | { requirements: { title: string } | { title: string }[] | null; assessments: { subject_code: string } | { subject_code: string }[] | null }
        | null;
      const requirement = item ? (Array.isArray(item.requirements) ? item.requirements[0] : item.requirements) : null;
      const assessment = item ? (Array.isArray(item.assessments) ? item.assessments[0] : item.assessments) : null;

      const finding: PortalFinding = {
        findingId: data.id as string,
        title: data.title as string,
        subjectCode: assessment?.subject_code ?? "",
        requirementTitle: requirement?.title ?? "",
        status: data.status as string,
        priority: data.priority as string,
        dueDate: (data.due_date as string | null) ?? null,
        ownerName: (data.owner_name as string | null) ?? null,
        closureNote: (data.closure_evidence_text as string | null) ?? null,
      };
      return finding;
    },

    async recordClosureSubmission(input) {
      const { data: finding, error: findingError } = await supabase
        .from("findings")
        .select("id, assessment_item_id, owner_contact_id, assessment_items(assessment_id, requirement_id)")
        .eq("id", input.findingId)
        .single();
      if (findingError) throw findingError;
      if (!finding.owner_contact_id) throw new Error("This finding has no owner contact to attribute the upload to.");

      const item = (Array.isArray(finding.assessment_items) ? finding.assessment_items[0] : finding.assessment_items) as
        | { assessment_id: string; requirement_id: string }
        | null;
      if (!item) throw new Error("Finding has no parent assessment item.");

      const { data: evidenceFile, error: insertError } = await supabase
        .from("evidence_files")
        .insert({
          assessment_id: item.assessment_id,
          requirement_id: item.requirement_id,
          finding_id: input.findingId,
          storage_path: input.storagePath,
          original_name: input.originalName,
          mime_type: input.mimeType,
          size_bytes: input.sizeBytes,
          document_class: "finding_closure_evidence",
          uploaded_by_contact_id: finding.owner_contact_id,
          virus_scan_status: input.virusScanStatus,
          virus_scanned_at: new Date().toISOString(),
        })
        .select("id")
        .single();
      if (insertError) throw insertError;

      const { error: updateError } = await supabase
        .from("findings")
        .update({ closure_evidence_text: input.note, status: CLOSURE_SUBMITTED_STATUS })
        .eq("id", input.findingId);
      if (updateError) throw updateError;

      const { error: eventError } = await supabase.from("finding_events").insert({
        finding_id: input.findingId,
        event_type: "closure_submitted",
        note: input.note,
      });
      if (eventError) throw eventError;

      return { evidenceFileId: evidenceFile.id as string };
    },
  };
}
