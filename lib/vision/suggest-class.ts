import type { PhotoClass } from "@/lib/vision/classes";

/**
 * The photograph class the capture screen offers first, by accommodation
 * area (0010_seed_checklist_templates_v1.sql's 12 areas).
 *
 * A suggestion, never a decision: the assessor changes it in one tap,
 * and an area with no obvious subject offers nothing. On a phone in a
 * labour accommodation, saving the assessor from picking "Accommodation
 * room" twelve times in the bedrooms is the whole point; guessing on
 * their behalf when the area could be anything is not.
 *
 * Keyed by the area's sl_no rather than its title, so it does not break
 * on a wording change to the checklist.
 */
const SUGGESTED_BY_AREA_SL_NO: Readonly<Record<number, PhotoClass>> = {
  2: "room_general", // Bedrooms
  3: "ablution_general", // Bathrooms
  4: "kitchen_general", // Kitchens
  5: "kitchen_general", // Mess halls
  12: "fire_extinguisher", // Firefighting and alarm systems
};

export function suggestedPhotoClass(areaSlNo: number): PhotoClass | null {
  return SUGGESTED_BY_AREA_SL_NO[areaSlNo] ?? null;
}
