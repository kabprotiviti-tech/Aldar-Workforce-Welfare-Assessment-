import { describe, expect, it, vi } from "vitest";
import { analysePhoto, type CallVisionFn } from "@/lib/vision/analyse";
import { buildPhotoSystemPrompt } from "@/lib/ai/prompts/photo/v1";
import { PHOTO_CLASS_DEFINITIONS, PHOTO_CLASSES, UNDETERMINABLE_FROM_A_PHOTOGRAPH, getPhotoClass } from "@/lib/vision/classes";
import { DERIVED_FACT_DEFINITIONS, PHOTO_DERIVED_FACT_KEYS } from "@/lib/vision/derived-facts";
import { containsUndeterminableClaim, findUndeterminableKey } from "@/lib/vision/undeterminable";

const IMAGE = { mediaType: "image/jpeg" as const, base64Data: "AAAA" };

function respondWith(body: unknown, overrides: Partial<{ model: string }> = {}): CallVisionFn {
  return vi.fn(async () => ({
    text: typeof body === "string" ? body : JSON.stringify(body),
    model: overrides.model ?? "claude-test",
    inputTokens: 1200,
    outputTokens: 340,
  }));
}

function reading(field: string, extra: Record<string, unknown> = {}) {
  return {
    field,
    observed: "present",
    count_in_frame: null,
    values: null,
    verbatim_text: null,
    condition: null,
    confidence: "high",
    ...extra,
  };
}

