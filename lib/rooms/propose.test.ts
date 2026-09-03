import { describe, expect, it } from "vitest";
import { proposeRoomMeasurements } from "@/lib/rooms/propose";
import type { GroupedFact } from "@/lib/rooms/group-facts";

function fact(factKey: string, groupRef: string | null, confirmedValue: GroupedFact["confirmedValue"], confidence: GroupedFact["confidence"] = "high"): GroupedFact {
  return { factKey, groupRef, confirmedValue, confidence };
}

describe("proposeRoomMeasurements", () => {
  it("proposes an area computed from a printed area value", () => {
    const proposals = proposeRoomMeasurements([
      fact("drawing_room_ref", "204", "204"),
      fact("drawing_room_area_value", "204", 26.4),
      fact("drawing_room_area_unit", "204", "m2"),
    ]);

    expect(proposals).toEqual([{ roomRef: "204", drawingAreaM2: 26.4, lowConfidence: false, candidateReason: null, scheduleOccupancyHeadcount: null }]);
  });

  it("proposes an area computed from printed dimensions when no area value was printed", () => {
    const proposals = proposeRoomMeasurements([
      fact("drawing_room_ref", "204", "204"),
      fact("drawing_room_dimension_a", "204", 6.2),
      fact("drawing_room_dimension_b", "204", 4.1),
      fact("drawing_room_dimension_unit", "204", "m"),
    ]);

    expect(proposals[0]!.drawingAreaM2).toBeCloseTo(25.42, 2);
  });

  it("withholds a low-confidence reading rather than proposing a guess, and says why", () => {
    const proposals = proposeRoomMeasurements([
      fact("drawing_room_ref", "204", "204"),
      fact("drawing_room_area_value", "204", 26.4, "low"),
      fact("drawing_room_area_unit", "204", "m2", "low"),
    ]);

    expect(proposals).toEqual([
      { roomRef: "204", drawingAreaM2: null, lowConfidence: true, candidateReason: "The drawing's reading for this room was low confidence.", scheduleOccupancyHeadcount: null },
    ]);
  });

  it("proposes nothing, without marking low confidence, for a room with no usable reading at all", () => {
    const proposals = proposeRoomMeasurements([fact("drawing_room_ref", "204", "204")]);
    expect(proposals).toEqual([{ roomRef: "204", drawingAreaM2: null, lowConfidence: false, candidateReason: expect.any(String), scheduleOccupancyHeadcount: null }]);
  });

  it("handles several rooms from the same drawing independently, in room-ref order", () => {
    const proposals = proposeRoomMeasurements([
      fact("drawing_room_area_value", "205", 18, "high"),
      fact("drawing_room_area_unit", "205", "m2"),
      fact("drawing_room_area_value", "101", 30, "high"),
      fact("drawing_room_area_unit", "101", "m2"),
    ]);

    expect(proposals.map((p) => p.roomRef)).toEqual(["101", "205"]);
    expect(proposals.map((p) => p.drawingAreaM2)).toEqual([30, 18]);
  });

  it("proposes a schedule occupancy figure independently of any drawing reading", () => {
    const proposals = proposeRoomMeasurements([fact("occupancy_room_ref", "204", "204"), fact("occupancy_headcount", "204", 8)]);
    expect(proposals).toEqual([{ roomRef: "204", drawingAreaM2: null, lowConfidence: false, candidateReason: null, scheduleOccupancyHeadcount: 8 }]);
  });

  it("merges a drawing reading and a schedule reading for the same room into one proposal", () => {
    const proposals = proposeRoomMeasurements([
      fact("drawing_room_area_value", "204", 26.4),
      fact("drawing_room_area_unit", "204", "m2"),
      fact("occupancy_headcount", "204", 8),
    ]);

    expect(proposals).toEqual([{ roomRef: "204", drawingAreaM2: 26.4, lowConfidence: false, candidateReason: null, scheduleOccupancyHeadcount: 8 }]);
  });

  it("returns nothing for a document with no group_ref at all", () => {
    expect(proposeRoomMeasurements([{ factKey: "civil_defence_expiry_date", groupRef: null, confirmedValue: "2026-12-31", confidence: "high" }])).toEqual([]);
  });
});
