"use client";

import { useState, useTransition } from "react";
import { confirmRoomArea, confirmScheduleOccupancy, overrideRoomArea, type RoomActionResult } from "@/lib/rooms/actions";
import { Button } from "@/components/ds/button";
import { Pill, type PillTone } from "@/components/ds/pill";

/**
 * One room's measurements, reviewed the same way a photograph analysis
 * is (components/vision/photo-analysis-panel.tsx): the computed
 * candidate beside the underlying reading, and an explicit
 * accept/override rather than a value that quietly becomes load-bearing
 * on its own.
 *
 * This prompt: "on low confidence, present a manual entry field rather
 * than a guess" — a room with no confirmed area shows either a proposed
 * figure to confirm, or, when none was proposed at all (nothing printed,
 * or the reading was withheld for low confidence), only the manual
 * field. There is no third state where a low-confidence guess is shown
 * for the assessor to accept unread.
 */

const SOURCE_LABELS: Record<string, string> = { drawing: "Drawing", manual: "Measured on site", both: "Drawing + measured on site" };
const SOURCE_TONE: Record<string, PillTone> = { drawing: "info", manual: "neutral", both: "ok" };

export interface RoomView {
  id: string;
  roomRef: string;
  drawingAreaM2: number | null;
  drawingAreaLowConfidence: boolean;
  measuredAreaM2: number | null;
  areaConfirmedAt: string | null;
  source: string;
  bedCount: number | null;
  occupancyCount: number | null;
  occupancySource: string | null;
  occupancyConfirmedAt: string | null;
  scheduleOccupancyHeadcount: number | null;
  computedM2PerPerson: number | null;
}

export function RoomMeasurementPanel({ facilityId, room, onChanged }: { facilityId: string; room: RoomView; onChanged: () => void }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [measured, setMeasured] = useState("");

  function run(action: () => Promise<RoomActionResult>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setMeasured("");
      onChanged();
    });
  }

  const areaConfirmed = room.areaConfirmedAt !== null;
  const hasCandidate = room.drawingAreaM2 !== null;
  const occupancyConfirmed = room.occupancyConfirmedAt !== null;
  const scheduleAvailable = room.scheduleOccupancyHeadcount !== null;
  const scheduleDiffersFromPhysical =
    occupancyConfirmed && room.occupancySource === "physical_count" && scheduleAvailable && room.scheduleOccupancyHeadcount !== room.occupancyCount;

  return (
    <article className="rounded-ds-card border border-ds-line bg-ds-surface p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-ds-ink">{room.roomRef}</h3>
        {areaConfirmed && <Pill tone={SOURCE_TONE[room.source] ?? "neutral"}>{SOURCE_LABELS[room.source] ?? room.source}</Pill>}
      </div>

      <section className="mt-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-ds-ink-2">Floor area</h4>

        {areaConfirmed ? (
          <p className="mt-1 text-sm text-ds-ink">
            {room.measuredAreaM2 ?? room.drawingAreaM2} m² — confirmed
            {room.source === "both" && room.drawingAreaM2 !== null && room.measuredAreaM2 !== null && (
              <span className="text-ds-ink-2"> (drawing said {room.drawingAreaM2} m²)</span>
            )}
          </p>
        ) : hasCandidate ? (
          <div className="mt-1">
            <p className="text-sm text-ds-ink">{room.drawingAreaM2} m² proposed from the approved drawing.</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <Button disabled={pending} onClick={() => run(() => confirmRoomArea(room.id, facilityId))}>
                Confirm
              </Button>
              <input
                aria-label="Measured area in square metres"
                type="number"
                step="0.01"
                min="0"
                placeholder="Measured m²"
                value={measured}
                onChange={(event) => setMeasured(event.target.value)}
                className="ds-focus-ring w-28 rounded-ds-control border border-ds-line bg-ds-surface px-2 py-1 text-xs text-ds-ink"
              />
              <Button
                variant="secondary"
                disabled={pending || measured.trim().length === 0}
                onClick={() => run(() => overrideRoomArea(room.id, facilityId, Number(measured)))}
              >
                Use my measurement instead
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-1">
            <p className="text-sm text-ds-ink-2">
              {room.drawingAreaLowConfidence
                ? "The drawing's reading for this room was low confidence, so no figure is proposed. Enter the measured area."
                : "No drawing reading for this room. Enter the measured area."}
            </p>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <input
                aria-label="Measured area in square metres"
                type="number"
                step="0.01"
                min="0"
                placeholder="Measured m²"
                value={measured}
                onChange={(event) => setMeasured(event.target.value)}
                className="ds-focus-ring w-28 rounded-ds-control border border-ds-line bg-ds-surface px-2 py-1 text-xs text-ds-ink"
              />
              <Button disabled={pending || measured.trim().length === 0} onClick={() => run(() => overrideRoomArea(room.id, facilityId, Number(measured)))}>
                Record measured area
              </Button>
            </div>
          </div>
        )}
      </section>

      <section className="mt-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-ds-ink-2">Occupancy</h4>
        {occupancyConfirmed ? (
          <p className="mt-1 text-sm text-ds-ink">
            {room.occupancyCount} resident(s) — {room.occupancySource === "physical_count" ? "on-site count" : "occupancy schedule"}
          </p>
        ) : scheduleAvailable ? (
          <div className="mt-1">
            <p className="text-sm text-ds-ink-2">No on-site count yet. Occupancy schedule recorded {room.scheduleOccupancyHeadcount} resident(s).</p>
            <Button className="mt-1.5" disabled={pending} onClick={() => run(() => confirmScheduleOccupancy(room.id, facilityId))}>
              Use the schedule figure
            </Button>
          </div>
        ) : (
          <p className="mt-1 text-sm text-ds-ink-2">No occupancy recorded yet — captured on site during the inspection.</p>
        )}
        {scheduleDiffersFromPhysical && (
          <p className="mt-1 text-xs text-ds-warn">
            On-site count ({room.occupancyCount}) does not match the occupancy schedule ({room.scheduleOccupancyHeadcount}).
          </p>
        )}
      </section>

      <section className="mt-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-ds-ink-2">m² per resident</h4>
        <p className="mt-1 text-sm text-ds-ink">
          {room.computedM2PerPerson !== null
            ? `${room.computedM2PerPerson.toFixed(2)} m²`
            : "Not available — needs a confirmed area and a confirmed occupancy."}
        </p>
      </section>

      {error && <p className="mt-2 text-xs text-ds-warn">{error}</p>}
    </article>
  );
}