describe("analysePhoto", () => {
  it("keeps a well-formed reading and labels it from the class vocabulary", async () => {
    const result = await analysePhoto(respondWith({ readings: [reading("damp_or_mould_visible")], cannot_determine: [] }), {
      photoId: "p1",
      photoClass: "room_general",
      roomRef: "Room 204",
      image: IMAGE,
    });

    expect(result.error).toBeNull();
    expect(result.readings).toHaveLength(1);
    expect(result.readings[0]).toMatchObject({
      field: "damp_or_mould_visible",
      kind: "presence",
      observed: "present",
      confidence: "high",
      countInFrame: null,
      verbatimText: null,
      derivedFact: null,
    });
    expect(result.inputTokens).toBe(1200);
    expect(result.outputTokens).toBe(340);
  });

  it("passes the room reference to the model but never asks it to decide anything", async () => {
    const call = respondWith({ readings: [], cannot_determine: [] });
    await analysePhoto(call, { photoId: "p1", photoClass: "room_general", roomRef: "Room 204", image: IMAGE });

    const [sent] = (call as unknown as { mock: { calls: [{ systemPrompt: string; userText: string }][] } }).mock.calls[0]!;
    expect(sent.userText).toContain("Room 204");
    expect(sent.systemPrompt).toContain("They decide what it means. You do not.");
    expect(sent.systemPrompt).toContain("Do not answer an inspection question.");
  });

  it("rejects a field that is not in the class's vocabulary", async () => {
    const result = await analysePhoto(respondWith({ readings: [reading("fire_exit_blocked")], cannot_determine: [] }), {
      photoId: "p1",
      photoClass: "room_general",
      roomRef: null,
      image: IMAGE,
    });

    expect(result.readings).toEqual([]);
    expect(result.error).toContain("did not match the expected shape");
  });

  it("strips a status key rather than losing the whole analysis, and records that it did", async () => {
    const result = await analysePhoto(
      respondWith({ readings: [reading("waste_visible", { status: "non_compliant" })], cannot_determine: [], rating: "poor" }),
      { photoId: "p1", photoClass: "room_general", roomRef: null, image: IMAGE },
    );

    expect(result.error).toBeNull();
    expect(result.readings).toHaveLength(1);
    expect(JSON.stringify(result.readings)).not.toContain("non_compliant");
    expect(result.suppressed.join(" ")).toContain("status-like key");
    expect(result.suppressed.join(" ")).toContain("rating");
  });

  it("returns the class's standing caveats even when the model returns none, and even when the call fails", async () => {
    const ok = await analysePhoto(respondWith({ readings: [], cannot_determine: [] }), {
      photoId: "p1",
      photoClass: "ablution_general",
      roomRef: null,
      image: IMAGE,
    });
    expect(ok.cannotDetermine.join(" ")).toContain("fixture-to-resident ratio");
    expect(ok.cannotDetermine.join(" ")).toContain("Water temperature and water quality");

    const failed = await analysePhoto(
      vi.fn(async () => {
        throw new Error("upstream timed out");
      }),
      { photoId: "p1", photoClass: "ablution_general", roomRef: null, image: IMAGE },
    );
    expect(failed.error).toBe("upstream timed out");
    expect(failed.cannotDetermine.join(" ")).toContain("fixture-to-resident ratio");
  });

  it("adds a not-a-total caveat whenever a count in frame is reported", async () => {
    const result = await analysePhoto(
      respondWith({ readings: [reading("bed_count_in_frame", { count_in_frame: 6 })], cannot_determine: [] }),
      { photoId: "p1", photoClass: "room_general", roomRef: null, image: IMAGE },
    );

    expect(result.readings[0]!.countInFrame).toBe(6);
    expect(result.cannotDetermine.join(" ")).toContain("6 visible in this frame is not the number of beds in the room");
  });

  it("keeps the model's own caveats alongside the mandatory ones, without duplicating", async () => {
    const duplicate = getPhotoClass("room_general")!.alwaysCannotDetermine[0]!;
    const result = await analysePhoto(
      respondWith({ readings: [], cannot_determine: [duplicate, "  The window could not be seen.  "] }),
      { photoId: "p1", photoClass: "room_general", roomRef: null, image: IMAGE },
    );

    expect(result.cannotDetermine).toContain("The window could not be seen.");
    expect(result.cannotDetermine.filter((entry) => entry === duplicate)).toHaveLength(1);
  });

  it("ignores a repeated reading of the same field rather than letting the last one win", async () => {
    const result = await analysePhoto(
      respondWith({
        readings: [reading("waste_visible"), reading("waste_visible", { observed: "absent" })],
        cannot_determine: [],
      }),
      { photoId: "p1", photoClass: "room_general", roomRef: null, image: IMAGE },
    );

    expect(result.readings).toHaveLength(1);
    expect(result.readings[0]!.observed).toBe("present");
    expect(result.suppressed.join(" ")).toContain("reported more than once");
  });

  it("drops list values outside the field's closed list", async () => {
    const result = await analysePhoto(
      respondWith({
        readings: [reading("languages_identifiable", { values: ["Arabic script", "Klingon"] })],
        cannot_determine: [],
      }),
      { photoId: "p1", photoClass: "notice_board", roomRef: null, image: IMAGE },
    );

    expect(result.readings[0]!.values).toEqual(["Arabic script"]);
    expect(result.suppressed.join(" ")).toContain("Klingon");
  });

  it("offers a derived fact only for a legible verbatim text reading", async () => {
    const result = await analysePhoto(
      respondWith({
        readings: [
          reading("service_date_text", { verbatim_text: "12/03/2025" }),
          reading("expiry_date_text", { observed: "unclear", verbatim_text: "illegible smudge" }),
          reading("seal_intact"),
        ],
        cannot_determine: [],
      }),
      { photoId: "p1", photoClass: "fire_extinguisher", roomRef: null, image: IMAGE },
    );

    const byField = new Map(result.readings.map((entry) => [entry.field, entry]));
    expect(byField.get("service_date_text")!.derivedFact).toMatchObject({
      factKeyChoices: ["fire_extinguisher_service_date"],
      valueType: "date",
      verbatimText: "12/03/2025",
    });
    // Not legible enough for the assessor to have confirmed anything.
    expect(byField.get("expiry_date_text")!.derivedFact).toBeNull();
    expect(byField.get("seal_intact")!.derivedFact).toBeNull();
  });

  it("reports a response that is not JSON at all, keeping the raw text for provenance", async () => {
    const result = await analysePhoto(respondWith("I'm sorry, I can't help with that."), {
      photoId: "p1",
      photoClass: "vehicle",
      roomRef: null,
      image: IMAGE,
    });

    expect(result.error).toContain("was not valid JSON");
    expect(result.rawResponse).toBe("I'm sorry, I can't help with that.");
  });

  it("reads a fenced JSON response", async () => {
    const result = await analysePhoto(
      respondWith('```json\n{"readings": [], "cannot_determine": ["Nothing else was in frame."]}\n```'),
      { photoId: "p1", photoClass: "vehicle", roomRef: null, image: IMAGE },
    );

    expect(result.error).toBeNull();
    expect(result.cannotDetermine).toContain("Nothing else was in frame.");
  });

  it("refuses a class it does not analyse", async () => {
    const result = await analysePhoto(respondWith({ readings: [], cannot_determine: [] }), {
      photoId: "p1",
      // Deliberately outside the vocabulary — the caller is not trusted.
      photoClass: "worker_face" as never,
      roomRef: null,
      image: IMAGE,
    });

    expect(result.error).toContain("not a photograph class this platform analyses");
  });
});

