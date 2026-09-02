"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { validateUpload } from "@/lib/evidence/upload-validation";
import { classifyDocument } from "@/lib/evidence/classify";
import { documentClassSchema, evidenceReviewStatusSchema, type DocumentClass } from "@/lib/db/evidence";

function sanitizeFilename(filename: string): string {
  return filename.replace(/[^a-zA-Z0-9.\-]+/g, "-").replace(/-+/g, "-").slice(-150);
}

export interface RequestUploadInput {
  filename: string;
  mimeType: string;
  sizeBytes: number;
}

export type RequestUploadResult =
  | { ok: true; path: string; token: string; proposedDocumentClass: DocumentClass | null }
  | { ok: false; message: string };

/**
 * Server-side signed upload (this prompt). Validates and classifies
 * (lib/evidence/upload-validation.ts, lib/evidence/classify.ts — both
 * pure, unit tested), confirms the caller can actually see this
 * assessment (RLS on the normal session-scoped read below — the real
 * authorization check, before anything touches Storage), then issues a
 * short-lived signed upload URL via the service-role client. The browser
 * PUTs the file bytes directly to Supabase Storage using that URL/token —
 * never through this server — so a 40-50MB file never has to pass through
 * a Vercel serverless function's request body at all.
 */
export async function requestEvidenceUpload(assessmentId: string, input: RequestUploadInput): Promise<RequestUploadResult> {
  const validation = validateUpload({ filename: input.filename, sizeBytes: input.sizeBytes });
  if (!validation.ok) {
    return { ok: false, message: validation.message };
  }

  const supabase = await createSupabaseServerClient();
  const { data: assessment } = await supabase.from("assessments").select("id").eq("id", assessmentId).maybeSingle();
  if (!assessment) {
    return { ok: false, message: "Assessment not found." };
  }

  const proposedDocumentClass = classifyDocument({ filename: input.filename, mimeType: input.mimeType });
  const path = `evidence/${assessmentId}/${Date.now()}-${randomBytes(4).toString("hex")}-${sanitizeFilename(input.filename)}`;

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.storage.from("evidence").createSignedUploadUrl(path);
  if (error) {
    return { ok: false, message: error.message };
  }

  return { ok: true, path: data.path, token: data.token, proposedDocumentClass };
}

export interface ConfirmUploadInput {
  path: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  documentClass: string | null;
  requirementIds: string[];
}

export type ConfirmUploadResult = { ok: true; evidenceFileId: string } | { ok: false; message: string };

/** Records the evidence_files row (and requirement links) once the browser's direct-to-Storage PUT has completed. */
export async function confirmEvidenceUpload(assessmentId: string, input: ConfirmUploadInput): Promise<ConfirmUploadResult> {
  const documentClass = input.documentClass ? documentClassSchema.safeParse(input.documentClass) : null;

  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();

  const { data: file, error } = await supabase
    .from("evidence_files")
    .insert({
      assessment_id: assessmentId,
      storage_path: input.path,
      original_name: input.originalName,
      mime_type: input.mimeType,
      size_bytes: input.sizeBytes,
      document_class: documentClass?.success ? documentClass.data : null,
      uploaded_by: userData.user?.id,
    })
    .select("id")
    .single();
  if (error) {
    return { ok: false, message: error.message };
  }

  if (input.requirementIds.length > 0) {
    const { error: linkError } = await supabase
      .from("evidence_file_requirements")
      .insert(input.requirementIds.map((requirementId) => ({ evidence_file_id: file.id, requirement_id: requirementId })));
    if (linkError) {
      return { ok: false, message: linkError.message };
    }
  }

  revalidatePath(`/app/assessments/${assessmentId}/evidence`);
  return { ok: true, evidenceFileId: file.id as string };
}

export type SimpleResult = { ok: true } | { ok: false; message: string };

export async function updateReviewStatus(evidenceFileId: string, assessmentId: string, status: string): Promise<SimpleResult> {
  const parsed = evidenceReviewStatusSchema.safeParse(status);
  if (!parsed.success) {
    return { ok: false, message: "Not a valid review status." };
  }
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("evidence_files").update({ review_status: parsed.data }).eq("id", evidenceFileId);
  if (error) {
    return { ok: false, message: error.message };
  }
  revalidatePath(`/app/assessments/${assessmentId}/evidence`);
  return { ok: true };
}

export async function updateDocumentClass(evidenceFileId: string, assessmentId: string, documentClass: string): Promise<SimpleResult> {
  const parsed = documentClassSchema.safeParse(documentClass);
  if (!parsed.success) {
    return { ok: false, message: "Not a recognised document class." };
  }
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("evidence_files").update({ document_class: parsed.data }).eq("id", evidenceFileId);
  if (error) {
    return { ok: false, message: error.message };
  }
  revalidatePath(`/app/assessments/${assessmentId}/evidence`);
  return { ok: true };
}

export async function linkRequirement(evidenceFileId: string, assessmentId: string, requirementId: string): Promise<SimpleResult> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("evidence_file_requirements").insert({ evidence_file_id: evidenceFileId, requirement_id: requirementId });
  if (error) {
    return { ok: false, message: error.message };
  }
  revalidatePath(`/app/assessments/${assessmentId}/evidence`);
  return { ok: true };
}

export async function unlinkRequirement(evidenceFileId: string, assessmentId: string, requirementId: string): Promise<SimpleResult> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("evidence_file_requirements")
    .delete()
    .eq("evidence_file_id", evidenceFileId)
    .eq("requirement_id", requirementId);
  if (error) {
    return { ok: false, message: error.message };
  }
  revalidatePath(`/app/assessments/${assessmentId}/evidence`);
  return { ok: true };
}

export type PreviewUrlResult = { ok: true; url: string } | { ok: false; message: string };

/** A short-lived signed read URL for the preview panel — generated on demand, not for every file up front. */
export async function getEvidencePreviewUrl(storagePath: string): Promise<PreviewUrlResult> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.storage.from("evidence").createSignedUrl(storagePath, 300);
  if (error || !data) {
    return { ok: false, message: error?.message ?? "Could not generate a preview link." };
  }
  return { ok: true, url: data.signedUrl };
}
