"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * A signed upload URL for one inspection photo, at a path the client
 * derives from its own mutation id. Same shape as the evidence upload
 * flow (lib/evidence/actions.ts): the caller's session is checked through
 * RLS first, then the service-role client issues the signed URL, and the
 * bytes go straight from the phone to Storage without passing through
 * this server.
 */
export type PhotoUploadResult = { ok: true; path: string; token: string } | { ok: false; message: string };

export async function requestInspectionPhotoUpload(assessmentId: string, path: string): Promise<PhotoUploadResult> {
  // The path is derived on the device, so it is checked rather than
  // trusted: an assessor's queue must not be able to write outside its
  // own assessment's prefix.
  if (!path.startsWith(`inspection/${assessmentId}/`) || path.includes("..")) {
    return { ok: false, message: "That upload path doesn't belong to this assessment." };
  }

  const supabase = await createSupabaseServerClient();
  const { data: assessment } = await supabase.from("assessments").select("id").eq("id", assessmentId).maybeSingle();
  if (!assessment) {
    return { ok: false, message: "Assessment not found." };
  }

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.storage.from("evidence").createSignedUploadUrl(path, { upsert: true });
  if (error) {
    return { ok: false, message: error.message };
  }

  return { ok: true, path: data.path, token: data.token };
}
