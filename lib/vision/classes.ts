/**
 * The closed vocabulary of photograph analysis (this prompt). The
 * constraint is the point of the feature: a photograph is analysed for
 * exactly these classes, exactly these fields, and nothing else.
 *
 * Everything here is data, not prose. The prompt is generated from it
 * (lib/ai/prompts/photo/v1.ts), the response schema is generated from it
 * (lib/vision/schema.ts), and the analyser validates against it
 * (lib/vision/analyse.ts). A field that does not appear below cannot be
 * asked for, cannot be returned, and cannot become a fact.
 */

export const PHOTO_CLASSES = [
  "fire_extinguisher",
  "exit_route",
  "notice_board",
  "certificate_document",
  "room_general",
  "kitchen_general",
  "ablution_general",
  "vehicle",
] as const;

export type PhotoClass = (typeof PHOTO_CLASSES)[number];

/**
 * What kind of reading a field is. The kind decides which parts of the
 * response shape are meaningful — code nulls the rest rather than
 * trusting the model to leave them out (lib/vision/analyse.ts).
 *
 *  - presence:       is the thing there? (present | absent | unclear)
 *  - count_in_frame: how many are visible IN THIS FRAME. Never a total.
 *  - text:           a verbatim reading of text visible in the photograph.
 *  - list:           a set of labels chosen from a closed list.
 *  - condition:      a short description of visible condition.
 */
export type FieldKind = "presence" | "count_in_frame" | "text" | "list" | "condition";

export interface PhotoFieldDefinition {
  key: string;
  kind: FieldKind;
  /** Shown to the model, and shown to the assessor as the field's label. */
  description: string;
  /**
   * For count_in_frame fields: the total this count is NOT. Code appends
   * it to cannot_determine whenever the count is reported, so a "6 beds
   * visible" reading can never be read as "this room sleeps 6".
   */
  notATotalOf?: string;
  /** For list fields: the only labels the model may return. */
  allowedValues?: readonly string[];
}

export interface PhotoClassDefinition {
  photoClass: PhotoClass;
  /** How the class is described to the model and labelled in the UI. */
  label: string;
  /** What the assessor is photographing, in the model's terms. */
  subject: string;
  fields: readonly PhotoFieldDefinition[];
  /**
   * Things a photograph of this class cannot establish, appended to
   * cannot_determine by code on every analysis of this class — not left
   * to the model to remember (this prompt: they "must always appear in
   * cannot_determine when relevant").
   */
  alwaysCannotDetermine: readonly string[];
}

/**
 * The categories of claim a photograph can never support, stated once.
 * This prompt names them: area, dimensions, per-person ratios,
 * temperature, water quality and occupancy totals. They appear in the
 * prompt text, in the per-class cannot_determine lists below, and in the
 * guards in lib/vision/undeterminable.ts.
 */
export const UNDETERMINABLE_FROM_A_PHOTOGRAPH = [
  "floor area",
  "room dimensions",
  "per-person floor area or any other per-person ratio",
  "air or water temperature",
  "water quality",
  "total occupancy of the room or facility",
] as const;

const ROOM_CAVEATS = [
  "Floor area of the room — a photograph cannot measure it.",
  "Room dimensions — a photograph cannot measure them.",
  "Floor area per resident — this requires the measured area and the confirmed occupancy, neither of which a photograph provides.",
  "Total occupancy of the room — a photograph shows what is in frame, not how many people sleep here.",
] as const;

