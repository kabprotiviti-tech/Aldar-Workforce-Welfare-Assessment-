"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { analyseStoredPhoto } from "@/lib/vision/analyse-supabase";
import { PHOTO_CLASSES, type PhotoClass } from "@/lib/vision/classes";
import { planAnalysisResolution, type AnalysisAction, type ConfirmedReading } from "@/lib/vision/resolve";
import type { AnalysedReading } from "@/lib/vision/analyse";

/**
 * The two things a person does with photograph analysis: ask for it, and
 * decide on it.
 *
 * Authorization for the decision is the database's, the same shape as
 * the fact ledger (lib/facts/actions.ts): resolve_photo_analysis checks
 * is_staff() itself and runs through the caller's own session-scoped
 * client, so auth.uid() — recorded as the audit actor, as reviewed_by,
 * and as resolved_by on any fact the decision creates — is the real
 * assessor and never a service role.
 */

export type VisionActionResult = { ok: true } | { ok: false; message: string };

const confirmedReadingSchema = z.object({
  field: z.string().min(1),
  factKey: z.string().min(1),
  value: z.string(),
});

const resolveInputSchema = z.object({
  analysisId: z.string().uuid(),
  assessmentId: z.string().uuid(),
  action: z.enum(["accept", "edit", "reject"]),
  rejectionReason: z.string().optional(),
  editedReadings: z.array(z.custom<AnalysedReading>()).optional(),
  confirmed: z.array(confirmedReadingSchema).optional(),
});

function friendlyError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/only staff may resolve/i.test(message)) return "You don't have permission to review photograph analysis.";
  if (/already been resolved/i.test(message)) return "Someone has already reviewed this analysis.";
  if (/is not a fact key a photograph may produce/i.test(message)) {
    return "That reading cannot be recorded as a fact from a photograph.";
  }
  return message;
}

/**
 * Runs the analysis for one already-synced photograph. Requested rather
 * than automatic: an assessor decides which photographs are worth the
 * call, and the platform does not quietly spend money on every frame
 * taken during a site visit.
 */
export async function analyseInspectionPhoto(photoId: string, assessmentId: string): Promise<VisionActionResult> {
  const supabase = await createSupabaseServerClient();

  // Read through the caller's session first, so RLS decides whether they
  // may see this photograph at all before the service role touches it.
  const { data: photo, error } = await supabase
    .from("photos")
    .select("id, storage_path, photo_class, room_ref, assessment_id")
    .eq("id", photoId)
    .eq("assessment_id", assessmentId)
    .maybeSingle();
  if (error) return { ok: false, message: error.message };
  if (!photo) return { ok: false, message: "That photograph is not part of this assessment." };

  const photoClass = photo.photo_class as string | null;
  if (!photoClass || !(PHOTO_CLASSES as readonly string[]).includes(photoClass)) {
    return { ok: false, message: "Classify the photograph before analysing it." };
  }

  try {
    await analyseStoredPhoto({
      id: photo.id as string,
      storagePath: photo.storage_path as string,
      photoClass: photoClass as PhotoClass,
      roomRef: (photo.room_ref as string | null) ?? null,
    });
  } catch (err) {
    return { ok: false, message: friendlyError(err) };
  }

  revalidatePath(`/app/assessments/${assessmentId}/photos`);
  return { ok: true };
}

/** Accept, edit or reject one analysis, and create the facts the assessor confirmed. */
export async function resolvePhotoAnalysis(raw: {
  analysisId: string;
  assessmentId: string;
  action: AnalysisAction;
  rejectionReason?: string;
  editedReadings?: AnalysedReading[];
  confirmed?: ConfirmedReading[];
}): Promise<VisionActionResult> {
  const parsed = resolveInputSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, message: "That review could not be read." };

  const supabase = await createSupabaseServerClient();

  const { data: analysis, error } = await supabase
    .from("photo_analyses")
    .select("id, photo_class, findings, status, photos!inner(assessment_id)")
    .eq("id", parsed.data.analysisId)
    .maybeSingle();
  if (error) return { ok: false, message: error.message };
  if (!analysis) return { ok: false, message: "That analysis no longer exists." };

  const photo = Array.isArray(analysis.photos) ? analysis.photos[0] : analysis.photos;
  if ((photo as { assessment_id: string } | null)?.assessment_id !== parsed.data.assessmentId) {
    return { ok: false, message: "That analysis is not part of this assessment." };
  }
  if (analysis.status !== "proposed") {
    return { ok: false, message: "Someone has already reviewed this analysis." };
  }

  const plan = planAnalysisResolution({
    analysisId: parsed.data.analysisId,
    photoClass: analysis.photo_class as PhotoClass,
    readings: (analysis.findings ?? []) as AnalysedReading[],
    action: parsed.data.action,
    rejectionReason: parsed.data.rejectionReason,
    editedReadings: parsed.data.editedReadings,
    confirmed: parsed.data.confirmed,
  });
  if (!plan.ok) return plan;

  const { error: rpcError } = await supabase.rpc("resolve_photo_analysis", {
    p_analysis_id: plan.plan.analysisId,
    p_status: plan.plan.status,
    p_edited_findings: plan.plan.editedFindings,
    p_rejection_reason: plan.plan.rejectionReason,
    p_derived_facts: plan.plan.derivedFacts,
  });
  if (rpcError) return { ok: false, message: friendlyError(rpcError) };

  revalidatePath(`/app/assessments/${parsed.data.assessmentId}/photos`);
  revalidatePath(`/app/assessments/${parsed.data.assessmentId}/evidence`);
  return { ok: true };
}

/** A short-lived URL for showing the photograph beside its analysis. */
export async function photoViewUrl(storagePath: string): Promise<string | null> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.storage.from("evidence").createSignedUrl(storagePath, 300);
  return error ? null : data.signedUrl;
}
