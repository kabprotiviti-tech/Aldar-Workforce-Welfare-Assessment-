import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { callClaudeForExtraction } from "@/lib/ai/client";
import { computeCostUsd } from "@/lib/ai/cost";
import { analysePhoto, type CallVisionFn, type PhotoAnalysisResult } from "@/lib/vision/analyse";
import type { PhotoClass } from "@/lib/vision/classes";

/**
 * The real adapter behind lib/vision/analyse.ts: Storage for the image
 * bytes, the Anthropic client for the reading, and photo_analyses for
 * the result.
 *
 * Service-role, like the extraction adapter (lib/ai/extract-supabase.ts):
 * the analysis row is written by the platform, and the only thing an
 * assessor's own session writes is their decision on it, which goes
 * through resolve_photo_analysis as themselves.
 */

/** The Anthropic call, in the shape lib/vision/analyse.ts asks for. */
export const claudeVisionCall: CallVisionFn = async ({ systemPrompt, userText, image }) => {
  const response = await callClaudeForExtraction({
    systemPrompt,
    userText,
    content: { kind: "image", mediaType: image.mediaType, base64Data: image.base64Data },
  });
  return {
    text: response.text,
    model: response.model,
    inputTokens: response.inputTokens,
    outputTokens: response.outputTokens,
  };
};

export interface StoredPhoto {
  id: string;
  storagePath: string;
  photoClass: PhotoClass;
  roomRef: string | null;
}

function mediaTypeFor(storagePath: string): "image/jpeg" | "image/png" {
  return /\.png$/i.test(storagePath) ? "image/png" : "image/jpeg";
}

/**
 * Analyses one stored photograph and records the result. Returns the
 * analysis id, or null when the photograph could not be read at all —
 * the row is written either way, error and all, so a failure is visible
 * rather than a silent absence.
 */
export async function analyseStoredPhoto(
  photo: StoredPhoto,
  supabase: SupabaseClient = createSupabaseAdminClient(),
  callVision: CallVisionFn = claudeVisionCall,
): Promise<{ analysisId: string; result: PhotoAnalysisResult }> {
  const { data: file, error: downloadError } = await supabase.storage.from("evidence").download(photo.storagePath);
  if (downloadError) throw downloadError;

  const base64Data = Buffer.from(await file.arrayBuffer()).toString("base64");

  const result = await analysePhoto(callVision, {
    photoId: photo.id,
    photoClass: photo.photoClass,
    roomRef: photo.roomRef,
    image: { mediaType: mediaTypeFor(photo.storagePath), base64Data },
  });

  const { data, error } = await supabase
    .from("photo_analyses")
    .insert({
      photo_id: photo.id,
      photo_class: photo.photoClass,
      model: result.model || "unknown",
      prompt_version: result.promptVersion,
      raw_response: result.rawResponse,
      input_tokens: result.inputTokens,
      output_tokens: result.outputTokens,
      cost_usd: computeCostUsd(result.inputTokens, result.outputTokens),
      error: result.error,
      findings: result.readings,
      cannot_determine: result.cannotDetermine,
      suppressed: result.suppressed,
    })
    .select("id")
    .single();
  if (error) throw error;

  return { analysisId: data.id as string, result };
}