export const PHOTO_CLASS_DEFINITIONS: readonly PhotoClassDefinition[] = [
  {
    photoClass: "fire_extinguisher",
    label: "Fire extinguisher",
    subject: "a fire extinguisher and its immediate surroundings",
    fields: [
      { key: "unit_present", kind: "presence", description: "An extinguisher unit is visible in the photograph." },
      { key: "service_tag_legible", kind: "presence", description: "A service tag or inspection label is visible and its text can be read." },
      { key: "service_date_text", kind: "text", description: "The last service or inspection date, copied exactly as printed on the tag." },
      { key: "expiry_date_text", kind: "text", description: "The next-due or expiry date, copied exactly as printed on the tag." },
      { key: "seal_intact", kind: "presence", description: "The tamper seal or safety pin appears intact." },
      { key: "obstructed", kind: "presence", description: "Something is blocking access to the unit." },
    ],
    alwaysCannotDetermine: [
      "Whether the extinguisher is charged or functional — a photograph shows the gauge at one instant, not the unit's serviceability.",
      "Whether the extinguisher is the correct type for the hazard in this location.",
    ],
  },
  {
    photoClass: "exit_route",
    label: "Exit route",
    subject: "an escape route, exit door or exit signage",
    fields: [
      { key: "signage_present", kind: "presence", description: "Exit signage is visible." },
      { key: "illuminated_sign_visible", kind: "presence", description: "An illuminated exit sign is visible and lit." },
      { key: "obstruction_visible", kind: "presence", description: "The route is obstructed by stored goods, furniture or anything else." },
    ],
    alwaysCannotDetermine: [
      "Whether the door is unlocked or opens in the direction of escape.",
      "Travel distance to the exit, and the width of the escape route — a photograph cannot measure them.",
      "Whether emergency lighting operates on loss of mains power.",
    ],
  },
  {
    photoClass: "notice_board",
    label: "Notice board",
    subject: "a worker notice board",
    fields: [
      { key: "text_present", kind: "presence", description: "Printed or written notices are visible on the board." },
      {
        key: "languages_identifiable",
        kind: "list",
        description:
          "Languages identifiable from the script visible on the board. Report only what the script itself shows; if a script is used by several languages, report the script's name rather than guessing which language it is.",
        allowedValues: ["Arabic script", "Latin script", "Devanagari script", "Bengali script", "Urdu script", "Tamil script", "Malayalam script", "Sinhala script", "Nepali script", "Chinese script", "Other script"],
      },
      { key: "grievance_number_legible", kind: "text", description: "A grievance or helpline telephone number shown on the board, copied exactly as printed." },
    ],
    alwaysCannotDetermine: [
      "Whether the notices are current, or whether they say what they are required to say — the photograph shows that text exists, not that it is correct or in date.",
      "Whether workers understand the languages shown.",
      "Whether the grievance number is answered.",
    ],
  },
  {
    photoClass: "certificate_document",
    label: "Certificate or document",
    subject: "a certificate, permit or official document, photographed on site",
    fields: [
      { key: "document_type", kind: "text", description: "What the document calls itself, copied exactly from its title." },
      { key: "issuing_body", kind: "text", description: "The issuing authority named on the document, copied exactly." },
      { key: "reference_number", kind: "text", description: "The certificate, permit or reference number, copied exactly." },
      { key: "expiry_date_text", kind: "text", description: "The expiry or valid-to date, copied exactly as printed. Do not convert or reformat it." },
    ],
    alwaysCannotDetermine: [
      "Whether the document is genuine, current, or has been superseded.",
      "Anything printed on a page not visible in this photograph.",
    ],
  },
  {
    photoClass: "room_general",
    label: "Accommodation room",
    subject: "the general condition of an accommodation room",
    fields: [
      { key: "bed_count_in_frame", kind: "count_in_frame", description: "How many beds are visible in this frame.", notATotalOf: "the number of beds in the room" },
      { key: "bunk_levels", kind: "count_in_frame", description: "How many tiers the visible bunks have (1 for single beds, 2 for double bunks, and so on).", notATotalOf: "the tier count of bunks outside this frame" },
      { key: "damp_or_mould_visible", kind: "presence", description: "Damp staining or mould growth is visible." },
      { key: "waste_visible", kind: "presence", description: "Waste or refuse is visible in the room." },
      { key: "bedding_present", kind: "presence", description: "Mattresses and bedding are on the visible beds." },
      { key: "personal_storage_present", kind: "presence", description: "Lockers, cupboards or other personal storage are visible." },
    ],
    alwaysCannotDetermine: [...ROOM_CAVEATS, "Air temperature and whether air conditioning is working."],
  },
  {
    photoClass: "kitchen_general",
    label: "Kitchen",
    subject: "the general condition of a kitchen or food preparation area",
    fields: [
      { key: "pest_evidence_visible", kind: "presence", description: "Visible evidence of pests — droppings, insects, gnawed packaging, traps in use." },
      { key: "food_stored_off_floor", kind: "presence", description: "Food and ingredients visible in the frame are stored off the floor." },
      { key: "extraction_hood_present", kind: "presence", description: "An extraction hood or canopy is fitted above the cooking range." },
      { key: "surface_condition", kind: "condition", description: "The visible condition of work surfaces and equipment, described in one short phrase." },
    ],
    alwaysCannotDetermine: [
      "Food storage or hot-holding temperatures — a photograph cannot measure temperature.",
      "Water quality and wash-water temperature.",
      "Kitchen floor area, and any area-per-user ratio.",
      "Whether food handlers hold current health cards or training.",
    ],
  },
  {
    photoClass: "ablution_general",
    label: "Ablution facilities",
    subject: "the general condition of toilets, showers or washing facilities",
    fields: [
      { key: "fixture_count_in_frame", kind: "count_in_frame", description: "How many toilets, showers or wash basins are visible in this frame.", notATotalOf: "the number of fixtures in the facility" },
      { key: "water_damage_visible", kind: "presence", description: "Water damage, leaks or standing water are visible." },
      { key: "cleanliness", kind: "condition", description: "The visible cleanliness of the facility, described in one short phrase." },
    ],
    alwaysCannotDetermine: [
      "The fixture-to-resident ratio — this requires the facility's total fixture count and its confirmed occupancy, neither of which a photograph provides.",
      "Total occupancy of the accommodation served by this facility.",
      "Water temperature and water quality.",
      "Whether hot water is available, and at what pressure.",
    ],
  },
  {
    photoClass: "vehicle",
    label: "Vehicle",
    subject: "a vehicle used to transport workers",
    fields: [
      { key: "registration_plate_text", kind: "text", description: "The registration plate, copied exactly as shown including the emirate or region code." },
      { key: "visible_condition", kind: "condition", description: "The vehicle's visible external condition, described in one short phrase." },
    ],
    alwaysCannotDetermine: [
      "Whether the registration, insurance or test certificate is current — none of that is visible on the vehicle.",
      "Seating capacity and the number of passengers carried.",
      "Mechanical condition, and whether seat belts are fitted and functional.",
    ],
  },
];

const BY_CLASS = new Map(PHOTO_CLASS_DEFINITIONS.map((definition) => [definition.photoClass, definition]));

export function getPhotoClass(photoClass: string): PhotoClassDefinition | null {
  return BY_CLASS.get(photoClass as PhotoClass) ?? null;
}

export function getPhotoField(photoClass: string, fieldKey: string): PhotoFieldDefinition | null {
  return getPhotoClass(photoClass)?.fields.find((field) => field.key === fieldKey) ?? null;
}

/** Every field key a class may return, in declaration order — the enum the response schema is built from. */
export function fieldKeysFor(photoClass: PhotoClass): [string, ...string[]] {
  const keys = BY_CLASS.get(photoClass)!.fields.map((field) => field.key);
  return keys as [string, ...string[]];
}
