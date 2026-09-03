import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { RoomsReview, type AssessmentOption } from "@/components/rooms/rooms-review";
import type { RoomView } from "@/components/rooms/room-measurement-panel";

/**
 * Room measurements for one facility — deliberately facility-scoped
 * rather than assessment-scoped, the same way public.rooms itself is
 * (0006_rules_measurement.sql): a room's area and occupancy persist
 * across assessment cycles, even though the drawing or schedule that
 * proposed a figure was uploaded against one particular assessment.
 */
export default async function FacilityRoomsPage({ params }: { params: Promise<{ facilityId: string }> }) {
  const { facilityId } = await params;
  const supabase = await createSupabaseServerClient();

  const { data: facility } = await supabase.from("facilities").select("id, name, entity_id").eq("id", facilityId).is("deleted_at", null).maybeSingle();
  if (!facility) {
    notFound();
  }

  const [{ data: roomRows }, { data: assessmentRows }] = await Promise.all([
    supabase
      .from("rooms")
      .select(
        "id, room_ref, drawing_area_m2, drawing_area_low_confidence, measured_area_m2, area_confirmed_at, source, bed_count, occupancy_count, occupancy_source, occupancy_confirmed_at, schedule_occupancy_headcount, computed_m2_per_person",
      )
      .eq("facility_id", facilityId)
      .is("deleted_at", null)
      .order("room_ref"),
    supabase.from("assessments").select("id, subject_code").eq("facility_id", facilityId).order("created_at", { ascending: false }),
  ]);

  const rooms: RoomView[] = (roomRows ?? []).map((row) => ({
    id: row.id as string,
    roomRef: row.room_ref as string,
    drawingAreaM2: row.drawing_area_m2 === null ? null : Number(row.drawing_area_m2),
    drawingAreaLowConfidence: Boolean(row.drawing_area_low_confidence),
    measuredAreaM2: row.measured_area_m2 === null ? null : Number(row.measured_area_m2),
    areaConfirmedAt: (row.area_confirmed_at as string | null) ?? null,
    source: row.source as string,
    bedCount: row.bed_count === null ? null : Number(row.bed_count),
    occupancyCount: row.occupancy_count === null ? null : Number(row.occupancy_count),
    occupancySource: (row.occupancy_source as string | null) ?? null,
    occupancyConfirmedAt: (row.occupancy_confirmed_at as string | null) ?? null,
    scheduleOccupancyHeadcount: row.schedule_occupancy_headcount === null ? null : Number(row.schedule_occupancy_headcount),
    computedM2PerPerson: row.computed_m2_per_person === null ? null : Number(row.computed_m2_per_person),
  }));

  const assessments: AssessmentOption[] = (assessmentRows ?? []).map((row) => ({ id: row.id as string, subjectCode: row.subject_code as string }));

  return (
    <div className="p-4">
      <header className="mb-3">
        <h1 className="text-base font-semibold text-ds-ink">Room measurements — {facility.name}</h1>
        <p className="text-xs text-ds-ink-2">
          An area figure is proposed from a confirmed approved drawing or entered from a physical measurement; either way, an assessor confirms
          it before it feeds a compliance rule. A m² per resident figure exists only once both the area and the occupancy are confirmed.
        </p>
      </header>
      <RoomsReview facilityId={facilityId} rooms={rooms} assessments={assessments} />
    </div>
  );
}
