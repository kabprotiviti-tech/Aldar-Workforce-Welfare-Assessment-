"use client";

import { useRouter } from "next/navigation";
import { PhotoAnalysisPanel } from "@/components/vision/photo-analysis-panel";
import { isConfirmed, type InspectionPhotoView } from "@/lib/vision/store";
import { EmptyState } from "@/components/ds/empty-state";

/**
 * The photograph review list. Client-side only so each panel can refresh
 * the server-rendered page after a decision; everything it shows is
 * loaded on the server.
 */
export function PhotoReviewList({ assessmentId, photos }: { assessmentId: string; photos: InspectionPhotoView[] }) {
  const router = useRouter();

  if (photos.length === 0) {
    return <EmptyState title="No photographs yet" description="Photographs captured during the on-site inspection appear here once the device has synced." />;
  }

  const awaiting = photos.filter((photo) => photo.analysis?.status === "proposed").length;
  const confirmed = photos.filter((photo) => photo.analysis !== null && isConfirmed(photo.analysis.status)).length;

  return (
    <div>
      <p className="text-xs tabular-nums text-ds-ink-2">
        {photos.length} photograph(s) · {awaiting} analysis awaiting review · {confirmed} confirmed
      </p>
      <div className="mt-3 space-y-3">
        {photos.map((photo) => (
          <PhotoAnalysisPanel key={photo.id} assessmentId={assessmentId} photo={photo} onChanged={() => router.refresh()} />
        ))}
      </div>
    </div>
  );
}
