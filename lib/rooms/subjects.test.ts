import { describe, expect, it } from "vitest";
import { roomQuantitative, type RoomRow } from "@/lib/rooms/subjects";

function room(overrides: Partial<RoomRow> = {}): RoomRow {
  return {
    roomRef: "Room 204",
    areaConfirmedAt: null,
    measuredAreaM2: null,
    drawingAreaM2: null,
    occupancyConfirmedAt: null,
    occupancyCount: null,
    occupancySource: null,
    scheduleOccupancyHeadcount: null,
    ...overrides,
  };
}

describe("roomQuantitative", () => {
  it("contributes nothing at all for a room nobody has looked at", () => {
    expect(roomQuantitative(room())).toEqual({});
  });

  it("withholds the area when it was proposed but never confirmed", () => {
    expect(roomQuantitative(room({ drawingAreaM2: 26.4 }))).toEqual({});
  });

  it("withholds the occupancy when it was counted but never confirmed", () => {
    // Shouldn't happen in practice — the pipeline sets occupancy_count and
    // occupancy_confirmed_at together — but the gate holds regardless of
    // how the two ever came apart.
    expect(roomQuantitative(room({ occupancyCount: 8 }))).toEqual({});
  });

  it("contributes the confirmed drawing area", () => {
    expect(roomQuantitative(room({ areaConfirmedAt: "2026-06-01T00:00:00Z", drawingAreaM2: 26.4 }))).toEqual({ room_area_m2: 26.4 });
  });

  it("prefers the measured area over the drawing area once both are confirmed", () => {
    const result = roomQuantitative(room({ areaConfirmedAt: "2026-06-01T00:00:00Z", drawingAreaM2: 26.4, measuredAreaM2: 25.1 }));
    expect(result).toEqual({ room_area_m2: 25.1 });
  });

  it("contributes the confirmed physical occupancy, and reconciliation's physical figure", () => {
    const result = roomQuantitative(room({ occupancyConfirmedAt: "2026-06-01T00:00:00Z", occupancyCount: 8, occupancySource: "physical_count" }));
    expect(result).toEqual({ room_occupancy: 8, room_occupancy_physical: 8 });
  });

  it("contributes the confirmed schedule-sourced occupancy, but not as the reconciliation's physical figure", () => {
    const result = roomQuantitative(room({ occupancyConfirmedAt: "2026-06-01T00:00:00Z", occupancyCount: 8, occupancySource: "schedule" }));
    expect(result).toEqual({ room_occupancy: 8 });
  });

  it("contributes the schedule's own figure for reconciliation independently of what occupancy_count is", () => {
    const result = roomQuantitative(
      room({ occupancyConfirmedAt: "2026-06-01T00:00:00Z", occupancyCount: 8, occupancySource: "physical_count", scheduleOccupancyHeadcount: 6 }),
    );
    expect(result).toEqual({ room_occupancy: 8, room_occupancy_physical: 8, room_occupancy_schedule: 6 });
  });

  it("produces both a confirmed area and a confirmed occupancy together, ready for R18_ROOM_AREA", () => {
    const result = roomQuantitative(
      room({ areaConfirmedAt: "2026-06-01T00:00:00Z", drawingAreaM2: 26.4, occupancyConfirmedAt: "2026-06-01T00:00:00Z", occupancyCount: 8, occupancySource: "physical_count" }),
    );
    expect(result).toEqual({ room_area_m2: 26.4, room_occupancy: 8, room_occupancy_physical: 8 });
  });
});
