"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/audit";
import { aiObservationKindSchema } from "@/lib/db/evidence";
import { generateObservations } from "@/lib/observations/generate";
import {
  callNarrative,
  loadObservationInputs,
  logStrippedStatusKeys,
  storeGeneratedObservations,
} from "@/lib/observations/generate-supabase";

/**
 * The assessor's actions on an observation — Confirm, Reject with a
 * reason, and Add one of their own (this prompt) — plus generation.
 *
 * None of these can set a compliance status: no action here touches
 * assessment_items.compliance_status, and the observation row has no such
 * column. That is the platform's standing promise, printed in the panel
 * itself ("The platform does not set compliance status").
 */

export type ObservationActionResult = { ok: true } | { ok: false; message: string };

export async function generateObservationsForItem(
  assessmentItemId: string,
  assessmentId: string,
): Promise<{ ok: true; stored: number; discarded: number } | { ok: false; message: string }> {
  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return { ok: false, message: "Sign in required." };

  const inputs = await loadObservationInputs(supabase, { assessmentItemId });
  if ("error" in inputs) return { ok: false, message: inputs.error };

  const result = await generateObservations(callNarrative, inputs);

  // Logged whether or not the response was otherwise usable: an attempt
  // to return a status is worth recording even when the response failed
  // validation for another reason.
  await logStrippedStatusKeys(userData.user.id, assessmentItemId, result.strippedStatusKeys, "observations.v1");

  if (result.error) return { ok: false, message: result.error };

  const stored = await storeGeneratedObservations(supabase, result.observations);
  revalidatePath(`/app/assessments/${assessmentId}/evidence`);
  return { ok: true, stored, discarded: result.discarded.length };
}

export async function confirmObservation(observationId: string, assessmentId: string): Promise<ObservationActionResult> {
  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return { ok: false, message: "Sign in required." };

  const { data, error } = await supabase
    .from("ai_observations")
    .update({ status: "confirmed", actioned_by: userData.user.id, actioned_at: new Date().toISOString(), rejection_reason: null })
    .eq("id", observationId)
    .select("id, kind, title")
    .maybeSingle();
  if (error) return { ok: false, message: error.message };
  if (!data) return { ok: false, message: "That observation no longer exists, or you can't action it." };

  await writeAudit(userData.user.id, "ai_observation.confirm", "ai_observation", observationId, null, {
    kind: data.kind,
    title: data.title,
  });

  revalidatePath(`/app/assessments/${assessmentId}/evidence`);
  return { ok: true };
}

/** Rejected observations are retained with their reason (this prompt) — the row stays, the status changes. */
export async function rejectObservation(observationId: string, assessmentId: string, reason: string): Promise<ObservationActionResult> {
  if (reason.trim().length === 0) {
    return { ok: false, message: "Give a reason for rejecting this observation." };
  }

  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return { ok: false, message: "Sign in required." };

  const { data, error } = await supabase
    .from("ai_observations")
    .update({
      status: "rejected",
      rejection_reason: reason.trim(),
      actioned_by: userData.user.id,
      actioned_at: new Date().toISOString(),
    })
    .eq("id", observationId)
    .select("id, kind, title")
    .maybeSingle();
  if (error) return { ok: false, message: error.message };
  if (!data) return { ok: false, message: "That observation no longer exists, or you can't action it." };

  await writeAudit(userData.user.id, "ai_observation.reject", "ai_observation", observationId, null, {
    kind: data.kind,
    title: data.title,
    rejection_reason: reason.trim(),
  });

  revalidatePath(`/app/assessments/${assessmentId}/evidence`);
  return { ok: true };
}

export interface AddObservationInput {
  assessmentItemId: string;
  requirementId: string;
  kind: string;
  title: string;
  body: string;
  sourceFactKeys?: string[];
  pageRef?: string | null;
  evidenceFileId?: string | null;
}

/**
 * An assessor's own observation. Stored as `confirmed` and authored by
 * `assessor`: it needs no validation by the person who just wrote it,
 * and it goes straight to the workspace for that requirement.
 */
export async function addObservation(input: AddObservationInput, assessmentId: string): Promise<ObservationActionResult> {
  const kind = aiObservationKindSchema.safeParse(input.kind);
  if (!kind.success) {
    return { ok: false, message: "Choose one of the three observation kinds." };
  }
  if (input.title.trim().length === 0) {
    return { ok: false, message: "Give the observation a title." };
  }

  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return { ok: false, message: "Sign in required." };

  const { data, error } = await supabase
    .from("ai_observations")
    .insert({
      assessment_item_id: input.assessmentItemId,
      requirement_id: input.requirementId,
      kind: kind.data,
      title: input.title.trim(),
      body: input.body.trim() || null,
      status: "confirmed",
      source_fact_keys: input.sourceFactKeys ?? [],
      page_ref: input.pageRef ?? null,
      evidence_file_id: input.evidenceFileId ?? null,
      authored_by: "assessor",
      created_by: userData.user.id,
      actioned_by: userData.user.id,
      actioned_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error) return { ok: false, message: error.message };

  await writeAudit(userData.user.id, "ai_observation.add", "ai_observation", data.id as string, null, {
    kind: kind.data,
    title: input.title.trim(),
    authored_by: "assessor",
  });

  revalidatePath(`/app/assessments/${assessmentId}/evidence`);
  return { ok: true };
}
