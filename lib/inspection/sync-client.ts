"use client";

import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { requestInspectionPhotoUpload } from "@/lib/inspection/actions";
import { photoStoragePath, type QueuedMutation, type SendMutationFn } from "@/lib/inspection/queue";

/**
 * Turning a queued mutation into a request. Two steps for a photo — the
 * bytes go to Storage first, then the row references them — and one for
 * everything else.
 *
 * Both steps are safe to repeat. The Storage path is derived from the
 * mutation id and uploaded with upsert, so a retry overwrites the same
 * object rather than leaving an orphan; the mutation itself is
 * idempotent server-side. That is what makes a naive "just try the whole
 * queue again" retry correct.
 */
export function createSender(): SendMutationFn {
  return async (mutation: QueuedMutation) => {
    const payload = { ...mutation.payload };

    if (mutation.kind === "photo" && mutation.blob) {
      const path = photoStoragePath(mutation.assessmentId, mutation.clientMutationId);
      const signed = await requestInspectionPhotoUpload(mutation.assessmentId, path);
      if (!signed.ok) throw new Error(signed.message);

      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.storage
        .from("evidence")
        .uploadToSignedUrl(signed.path, signed.token, mutation.blob, { contentType: "image/jpeg", upsert: true });
      // An "already exists" here means a previous attempt got the bytes
      // up before losing the response — the object is what we wanted, so
      // it is not a failure.
      if (error && !/exists/i.test(error.message)) throw error;

      payload.storage_path = signed.path;
    }

    const response = await fetch("/api/inspection/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mutations: [
          {
            clientMutationId: mutation.clientMutationId,
            assessmentId: mutation.assessmentId,
            kind: mutation.kind,
            payload,
          },
        ],
      }),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error ?? `Sync failed (${response.status})`);
    }

    const body = (await response.json()) as { results: { ok: boolean; error?: string }[] };
    const result = body.results[0];
    if (!result?.ok) throw new Error(result?.error ?? "Sync failed.");
  };
}
