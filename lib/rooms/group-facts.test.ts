import { describe, expect, it } from "vitest";
import { groupConfidence, groupFactsByRef, groupNumberValue, groupStringValue, type GroupedFact } from "@/lib/rooms/group-facts";

function fact(factKey: string, groupRef: string | null, confirmedValue: GroupedFact["confirmedValue"], confidence: GroupedFact["confidence"] = "high"): GroupedFact {
  return { factKey, groupRef, confirmedValue, confidence };
}

const DRAWING_KEYS = ["drawing_room_ref", "drawing_room_area_value", "drawing_room_area_unit"];

describe("groupFactsByRef", () => {
  it("groups facts belonging to the same entry, regardless of the order they were confirmed in", () => {
    const facts = [
      fact("drawing_room_area_value", "Room 204", 26.4),
      fact("drawing_room_ref", "Room 101", "Room 101"),
      fact("drawing_room_ref", "Room 204", "Room 204"),
      fact("drawing_room_area_value", "Room 101", 18),
      fact("drawing_room_area_unit", "Room 204", "m2"),
    ];

    const groups = groupFactsByRef(facts, DRAWING_KEYS);

    expect([...groups.keys()].sort()).toEqual(["Room 101", "Room 204"]);
    expect(groupNumberValue(groups.get("Room 204")!, "drawing_room_area_value")).toBe(26.4);
    expect(groupStringValue(groups.get("Room 204")!, "drawing_room_area_unit")).toBe("m2");
    expect(groupNumberValue(groups.get("Room 101")!, "drawing_room_area_value")).toBe(18);
    // Room 101 was never given a unit fact — the group simply lacks it.
    expect(groupStringValue(groups.get("Room 101")!, "drawing_room_area_unit")).toBeNull();
  });

  it("excludes a document-wide fact that carries no group_ref", () => {
    const facts = [fact("drawing_room_area_value", "Room 204", 26.4), fact("civil_defence_expiry_date", null, "2026-12-31")];
    const groups = groupFactsByRef(facts, DRAWING_KEYS);
    expect(groups.size).toBe(1);
    expect(groups.has("Room 204")).toBe(true);
  });

  it("ignores a fact key that wasn't asked for, even if it carries a group_ref", () => {
    const facts = [fact("drawing_room_area_value", "Room 204", 26.4), fact("occupancy_headcount", "Room 204", 8)];
    const groups = groupFactsByRef(facts, DRAWING_KEYS);
    expect(groupNumberValue(groups.get("Room 204")!, "occupancy_headcount")).toBeNull();
  });

  it("returns an empty map for no facts", () => {
    expect(groupFactsByRef([], DRAWING_KEYS).size).toBe(0);
  });
});

describe("groupStringValue / groupNumberValue / groupConfidence", () => {
  it("returns null for a value of the wrong type rather than coercing it", () => {
    const groups = groupFactsByRef([fact("drawing_room_area_value", "Room 204", "not a number" as unknown as number)], ["drawing_room_area_value"]);
    expect(groupNumberValue(groups.get("Room 204")!, "drawing_room_area_value")).toBeNull();
  });

  it("treats an empty string as absent", () => {
    const groups = groupFactsByRef([fact("drawing_room_ref", "Room 204", "  ")], ["drawing_room_ref"]);
    expect(groupStringValue(groups.get("Room 204")!, "drawing_room_ref")).toBeNull();
  });

  it("reads a group's stored confidence, or null when the field is absent", () => {
    const groups = groupFactsByRef([fact("drawing_room_area_value", "Room 204", 26.4, "medium")], ["drawing_room_area_value"]);
    expect(groupConfidence(groups.get("Room 204")!, "drawing_room_area_value")).toBe("medium");
    expect(groupConfidence(groups.get("Room 204")!, "drawing_room_area_unit")).toBeNull();
  });
});