/**
 * This prompt's acceptance criterion, from every angle a model could try:
 * "a test asserting that a bedroom photo never yields an area or
 * per-person value."
 */
describe("a bedroom photograph never yields an area or a per-person value", () => {
  it("has no field in the room_general vocabulary that could carry one", () => {
    const room = getPhotoClass("room_general")!;
    for (const field of room.fields) {
      expect(findUndeterminableKey({ [field.key]: null })).toBeNull();
      // The only numeric readings are counts of what is in frame.
      expect(field.kind === "count_in_frame" || field.kind === "presence").toBe(true);
    }
  });

  it("strips an area or per-person field the model invents, and keeps the rest of the analysis", async () => {
    const result = await analysePhoto(
      respondWith({
        readings: [
          reading("bed_count_in_frame", { count_in_frame: 8, floor_area_m2: 26.4, area_per_person: 3.3 }),
          reading("bedding_present"),
        ],
        cannot_determine: [],
        room_area_sqm: 26.4,
        occupancy: 8,
      }),
      { photoId: "p1", photoClass: "room_general", roomRef: "Room 204", image: IMAGE },
    );

    expect(result.error).toBeNull();
    expect(result.readings).toHaveLength(2);

    const serialised = JSON.stringify({ readings: result.readings, cannotDetermine: result.cannotDetermine });
    expect(serialised).not.toContain("26.4");
    expect(serialised).not.toContain("3.3");
    expect(findUndeterminableKey(result.readings)).toBeNull();
    expect(result.suppressed.join(" ")).toContain("floor_area_m2");
    expect(result.suppressed.join(" ")).toContain("area_per_person");
    expect(result.suppressed.join(" ")).toContain("room_area_sqm");
  });

  it("strips a measurement smuggled into free text", async () => {
    const result = await analysePhoto(
      respondWith({
        readings: [reading("surface_condition", { condition: "clean, room is roughly 26 m² for 8 men" })],
        cannot_determine: [],
      }),
      { photoId: "p1", photoClass: "kitchen_general", roomRef: null, image: IMAGE },
    );

    expect(result.readings[0]!.condition).toBeNull();
    expect(result.suppressed.join(" ")).toContain("made a claim a photograph cannot support");
  });

  it("nulls a verbatim reading on a field that reads no text, so a room photo carries no free-form number", async () => {
    const result = await analysePhoto(
      respondWith({
        readings: [reading("bedding_present", { verbatim_text: "measured 26.4 m2 during the visit" })],
        cannot_determine: [],
      }),
      { photoId: "p1", photoClass: "room_general", roomRef: null, image: IMAGE },
    );

    expect(result.readings[0]!.verbatimText).toBeNull();
    expect(result.suppressed.join(" ")).toContain("reads no text");
  });

  it("always names area, dimensions, per-person area and occupancy in cannot_determine", async () => {
    const result = await analysePhoto(respondWith({ readings: [], cannot_determine: [] }), {
      photoId: "p1",
      photoClass: "room_general",
      roomRef: null,
      image: IMAGE,
    });

    const text = result.cannotDetermine.join(" ").toLowerCase();
    expect(text).toContain("floor area");
    expect(text).toContain("dimensions");
    expect(text).toContain("per resident");
    expect(text).toContain("total occupancy");
  });

  it("declares no fact a room, kitchen or ablution photograph could become", () => {
    for (const photoClass of ["room_general", "kitchen_general", "ablution_general"] as const) {
      expect(DERIVED_FACT_DEFINITIONS.filter((entry) => entry.photoClass === photoClass)).toEqual([]);
    }
  });

  it("has no area, dimension or per-person key anywhere in the fact keys a photograph may produce", () => {
    for (const key of PHOTO_DERIVED_FACT_KEYS) {
      expect(findUndeterminableKey({ [key]: null })).toBeNull();
    }
  });
});

