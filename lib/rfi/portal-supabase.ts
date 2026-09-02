import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { PortalChecklistItem, RfiPortalDb } from "@/lib/rfi/portal";

/**
 * Real adapter — used by the Route Handlers under app/api/rfi/[token]/.
 * Always the service-role client (no Supabase session exists for a
 * portal visitor; RLS never applies here). Kept in its own file, apart
 * from lib/rfi/portal.ts's pure orchestration, purely so that importing
 * the orchestration logic in a test (tests/db/rfi-portal.test.ts) never
 * drags in "server-only" or lib/supabase/admin.ts's Supabase client
 * construction, neither of which a plain Vitest/Node process can load.
 */
export function supabaseRfiPortalDb(supabase: SupabaseClient = createSupabaseAdminClient()): RfiPortalDb {
  return {
    async findTokenRecord(tokenHash) {
      const { data, error } = await supabase
        .from("rfi_tokens")
        .select("rfi_request_id, expires_at, revoked_at")
        .eq("token_hash", tokenHash)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return {
        requestId: data.rfi_request_id as string,
        expiresAt: data.expires_at as string,
        revokedAt: (data.revoked_at as string | null) ?? null,
      };
    },

    async recentAttemptTimestamps(tokenHash, sinceIso) {
      const { data, error } = await supabase
        .from("rfi_token_access_log")
        .select("created_at")
        .eq("token_hash", tokenHash)
        .gte("created_at", sinceIso);
      if (error) throw error;
      return (data ?? []).map((r) => new Date(r.created_at as string));
    },

    async logAttempt(tokenHash, ip, outcome) {
      const { error } = await supabase.from("rfi_token_access_log").insert({ token_hash: tokenHash, ip, outcome });
      if (error) throw error;
    },

    async getChecklist(requestId) {
      const { data: request, error: requestError } = await supabase
        .from("rfi_requests")
        .select("id, assessment_id, contact_id, due_date, status, assessments(subject_code)")
        .eq("id", requestId)
        .is("deleted_at", null)
        .maybeSingle();
      if (requestError) throw requestError;
      if (!request) return null;

      const { data: items, error: itemsError } = await supabase
        .from("rfi_checklist_items")
        .select("id, name, status, requirement_id")
        .eq("rfi_request_id", requestId)
        .order("name");
      if (itemsError) throw itemsError;

      const subjectCode = (request.assessments as { subject_code: string } | { subject_code: string }[] | null) ?? null;

      return {
        requestId: request.id as string,
        assessmentId: request.assessment_id as string,
        subjectCode: Array.isArray(subjectCode) ? (subjectCode[0]?.subject_code ?? "") : (subjectCode?.subject_code ?? ""),
        contactId: request.contact_id as string,
        dueDate: request.due_date as string,
        status: request.status as string,
        items: (items ?? []).map((item) => ({
          id: item.id as string,
          name: item.name as string,
          status: item.status as PortalChecklistItem["status"],
          requirementId: item.requirement_id as string,
        })),
      };
    },

    async getChecklistItemRequestId(checklistItemId) {
      const { data, error } = await supabase
        .from("rfi_checklist_items")
        .select("rfi_request_id")
        .eq("id", checklistItemId)
        .maybeSingle();
      if (error) throw error;
      return (data?.rfi_request_id as string | undefined) ?? null;
    },

    async recordUpload(input) {
      const { data: item, error: itemError } = await supabase
        .from("rfi_checklist_items")
        .select("id, requirement_id, rfi_requests(id, assessment_id, contact_id)")
        .eq("id", input.checklistItemId)
        .single();
      if (itemError) throw itemError;

      const request = item.rfi_requests as
        | { id: string; assessment_id: string; contact_id: string }
        | { id: string; assessment_id: string; contact_id: string }[];
      const requestRow = Array.isArray(request) ? request[0] : request;
      if (!requestRow) throw new Error("Checklist item has no parent RFI request.");

      const { data: evidenceFile, error: insertError } = await supabase
        .from("evidence_files")
        .insert({
          assessment_id: requestRow.assessment_id,
          requirement_id: item.requirement_id,
          rfi_checklist_item_id: input.checklistItemId,
          storage_path: input.storagePath,
          original_name: input.originalName,
          mime_type: input.mimeType,
          size_bytes: input.sizeBytes,
          document_class: "rfi_upload",
          uploaded_by_contact_id: requestRow.contact_id,
          virus_scan_status: input.virusScanStatus,
          virus_scanned_at: new Date().toISOString(),
        })
        .select("id")
        .single();
      if (insertError) throw insertError;

      const { error: itemUpdateError } = await supabase
        .from("rfi_checklist_items")
        .update({ status: "received" })
        .eq("id", input.checklistItemId);
      if (itemUpdateError) throw itemUpdateError;

      const { count: outstandingCount, error: remainingError } = await supabase
        .from("rfi_checklist_items")
        .select("id", { count: "exact", head: true })
        .eq("rfi_request_id", requestRow.id)
        .eq("status", "outstanding");
      if (remainingError) throw remainingError;
      if (outstandingCount === 0) {
        const { error: completeError } = await supabase.from("rfi_requests").update({ status: "completed" }).eq("id", requestRow.id);
        if (completeError) throw completeError;
      }

      return { evidenceFileId: evidenceFile.id as string };
    },
  };
}
