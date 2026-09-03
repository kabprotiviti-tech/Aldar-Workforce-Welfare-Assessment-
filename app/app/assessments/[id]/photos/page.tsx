import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { PhotoReviewList } from "@/components/vision/photo-review-list";
import type { AnalysedReading } from "@/lib/vision/analyse";
import type { PhotoClass } from "@/lib/vision/classes";
import type { InspectionPhotoView, PhotoAnalysisStatus } from "@/lib/vision/store";

function oneOf<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

/**
 * Photograph review: every inspection photograph for one assessment,
 * with its analysis beside it (this prompt).
 *
 * Analyses are read straight from photo_analyses rather than through
 * photo_analysis_confirmed, because this screen is the review surface —
 * showing an assessor the unreviewed analysis is precisely its job, the
 * same exception the fact ledger's own screen has
 * (tests/read-path.test.ts). Everything downstream of the decision reads
 * the view.
 */
export default async function PhotosPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();

  const { data: assessment } = await supabase.from("assessments").select("id, subject_code").eq("id", id).maybeSingle();
  if (!assessment) {
    notFound();
  }

  const { data: photoRows } = await supabase
    .from("photos")
    .select("id, storage_path, photo_class, room_ref, captured_at, requirements(title)")
    .eq("assessment_id", id)
    .order("captured_at", { ascending: true });

  const photoIds = (photoRows ?? []).map((row) => row.id as string);
  const { data: analysisRows } = photoIds.length
    ? await supabase
        .from("photo_analyses")
        .select("id, photo_id, photo_class, findings, cannot_determine, suppressed, status, rejection_reason, error, model, created_at")
        .in("photo_id", photoIds)
        .order("created_at", { ascending: true })
    : { data: [] as Record<string, unknown>[] };

  // Latest run per photograph wins: re-analysing a photograph is a
  // second opinion, not a second row to review.
  const analysisByPhoto = new Map<string, InspectionPhotoView["analysis"]>();
  for (const row of analysisRows ?? []) {
    analysisByPhoto.set(row.photo_id as string, {
      id: row.id as string,
      photoId: row.photo_id as string,
      photoClass: row.photo_class as PhotoClass,
      readings: ((row.findings ?? []) as AnalysedReading[]) ?? [],
      cannotDetermine: (row.cannot_determine as string[] | null) ?? [],
      suppressed: (row.suppressed as string[] | null) ?? [],
      status: row.status as PhotoAnalysisStatus,
      rejectionReason: (row.rejection_reason as string | null) ?? null,
      error: (row.error as string | null) ?? null,
      model: (row.model as string) ?? "",
      createdAt: row.created_at as string,
    });
  }

  // Signed URLs are issued service-side, in one batch, and expire in five
  // minutes — the same posture as the evidence preview.
  const admin = createSupabaseAdminClient();
  const paths = (photoRows ?? []).map((row) => row.storage_path as string);
  const { data: signed } = paths.length ? await admin.storage.from("evidence").createSignedUrls(paths, 300) : { data: [] };
  const urlByPath = new Map((signed ?? []).map((entry) => [entry.path ?? "", entry.signedUrl]));

  const photos: InspectionPhotoView[] = (photoRows ?? []).map((row) => ({
    id: row.id as string,
    storagePath: row.storage_path as string,
    signedUrl: urlByPath.get(row.storage_path as string) ?? null,
    photoClass: (row.photo_class as PhotoClass | null) ?? null,
    roomRef: (row.room_ref as string | null) ?? null,
    capturedAt: (row.captured_at as string | null) ?? null,
    requirementTitle: oneOf(row.requirements as unknown as { title: string } | { title: string }[] | null)?.title ?? null,
    analysis: analysisByPhoto.get(row.id as string) ?? null,
  }));

  return (
    <div className="p-4">
      <header className="mb-3">
        <h1 className="text-base font-semibold text-ds-ink">Photograph review — {assessment.subject_code}</h1>
        <p className="text-xs text-ds-ink-2">
          Analysis reports what is visible in a frame. Area, dimensions, per-person ratios, temperature, water quality and occupancy totals
          cannot be read from a photograph, and each analysis says so.
        </p>
      </header>
      <PhotoReviewList assessmentId={id} photos={photos} />
    </div>
  );
}