describe("the vocabulary itself", () => {
  it("declares every class exactly once, with at least one field", () => {
    expect(PHOTO_CLASS_DEFINITIONS.map((entry) => entry.photoClass).sort()).toEqual([...PHOTO_CLASSES].sort());
    for (const definition of PHOTO_CLASS_DEFINITIONS) {
      expect(definition.fields.length).toBeGreaterThan(0);
      expect(definition.alwaysCannotDetermine.length).toBeGreaterThan(0);
      expect(new Set(definition.fields.map((field) => field.key)).size).toBe(definition.fields.length);
    }
  });

  it("gives every count_in_frame field the total it is not, and every list field its closed list", () => {
    for (const definition of PHOTO_CLASS_DEFINITIONS) {
      for (const field of definition.fields) {
        if (field.kind === "count_in_frame") expect(field.notATotalOf).toBeTruthy();
        if (field.kind === "list") expect(field.allowedValues?.length ?? 0).toBeGreaterThan(0);
      }
    }
  });

  it("leaves the response schema's own key names alone", () => {
    // The guard walks keys, so a false positive here would silently
    // delete the response.
    expect(findUndeterminableKey({ readings: [{ field: "x", observed: "present", count_in_frame: 1, values: [], verbatim_text: "", condition: "", confidence: "high" }], cannot_determine: [] })).toBeNull();
  });

  it("matches an undeterminable claim in free text without flagging an ordinary condition reading", () => {
    expect(containsUndeterminableClaim("approximately 24 m² of floor")).toBe(true);
    expect(containsUndeterminableClaim("3.5 x 4 metres")).toBe(true);
    expect(containsUndeterminableClaim("2.8 m2 per resident")).toBe(true);
    expect(containsUndeterminableClaim("water at about 45 °C")).toBe(true);
    expect(containsUndeterminableClaim("occupancy of 8")).toBe(true);
    expect(containsUndeterminableClaim("sleeps 10")).toBe(true);
    expect(containsUndeterminableClaim("ratio of 1 to 8")).toBe(true);
    expect(containsUndeterminableClaim("8 men visible")).toBe(true);

    expect(containsUndeterminableClaim("surfaces worn, one panel missing")).toBe(false);
    expect(containsUndeterminableClaim("clean, no visible residue")).toBe(false);
    expect(containsUndeterminableClaim("bodywork dented on the near side")).toBe(false);
  });
});

describe("the prompt states the constraint explicitly", () => {
  it("names every category a photograph cannot establish, for every class", () => {
    for (const photoClass of PHOTO_CLASSES) {
      const prompt = buildPhotoSystemPrompt(photoClass);
      for (const entry of UNDETERMINABLE_FROM_A_PHOTOGRAPH) {
        expect(prompt).toContain(entry);
      }
      expect(prompt).toContain("name it in \"cannot_determine\"");
      expect(prompt).toContain("A count is always a count of what is visible in this frame, never a total.");
      // The model has no field for a status and is told so.
      expect(prompt).toContain('Never include a field named "status", "rating", "compliant" or "score"');
      // And it is told not to resolve a printed date on the assessor's behalf.
      expect(prompt).toContain("do not resolve an ambiguous one");
    }
  });

  it("lists exactly the class's declared fields, and nothing from another class", () => {
    const roomPrompt = buildPhotoSystemPrompt("room_general");
    for (const field of getPhotoClass("room_general")!.fields) {
      expect(roomPrompt).toContain(field.key);
    }
    expect(roomPrompt).not.toContain("registration_plate_text");
    expect(roomPrompt).not.toContain("extraction_hood_present");
  });
});
